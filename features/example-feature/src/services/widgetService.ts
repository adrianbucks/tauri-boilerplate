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
import { WidgetRepository } from "../repositories/widgetRepository.js";
import type { WidgetRecord } from "../schema/widgets.js";
import { WIDGET_PERMISSIONS, type WidgetPermission } from "../permissions.js";

export interface CreateWidgetInput {
  name: string;
  sku: string;
  quantity: number;
  description?: string | undefined;
  syncGroupId: string;
}

export interface UpdateWidgetInput {
  name?: string | undefined;
  quantity?: number | undefined;
  description?: string | undefined;
}

export class WidgetService {
  private readonly repo: WidgetRepository;
  private readonly db: DatabaseConnection;
  private readonly auth: AuthorizationEngine;
  private readonly syncGroups: SyncGroupService;

  constructor(db: DatabaseConnection, auth?: AuthorizationEngine) {
    this.db = db;
    this.repo = new WidgetRepository(db);
    this.auth = auth ?? new AuthorizationEngine(db);
    this.syncGroups = new SyncGroupService(db, this.auth);
  }

  private async requirePermission(
    ctx: OperationContext | TrustedOperationContext,
    permission: WidgetPermission,
    tx?: TransactionClient,
  ): Promise<void> {
    if ("principal" in ctx && ctx.principal) {
      await this.auth.requireTrusted(ctx, permission, undefined, tx);
      return;
    }
    const subject = extractContextSubject(ctx);
    if (!subject.userId) {
      throw new AuthorizationError({
        message: `Operation requires authenticated subject with permission '${permission}'`,
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

  async createWidget(
    input: CreateWidgetInput,
    ctx: OperationContext | TrustedOperationContext,
    tx?: TransactionClient,
  ): Promise<WidgetRecord> {
    // 1. Validation
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError({
        message: "Widget name is required",
        userMessage: "Please provide a valid widget name",
        correlationId: ctx.correlationId,
      });
    }

    if (!input.sku || input.sku.trim().length === 0) {
      throw new ValidationError({
        message: "Widget SKU is required",
        userMessage: "Please provide a valid SKU",
        correlationId: ctx.correlationId,
      });
    }

    if (input.quantity < 0) {
      throw new ValidationError({
        message: "Widget quantity cannot be negative",
        userMessage: "Quantity must be zero or positive",
        correlationId: ctx.correlationId,
      });
    }
    if (!Number.isSafeInteger(input.quantity)) {
      throw new ValidationError({
        message: "Widget quantity must be a safe integer",
        userMessage: "Quantity must be a whole number",
        correlationId: ctx.correlationId,
      });
    }

    const subject = extractContextSubject(ctx);
    const normalizedSku = input.sku.trim().toUpperCase();

    // 2. Execute in the caller's transaction when supplied, otherwise create
    // an atomic transaction for this operation.
    const create = async (transaction: TransactionClient) => {
      await this.requirePermission(ctx, WIDGET_PERMISSIONS.CREATE, transaction);
      await this.syncGroups.requireActiveMembership(ctx, input.syncGroupId, transaction);

      const existing = await this.repo.findBySku(
        normalizedSku,
        subject.organisationId,
        transaction,
      );
      if (existing) {
        throw new ValidationError({
          message: `Widget with SKU '${normalizedSku}' already exists`,
          userMessage: "A widget with this SKU already exists",
          correlationId: ctx.correlationId,
        });
      }

      const id = generateCorrelationId("wid");
      const now = getUtcIsoTimestamp();

      const record: WidgetRecord = {
        id,
        createdAt: now,
        updatedAt: now,
        createdBy: subject.userId,
        updatedBy: subject.userId,
        entityId: id,
        organisationId: subject.organisationId,
        syncGroupId: input.syncGroupId,
        schemaVersion: 1,
        syncVersion: 1,
        deletedAt: null,
        deletedBy: null,
        deleteOperationId: null,
        dataClassification: "INTERNAL",
        name: input.name.trim(),
        sku: normalizedSku,
        quantity: input.quantity,
        description: input.description ?? null,
      };

      await this.repo.insert(record, transaction);
      return record;
    };

    return tx ? create(tx) : this.db.transaction(create);
  }

  async getWidgetById(
    id: string,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<WidgetRecord | null> {
    await this.requirePermission(ctx, WIDGET_PERMISSIONS.READ);
    const subject = extractContextSubject(ctx);
    const widget = await this.repo.findByIdWithinOrganisation(id, subject.organisationId);
    if (widget) await this.syncGroups.requireActiveMembership(ctx, widget.syncGroupId);
    return widget;
  }

  async listWidgets(
    syncGroupId: string,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<WidgetRecord[]> {
    await this.requirePermission(ctx, WIDGET_PERMISSIONS.READ);
    const subject = extractContextSubject(ctx);
    await this.syncGroups.requireActiveMembership(ctx, syncGroupId);
    return this.repo.findBySyncGroup(syncGroupId, subject.organisationId);
  }

  async updateWidget(
    id: string,
    input: UpdateWidgetInput,
    ctx: OperationContext | TrustedOperationContext,
  ): Promise<void> {
    const subject = extractContextSubject(ctx);
    if (
      input.name === undefined &&
      input.quantity === undefined &&
      input.description === undefined
    ) {
      throw new ValidationError({
        message: "Widget update must include at least one field",
        userMessage: "Provide a name, quantity, or description change",
        correlationId: ctx.correlationId,
      });
    }
    if (input.name !== undefined && !input.name.trim()) {
      throw new ValidationError({
        message: "Widget name cannot be empty",
        userMessage: "Please provide a valid widget name",
        correlationId: ctx.correlationId,
      });
    }
    if (
      input.quantity !== undefined &&
      (!Number.isSafeInteger(input.quantity) || input.quantity < 0)
    ) {
      throw new ValidationError({
        message: "Widget quantity must be a non-negative safe integer",
        userMessage: "Quantity must be a whole number zero or greater",
        correlationId: ctx.correlationId,
      });
    }

    await this.db.transaction(async (tx) => {
      await this.requirePermission(ctx, WIDGET_PERMISSIONS.UPDATE, tx);
      const existing = await this.repo.findByIdWithinOrganisation(id, subject.organisationId, tx);
      if (!existing || existing.deletedAt) {
        throw new ValidationError({
          message: `Widget with ID '${id}' not found`,
          userMessage: "Widget not found",
          correlationId: ctx.correlationId,
        });
      }
      await this.syncGroups.requireActiveMembership(ctx, existing.syncGroupId, tx);

      const updates: Partial<WidgetRecord> = {
        updatedAt: getUtcIsoTimestamp(),
        updatedBy: subject.userId,
      };
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.quantity !== undefined) updates.quantity = input.quantity;
      if (input.description !== undefined) updates.description = input.description;
      await this.repo.update(id, updates, tx);
    });
  }

  async deleteWidget(id: string, ctx: OperationContext | TrustedOperationContext): Promise<void> {
    const subject = extractContextSubject(ctx);
    await this.db.transaction(async (tx) => {
      await this.requirePermission(ctx, WIDGET_PERMISSIONS.DELETE, tx);
      const existing = await this.repo.findByIdWithinOrganisation(id, subject.organisationId, tx);
      if (!existing || existing.deletedAt) return;
      await this.syncGroups.requireActiveMembership(ctx, existing.syncGroupId, tx);
      await this.repo.softDelete(id, subject.userId ?? "system", tx);
    });
  }
}
