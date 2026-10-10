import {
  ValidationError,
  AuthorizationError,
  getUtcIsoTimestamp,
  generateCorrelationId,
  extractContextSubject,
  type OperationContext,
  type TrustedOperationContext,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { AuthorizationEngine, SyncGroupService } from "@platform/authorization";
import { SyncManager, OutboxService, TombstoneService } from "@platform/sync";
import { SyncEnvelopeBuilder, type SignFn, type SyncOperation } from "@platform/sync-protocol";
import { NotesRepository } from "./NotesRepository.js";
import { NOTES_PERMISSIONS } from "./NotesManifest.js";
import type { NoteRecord, CreateNoteInput, UpdateNoteInput } from "./NotesTypes.js";

export interface NotesServiceOptions {
  db: DatabaseConnection;
  signer: NotesSyncSigner;
  auth?: AuthorizationEngine | undefined;
  syncGroups?: SyncGroupService | undefined;
  sync?: SyncManager | undefined;
  outbox?: OutboxService | undefined;
  tombstones?: TombstoneService | undefined;
}

export interface NotesSyncSigner {
  /** Canonical Ed25519 public key for the device identity. */
  readonly publicKey: string;
  /** Must delegate signing to the native key provider; private key bytes stay outside TypeScript. */
  readonly sign: SignFn;
}

export class NotesService {
  private readonly db: DatabaseConnection;
  private readonly repo: NotesRepository;
  private readonly auth: AuthorizationEngine;
  private readonly syncGroups: SyncGroupService;
  private readonly outbox: OutboxService;
  private readonly tombstones: TombstoneService;
  private readonly signer: NotesSyncSigner;

  constructor(options: NotesServiceOptions) {
    this.db = options.db;
    this.signer = options.signer;
    this.repo = new NotesRepository(options.db);
    this.auth = options.auth ?? new AuthorizationEngine(options.db);
    this.syncGroups = options.syncGroups ?? new SyncGroupService(options.db, this.auth);
    this.outbox =
      options.outbox ?? options.sync?.getOutboxService() ?? new OutboxService(options.db);
    this.tombstones = options.tombstones ?? new TombstoneService(options.db);
  }

  private async enqueueOperation(operation: SyncOperation, tx: TransactionClient): Promise<void> {
    const envelope = await SyncEnvelopeBuilder.build(
      operation,
      this.signer.publicKey,
      this.signer.sign,
    );
    await this.outbox.enqueue(envelope, tx);
  }

  private async requirePermission(
    ctx: OperationContext | TrustedOperationContext,
    permission: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if ("principal" in ctx && ctx.principal) {
      await this.auth.requireTrusted(ctx, permission, undefined, tx);
      return;
    }
    const subject = extractContextSubject(ctx);
    if (!subject.userId) {
      throw new AuthorizationError({
        message: `Unauthenticated subject cannot perform operation '${permission}'`,
        userMessage: "You are not authorized to perform this operation",
        correlationId: ctx.correlationId,
      });
    }
    await this.auth.requireForSubject(
      subject.userId,
      subject.organisationId,
      permission,
      undefined,
      tx,
    );
  }

  async createNote(
    ctx: OperationContext | TrustedOperationContext,
    input: CreateNoteInput,
    tx?: TransactionClient,
  ): Promise<NoteRecord> {
    if (typeof input.title !== "string" || !input.title.trim()) {
      throw new ValidationError({
        message: "Note title cannot be empty",
        userMessage: "Title is required",
        correlationId: ctx.correlationId,
      });
    }
    if (typeof input.content !== "string") {
      throw new ValidationError({
        message: "Note content must be a string",
        userMessage: "Note content is invalid",
        correlationId: ctx.correlationId,
      });
    }

    const subject = extractContextSubject(ctx);
    const now = getUtcIsoTimestamp();
    const noteId = `note_${generateCorrelationId()}`;

    const noteRecord: NoteRecord = {
      id: noteId,
      createdAt: now,
      updatedAt: now,
      organisationId: subject.organisationId,
      syncGroupId: input.syncGroupId,
      title: input.title.trim(),
      content: input.content,
      authorId: subject.userId ?? "system",
      deletedAt: null,
      deletedBy: null,
      deleteOperationId: null,
    };

    const doCreate = async (client: TransactionClient) => {
      await this.requirePermission(ctx, NOTES_PERMISSIONS.CREATE, client);
      await this.syncGroups.requireActiveMembership(ctx, input.syncGroupId, client);
      await this.repo.insert(noteRecord, client);

      const opId = generateCorrelationId("op_note_crt");
      await this.enqueueOperation(
        {
          operationId: opId,
          applicationId: "minimal-consumer",
          organisationId: subject.organisationId,
          syncGroupId: input.syncGroupId,
          featureId: "notes",
          entityType: "notes",
          entityId: noteId,
          operation: "create",
          payload: noteRecord as unknown as Record<string, unknown>,
          authorId: subject.userId ?? "system",
          deviceId: subject.deviceId,
          logicalTimestamp: `${now}:0001:${subject.deviceId}`,
          schemaVersion: 1,
          protocolVersion: 1,
        },
        client,
      );
      return noteRecord;
    };

    if (tx) {
      return doCreate(tx);
    } else {
      return this.db.transaction(doCreate);
    }
  }

  async listNotes(
    ctx: OperationContext | TrustedOperationContext,
    syncGroupId?: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord[]> {
    await this.requirePermission(ctx, NOTES_PERMISSIONS.READ, tx);
    const subject = extractContextSubject(ctx);
    if (syncGroupId) {
      await this.syncGroups.requireActiveMembership(ctx, syncGroupId, tx);
      return this.repo.findBySyncGroup(syncGroupId, subject.organisationId, tx);
    }
    return this.repo.findAllWithinOrganisation(
      subject.organisationId,
      subject.deviceId,
      subject.userId,
      tx,
    );
  }

  async getNote(
    ctx: OperationContext | TrustedOperationContext,
    id: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord | null> {
    await this.requirePermission(ctx, NOTES_PERMISSIONS.READ, tx);
    const subject = extractContextSubject(ctx);
    const note = await this.repo.findByIdWithinOrganisation(id, subject.organisationId, tx);
    if (note) await this.syncGroups.requireActiveMembership(ctx, note.syncGroupId, tx);
    return note;
  }

  async updateNote(
    ctx: OperationContext | TrustedOperationContext,
    input: UpdateNoteInput,
    tx?: TransactionClient,
  ): Promise<NoteRecord> {
    const hasTitle = input.title !== undefined;
    const hasContent = input.content !== undefined;
    if (!hasTitle && !hasContent) {
      throw new ValidationError({
        message: "Note update must include at least one field",
        userMessage: "Provide a title or content change",
        correlationId: ctx.correlationId,
      });
    }
    if (hasTitle && (typeof input.title !== "string" || !input.title.trim())) {
      throw new ValidationError({
        message: "Updated note title cannot be empty",
        userMessage: "Title is required",
        correlationId: ctx.correlationId,
      });
    }
    if (hasContent && typeof input.content !== "string") {
      throw new ValidationError({
        message: "Updated note content must be a string",
        userMessage: "Note content is invalid",
        correlationId: ctx.correlationId,
      });
    }
    const subject = extractContextSubject(ctx);

    const doUpdate = async (client: TransactionClient) => {
      await this.requirePermission(ctx, NOTES_PERMISSIONS.UPDATE, client);
      const existing = await this.repo.findByIdWithinOrganisation(
        input.id,
        subject.organisationId,
        client,
      );
      if (!existing) {
        throw new Error(`Note '${input.id}' not found`);
      }
      await this.syncGroups.requireActiveMembership(ctx, existing.syncGroupId, client);

      const now = getUtcIsoTimestamp();
      const updated: NoteRecord = {
        ...existing,
        title: input.title !== undefined ? input.title.trim() : existing.title,
        content: input.content !== undefined ? input.content : existing.content,
        updatedAt: now,
      };

      await this.repo.update(input.id, updated, client);

      const opId = generateCorrelationId("op_note_upd");
      await this.enqueueOperation(
        {
          operationId: opId,
          applicationId: "minimal-consumer",
          organisationId: subject.organisationId,
          syncGroupId: existing.syncGroupId,
          featureId: "notes",
          entityType: "notes",
          entityId: input.id,
          operation: "update",
          payload: updated as unknown as Record<string, unknown>,
          authorId: subject.userId ?? "system",
          deviceId: subject.deviceId,
          logicalTimestamp: `${now}:0001:${subject.deviceId}`,
          schemaVersion: 1,
          protocolVersion: 1,
        },
        client,
      );
      return updated;
    };

    if (tx) {
      return doUpdate(tx);
    } else {
      return this.db.transaction(doUpdate);
    }
  }

  async deleteNote(
    ctx: OperationContext | TrustedOperationContext,
    id: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const subject = extractContextSubject(ctx);

    const doDelete = async (client: TransactionClient) => {
      await this.requirePermission(ctx, NOTES_PERMISSIONS.DELETE, client);
      const existing = await this.repo.findByIdWithinOrganisation(
        id,
        subject.organisationId,
        client,
      );
      if (!existing) {
        return;
      }
      await this.syncGroups.requireActiveMembership(ctx, existing.syncGroupId, client);

      const now = getUtcIsoTimestamp();
      const opId = generateCorrelationId("op_note_del");
      await this.tombstones.record(
        "notes",
        id,
        subject.userId ?? "system",
        opId,
        subject.organisationId,
        existing.syncGroupId,
        "notes",
        client,
        now,
      );

      await this.repo.softDeleteWithOperationId(id, subject.userId ?? "system", opId, now, client);
      await this.enqueueOperation(
        {
          operationId: opId,
          applicationId: "minimal-consumer",
          organisationId: subject.organisationId,
          syncGroupId: existing.syncGroupId,
          featureId: "notes",
          entityType: "notes",
          entityId: id,
          operation: "delete",
          payload: { id, deletedAt: now },
          authorId: subject.userId ?? "system",
          deviceId: subject.deviceId,
          logicalTimestamp: `${now}:0001:${subject.deviceId}`,
          schemaVersion: 1,
          protocolVersion: 1,
        },
        client,
      );
    };

    if (tx) {
      await doDelete(tx);
    } else {
      await this.db.transaction(doDelete);
    }
  }
}
