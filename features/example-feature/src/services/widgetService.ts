import {
  ValidationError,
  getUtcIsoTimestamp,
  generateCorrelationId,
  type OperationContext,
} from "@platform/core";
import type { DatabaseConnection } from "@platform/database";
import { WidgetRepository } from "../repositories/widgetRepository.js";
import type { WidgetRecord } from "../schema/widgets.js";

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

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.repo = new WidgetRepository(db);
  }

  async createWidget(
    input: CreateWidgetInput,
    ctx: OperationContext,
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

    const normalizedSku = input.sku.trim().toUpperCase();

    // 2. Transaction execution
    return this.db.transaction(async (tx) => {
      const existing = await this.repo.findBySku(normalizedSku, tx);
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
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        entityId: id,
        organisationId: ctx.organisationId,
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

      await this.repo.insert(record, tx);
      return record;
    });
  }

  async getWidgetById(id: string): Promise<WidgetRecord | null> {
    return this.repo.findById(id);
  }

  async listWidgets(syncGroupId: string): Promise<WidgetRecord[]> {
    return this.repo.findBySyncGroup(syncGroupId);
  }

  async updateWidget(
    id: string,
    input: UpdateWidgetInput,
    ctx: OperationContext,
  ): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.deletedAt) {
      throw new ValidationError({
        message: `Widget with ID '${id}' not found`,
        userMessage: "Widget not found",
        correlationId: ctx.correlationId,
      });
    }

    const updates: Partial<WidgetRecord> = {
      updatedAt: getUtcIsoTimestamp(),
      updatedBy: ctx.userId,
    };

    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.quantity !== undefined) {
      if (input.quantity < 0) {
        throw new ValidationError({
          message: "Quantity cannot be negative",
          userMessage: "Quantity must be zero or positive",
          correlationId: ctx.correlationId,
        });
      }
      updates.quantity = input.quantity;
    }
    if (input.description !== undefined)
      updates.description = input.description;

    await this.repo.update(id, updates);
  }

  async deleteWidget(id: string, ctx: OperationContext): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.deletedAt) {
      return;
    }
    await this.repo.softDelete(id, ctx.userId ?? "system");
  }
}
