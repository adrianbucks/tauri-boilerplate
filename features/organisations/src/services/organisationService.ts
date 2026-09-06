import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  AuthorizationError,
  extractContextSubject,
  type OperationContext,
  type TrustedOperationContext,
} from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { AuthorizationEngine } from "@platform/authorization";
import {
  OrganisationRepository,
  type OrganisationRecord,
} from "../repositories/organisationRepository.js";
import {
  ORGANISATION_PERMISSIONS,
  type OrganisationPermission,
} from "../permissions.js";

export interface CreateOrganisationInput {
  name: string;
  domain?: string | undefined;
  settings?: Record<string, unknown> | undefined;
}

export interface UpdateOrganisationInput {
  name?: string | undefined;
  settings?: Record<string, unknown> | undefined;
}

export class OrganisationService {
  private readonly repo: OrganisationRepository;
  private readonly db: DatabaseConnection;
  private readonly auth: AuthorizationEngine;

  constructor(db: DatabaseConnection, auth?: AuthorizationEngine) {
    this.db = db;
    this.repo = new OrganisationRepository(db);
    this.auth = auth ?? new AuthorizationEngine(db);
  }

  private async requirePermission(
    ctx: OperationContext | TrustedOperationContext,
    permission: OrganisationPermission,
    tx?: TransactionClient,
  ): Promise<void> {
    if ("principal" in ctx && ctx.principal) {
      await this.auth.requireTrusted(ctx, permission, undefined, tx);
      return;
    }

    const { userId, organisationId } = extractContextSubject(ctx);
    if (!userId) {
      throw new AuthorizationError({
        message: `Operation requires authenticated subject with permission '${permission}'`,
        userMessage: "You are not authorized to perform this operation",
        correlationId: ctx.correlationId,
      });
    }

    const executor = tx ?? this.db;
    const roleRows = await executor.query<{ role_id: string }>(
      `SELECT role_id FROM core_user_roles WHERE user_id = ? AND organisation_id = ?`,
      [userId, organisationId],
    );
    const roles = Object.freeze(roleRows.map((r) => r.role_id));

    await this.auth.require(
      { userId, organisationId, roles },
      permission,
      undefined,
      tx,
    );
  }

  async createOrganisation(
    input: CreateOrganisationInput,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<OrganisationRecord> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError({
        message: "Organisation name is required",
        userMessage: "Please provide an organisation name",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
      await this.requirePermission(ctx, ORGANISATION_PERMISSIONS.CREATE, tx);

      if (input.domain) {
        const existing = await this.repo.findByDomain(
          input.domain.trim().toLowerCase(),
          tx,
        );
        if (existing) {
          throw new ValidationError({
            message: `Organisation with domain '${input.domain}' already exists`,
            userMessage: "Domain is already in use by another organisation",
            correlationId: ctx.correlationId,
          });
        }
      }

      const id = generateCorrelationId("org");
      const now = getUtcIsoTimestamp();
      const { userId } = extractContextSubject(ctx);

      const record: OrganisationRecord = {
        id,
        created_at: now,
        updated_at: now,
        created_by: userId,
        updated_by: userId,
        name: input.name.trim(),
        domain: input.domain ? input.domain.trim().toLowerCase() : null,
        status: "ACTIVE",
        settings_json: input.settings ? JSON.stringify(input.settings) : null,
      };

      await this.repo.insert(record, tx);
      return record;
    });
  }

  async getOrganisationById(
    id: string,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<OrganisationRecord | null> {
    await this.requirePermission(ctx, ORGANISATION_PERMISSIONS.READ);
    const { organisationId } = extractContextSubject(ctx);
    return this.repo.findByIdWithinOrganisation(id, organisationId);
  }

  async updateOrganisation(
    id: string,
    input: UpdateOrganisationInput,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<OrganisationRecord> {
    await this.requirePermission(ctx, ORGANISATION_PERMISSIONS.MANAGE);
    const { userId, organisationId } = extractContextSubject(ctx);

    const existing = await this.repo.findByIdWithinOrganisation(
      id,
      organisationId,
    );
    if (!existing) {
      throw new ValidationError({
        message: `Organisation '${id}' not found`,
        userMessage: "Organisation not found",
        correlationId: ctx.correlationId,
      });
    }

    const updates: Partial<OrganisationRecord> = {
      updated_at: getUtcIsoTimestamp(),
      updated_by: userId,
    };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.settings !== undefined)
      updates.settings_json = JSON.stringify(input.settings);

    await this.repo.update(id, updates);
    return (await this.repo.findByIdWithinOrganisation(id, organisationId))!;
  }

  async listOrganisations(
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<OrganisationRecord[]> {
    await this.requirePermission(ctx, ORGANISATION_PERMISSIONS.READ);
    const { organisationId } = extractContextSubject(ctx);
    return this.repo.findAllWithinOrganisation(organisationId);
  }
}
