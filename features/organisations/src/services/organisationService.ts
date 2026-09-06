import {
  getUtcIsoTimestamp,
  generateCorrelationId,
  ValidationError,
  type OperationContext,
} from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import {
  OrganisationRepository,
  type OrganisationRecord,
} from "../repositories/organisationRepository.js";

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

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.repo = new OrganisationRepository(db);
  }

  async createOrganisation(
    input: CreateOrganisationInput,
    ctx: OperationContext,
  ): Promise<OrganisationRecord> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError({
        message: "Organisation name is required",
        userMessage: "Please provide an organisation name",
        correlationId: ctx.correlationId,
      });
    }

    return this.db.transaction(async (tx) => {
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

      const record: OrganisationRecord = {
        id,
        created_at: now,
        updated_at: now,
        created_by: ctx.userId,
        updated_by: ctx.userId,
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
    ctx: OperationContext,
  ): Promise<OrganisationRecord | null> {
    return this.repo.findByIdWithinOrganisation(id, ctx.organisationId);
  }

  async updateOrganisation(
    id: string,
    input: UpdateOrganisationInput,
    ctx: OperationContext,
  ): Promise<OrganisationRecord> {
    const existing = await this.repo.findByIdWithinOrganisation(
      id,
      ctx.organisationId,
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
      updated_by: ctx.userId,
    };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.settings !== undefined)
      updates.settings_json = JSON.stringify(input.settings);

    await this.repo.update(id, updates);
    return (await this.repo.findByIdWithinOrganisation(
      id,
      ctx.organisationId,
    ))!;
  }

  async listOrganisations(
    ctx: OperationContext,
  ): Promise<OrganisationRecord[]> {
    return this.repo.findAllWithinOrganisation(ctx.organisationId);
  }
}
