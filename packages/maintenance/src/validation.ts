import { ValidationError } from "@platform/core";
import type { PruningContext } from "./types.js";

/** Enforce safe bounds even when a handler is invoked outside the orchestrator. */
export function validatePruningContext(context: PruningContext): void {
  if (!Number.isSafeInteger(context.batchSize) || context.batchSize <= 0) {
    throw new ValidationError({
      message: `Pruning batch size must be a positive safe integer; received ${context.batchSize}`,
      userMessage: "The maintenance batch size is invalid.",
      correlationId: "maintenance_batch_size",
    });
  }

  if (!(context.cutoffDate instanceof Date) || !Number.isFinite(context.cutoffDate.getTime())) {
    throw new ValidationError({
      message: "Pruning cutoffDate must be a valid Date.",
      userMessage: "The maintenance cutoff date is invalid.",
      correlationId: "maintenance_cutoff_date",
    });
  }
}
