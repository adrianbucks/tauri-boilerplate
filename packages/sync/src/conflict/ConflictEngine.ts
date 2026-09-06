import { ConflictError, generateCorrelationId } from "@platform/core";
import {
  HybridLogicalClock,
  type ConflictPolicy,
  type ConflictRegistry,
  type SyncEnvelope,
} from "@platform/sync-protocol";

export type ResolutionWinner =
  | "local"
  | "remote"
  | "merge"
  | "manual_required";

export interface ConflictResolutionResult {
  readonly winner: ResolutionWinner;
  readonly resolvedEnvelope: SyncEnvelope | null;
  readonly reason: string;
}

/**
 * Deterministic conflict resolution engine for synchronised entities.
 *
 * Implements LWW (Hybrid Logical Clock), append-only, additive (delta-only),
 * immutable, and manual resolution strategies. Enforces CS-010 invariant:
 * additive strategy cannot be applied to absolute value fields.
 */
export class ConflictEngine {
  private readonly registry?: ConflictRegistry | undefined;

  constructor(registry?: ConflictRegistry) {
    this.registry = registry;
  }

  /**
   * Resolves a conflict between a local and remote SyncEnvelope according to the policy.
   *
   * @param policy - The conflict strategy to apply.
   * @param localEnvelope - The existing local operation envelope.
   * @param remoteEnvelope - The newly received remote operation envelope.
   * @param field - Optional field name if resolving field-level conflict.
   */
  resolve(
    policy: ConflictPolicy,
    localEnvelope: SyncEnvelope,
    remoteEnvelope: SyncEnvelope,
    field?: string,
  ): ConflictResolutionResult {
    const entityType = localEnvelope.operation.entityType;

    // CS-010 Guard: If additive strategy is attempted, verify against registry
    if (policy.strategy === "additive") {
      if (this.registry && field && this.registry.isAbsoluteLwwField(entityType, field)) {
        throw new ConflictError({
          message: `Attempted 'additive' conflict resolution on absolute value field '${entityType}.${field}'. This field is declared as absolute and must use 'lww' (CS-010).`,
          userMessage:
            "Cannot apply additive conflict resolution to an absolute value field.",
          correlationId: generateCorrelationId("conflict"),
          technicalDetails: `entityType=${entityType}, field=${field}`,
        });
      }
      if (this.registry) {
        try {
          this.registry.validate(entityType, field);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new ConflictError({
            message: `Additive conflict resolution forbidden: ${msg}`,
            userMessage:
              "Cannot apply additive conflict resolution to an absolute value field.",
            correlationId: generateCorrelationId("conflict"),
            technicalDetails: `entityType=${entityType}, field=${field ?? "none"}`,
          });
        }
      }
    }

    switch (policy.strategy) {
      case "lww": {
        const cmp = HybridLogicalClock.compare(
          localEnvelope.operation.logicalTimestamp,
          remoteEnvelope.operation.logicalTimestamp,
        );

        if (cmp >= 0) {
          return {
            winner: "local",
            resolvedEnvelope: localEnvelope,
            reason: `Local HLC (${localEnvelope.operation.logicalTimestamp}) is newer or equal to remote HLC (${remoteEnvelope.operation.logicalTimestamp})`,
          };
        } else {
          return {
            winner: "remote",
            resolvedEnvelope: remoteEnvelope,
            reason: `Remote HLC (${remoteEnvelope.operation.logicalTimestamp}) is newer than local HLC (${localEnvelope.operation.logicalTimestamp})`,
          };
        }
      }

      case "append-only": {
        // Append-only logs accept incoming remote records
        return {
          winner: "remote",
          resolvedEnvelope: remoteEnvelope,
          reason: "Append-only strategy accepts remote entry into replication log",
        };
      }

      case "immutable": {
        // Once written, immutable entities cannot be overwritten by remote updates
        return {
          winner: "local",
          resolvedEnvelope: localEnvelope,
          reason: "Immutable strategy rejects remote updates to existing entity",
        };
      }

      case "manual": {
        return {
          winner: "manual_required",
          resolvedEnvelope: null,
          reason: "Manual conflict resolution required for this entity/field",
        };
      }

      case "additive": {
        // Merge numeric delta payloads if both are numeric objects or numbers
        const localPayload = localEnvelope.operation.payload;
        const remotePayload = remoteEnvelope.operation.payload;

        let mergedPayload: unknown;
        if (typeof localPayload === "number" && typeof remotePayload === "number") {
          mergedPayload = localPayload + remotePayload;
        } else if (
          typeof localPayload === "object" &&
          localPayload !== null &&
          typeof remotePayload === "object" &&
          remotePayload !== null &&
          field
        ) {
          const localObj = localPayload as Record<string, unknown>;
          const remoteObj = remotePayload as Record<string, unknown>;
          const valA = typeof localObj[field] === "number" ? (localObj[field] as number) : 0;
          const valB = typeof remoteObj[field] === "number" ? (remoteObj[field] as number) : 0;
          mergedPayload = {
            ...localObj,
            ...remoteObj,
            [field]: valA + valB,
          };
        } else {
          mergedPayload = remotePayload;
        }

        const mergedEnvelope: SyncEnvelope = {
          ...remoteEnvelope,
          operation: {
            ...remoteEnvelope.operation,
            payload: mergedPayload,
          },
        };

        return {
          winner: "merge",
          resolvedEnvelope: mergedEnvelope,
          reason: "Additive delta merged successfully",
        };
      }

      case "crdt": {
        const cmp = HybridLogicalClock.compare(
          localEnvelope.operation.logicalTimestamp,
          remoteEnvelope.operation.logicalTimestamp,
        );
        const winner = cmp >= 0 ? "local" : "remote";
        return {
          winner,
          resolvedEnvelope: cmp >= 0 ? localEnvelope : remoteEnvelope,
          reason: "CRDT fallback using HLC LWW ordering",
        };
      }

      default: {
        return {
          winner: "local",
          resolvedEnvelope: localEnvelope,
          reason: `Unknown strategy: ${String(policy.strategy)}, defaulting to local`,
        };
      }
    }
  }
}
