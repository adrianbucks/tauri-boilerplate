import {
  ValidationError,
  getUtcIsoTimestamp,
  generateCorrelationId,
  extractContextSubject,
  type OperationContext,
  type TrustedOperationContext,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { AuthorizationEngine } from "@platform/authorization";
import { SyncManager, OutboxService, TombstoneService } from "@platform/sync";
import type { SyncEnvelope } from "@platform/sync-protocol";
import { NotesRepository } from "./NotesRepository.js";
import { NOTES_PERMISSIONS } from "./NotesManifest.js";
import type { NoteRecord, CreateNoteInput, UpdateNoteInput } from "./NotesTypes.js";

export interface NotesServiceOptions {
  db: DatabaseConnection;
  auth?: AuthorizationEngine | undefined;
  sync?: SyncManager | undefined;
  outbox?: OutboxService | undefined;
  tombstones?: TombstoneService | undefined;
}

export class NotesService {
  private readonly db: DatabaseConnection;
  private readonly repo: NotesRepository;
  private readonly auth: AuthorizationEngine;
  private readonly outbox: OutboxService;
  private readonly tombstones: TombstoneService;

  constructor(options: NotesServiceOptions) {
    this.db = options.db;
    this.repo = new NotesRepository(options.db);
    this.auth = options.auth ?? new AuthorizationEngine(options.db);
    this.outbox =
      options.outbox ?? options.sync?.getOutboxService() ?? new OutboxService(options.db);
    this.tombstones = options.tombstones ?? new TombstoneService(options.db);
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
      throw new Error("Unauthenticated subject cannot perform operation");
    }
    const executor = tx ?? this.db;
    const roleRows = await executor.query<{ role_id: string }>(
      "SELECT role_id FROM core_user_roles WHERE user_id = ? AND organisation_id = ?",
      [subject.userId, subject.organisationId],
    );
    const roles = Object.freeze(roleRows.map((r) => r.role_id));
    const decision = await this.auth.can(
      {
        userId: subject.userId,
        organisationId: subject.organisationId,
        roles,
      },
      permission,
      undefined,
      tx,
    );
    if (!decision.granted) {
      throw new Error(`Subject does not hold permission '${permission}': ${decision.reason}`);
    }
  }

  async createNote(
    ctx: OperationContext | TrustedOperationContext,
    input: CreateNoteInput,
    tx?: TransactionClient,
  ): Promise<NoteRecord> {
    await this.requirePermission(ctx, NOTES_PERMISSIONS.CREATE, tx);

    if (!input.title || !input.title.trim()) {
      throw new ValidationError({
        message: "Note title cannot be empty",
        userMessage: "Title is required",
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
      await this.repo.insert(noteRecord, client);

      const opId = generateCorrelationId("op_note_crt");
      const envelope: SyncEnvelope = {
        envelopeId: opId,
        signedAt: now,
        signerPublicKey: "ephemeral_local_signer",
        signature: "ephemeral_local_signature",
        operation: {
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
      };
      await this.outbox.enqueue(envelope, client);
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
      return this.repo.findBySyncGroup(syncGroupId, subject.organisationId, tx);
    }
    return this.repo.findAll({ excludeDeleted: true }, tx);
  }

  async getNote(
    ctx: OperationContext | TrustedOperationContext,
    id: string,
    tx?: TransactionClient,
  ): Promise<NoteRecord | null> {
    await this.requirePermission(ctx, NOTES_PERMISSIONS.READ, tx);
    const subject = extractContextSubject(ctx);
    return this.repo.findByIdWithinOrganisation(id, subject.organisationId, tx);
  }

  async updateNote(
    ctx: OperationContext | TrustedOperationContext,
    input: UpdateNoteInput,
    tx?: TransactionClient,
  ): Promise<NoteRecord> {
    await this.requirePermission(ctx, NOTES_PERMISSIONS.UPDATE, tx);
    const subject = extractContextSubject(ctx);

    const doUpdate = async (client: TransactionClient) => {
      const existing = await this.repo.findByIdWithinOrganisation(
        input.id,
        subject.organisationId,
        client,
      );
      if (!existing) {
        throw new Error(`Note '${input.id}' not found`);
      }

      const now = getUtcIsoTimestamp();
      const updated: NoteRecord = {
        ...existing,
        title: input.title !== undefined ? input.title.trim() : existing.title,
        content: input.content !== undefined ? input.content : existing.content,
        updatedAt: now,
      };

      await this.repo.update(input.id, updated, client);

      const opId = generateCorrelationId("op_note_upd");
      const envelope: SyncEnvelope = {
        envelopeId: opId,
        signedAt: now,
        signerPublicKey: "ephemeral_local_signer",
        signature: "ephemeral_local_signature",
        operation: {
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
      };
      await this.outbox.enqueue(envelope, client);
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
    await this.requirePermission(ctx, NOTES_PERMISSIONS.DELETE, tx);
    const subject = extractContextSubject(ctx);

    const doDelete = async (client: TransactionClient) => {
      const existing = await this.repo.findByIdWithinOrganisation(
        id,
        subject.organisationId,
        client,
      );
      if (!existing) {
        return;
      }

      const now = getUtcIsoTimestamp();
      const delOpId = `op_del_${id}`;
      await this.tombstones.record(
        "notes",
        id,
        subject.userId ?? "system",
        delOpId,
        subject.organisationId,
        existing.syncGroupId,
        "notes",
        client,
      );

      await this.repo.softDelete(id, subject.userId ?? "system", client);

      const opId = generateCorrelationId("op_note_del");
      const envelope: SyncEnvelope = {
        envelopeId: opId,
        signedAt: now,
        signerPublicKey: "ephemeral_local_signer",
        signature: "ephemeral_local_signature",
        operation: {
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
      };
      await this.outbox.enqueue(envelope, client);
    };

    if (tx) {
      await doDelete(tx);
    } else {
      await this.db.transaction(doDelete);
    }
  }
}
