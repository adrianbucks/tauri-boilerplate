import { ValidationError } from "@platform/core";
import type { DeclarativePruningPolicy, PruningHandler } from "../types.js";
import { DeclarativeTablePruner } from "../handlers/DeclarativeTablePruner.js";
import { SyncOutboxPruner } from "../handlers/SyncOutboxPruner.js";
import { SyncInboxPruner } from "../handlers/SyncInboxPruner.js";
import { BackgroundTasksPruner } from "../handlers/BackgroundTasksPruner.js";
import { AuditEventsPruner } from "../handlers/AuditEventsPruner.js";
import { ReplicatedTombstonePruner } from "../handlers/ReplicatedTombstonePruner.js";

export interface MaintenanceRegistryOptions {
  includeCoreDefaults?: boolean | undefined;
}

export class MaintenanceRegistry {
  private readonly handlers = new Map<string, PruningHandler>();

  constructor(options?: MaintenanceRegistryOptions) {
    if (options?.includeCoreDefaults) {
      this.registerCoreDefaults();
    }
  }

  registerHandler(handler: PruningHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new ValidationError({
        message: `Pruning handler with id '${handler.id}' is already registered.`,
        userMessage: "Duplicate pruning handler registration",
        correlationId: `prune_handler_dup_${handler.id}`,
      });
    }
    this.handlers.set(handler.id, handler);
  }

  registerPolicy(policy: DeclarativePruningPolicy): void {
    const pruner = new DeclarativeTablePruner(policy);
    this.registerHandler(pruner);
  }

  getHandler(id: string): PruningHandler | undefined {
    return this.handlers.get(id);
  }

  getAllHandlers(): PruningHandler[] {
    return Array.from(this.handlers.values());
  }

  hasHandler(id: string): boolean {
    return this.handlers.has(id);
  }

  unregisterHandler(id: string): boolean {
    return this.handlers.delete(id);
  }

  registerCoreDefaults(): void {
    const coreHandlers: PruningHandler[] = [
      new SyncOutboxPruner(),
      new SyncInboxPruner(),
      new BackgroundTasksPruner(),
      new AuditEventsPruner(),
      new ReplicatedTombstonePruner(),
    ];

    for (const h of coreHandlers) {
      if (!this.handlers.has(h.id)) {
        this.handlers.set(h.id, h);
      }
    }
  }
}
