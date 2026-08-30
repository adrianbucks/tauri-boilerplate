import { HybridLogicalClock } from "../hlc/HybridLogicalClock.js";
import type {
  ConflictPolicy,
  ConflictStrategy,
  ConflictRecord,
} from "../types.js";

export interface ResolveConflictInput {
  entityId: string;
  entityType: string;
  field?: string | undefined;
  localValue: unknown;
  remoteValue: unknown;
  localTimestamp: string;
  remoteTimestamp: string;
}

export type ConflictResolverFn = (input: ResolveConflictInput) => unknown;

export class ConflictRegistry {
  private readonly entityPolicies = new Map<string, ConflictPolicy>();
  private readonly fieldPolicies = new Map<string, ConflictPolicy>(); // key: `${entityType}.${field}`
  private readonly customResolvers = new Map<string, ConflictResolverFn>();

  registerEntityPolicy(entityType: string, policy: ConflictPolicy): void {
    this.entityPolicies.set(entityType, policy);
  }

  registerFieldPolicy(
    entityType: string,
    field: string,
    policy: ConflictPolicy,
  ): void {
    this.fieldPolicies.set(`${entityType}.${field}`, policy);
  }

  registerCustomResolver(name: string, fn: ConflictResolverFn): void {
    this.customResolvers.set(name, fn);
  }

  getPolicy(entityType: string, field?: string): ConflictPolicy {
    if (field) {
      const fieldPolicy = this.fieldPolicies.get(`${entityType}.${field}`);
      if (fieldPolicy) return fieldPolicy;
    }
    const entityPolicy = this.entityPolicies.get(entityType);
    if (entityPolicy) return entityPolicy;

    // Default strategy is LWW
    return { strategy: "lww" };
  }

  /**
   * Resolves a conflict according to the registered policy.
   */
  resolve(input: ResolveConflictInput): {
    winner: "local" | "remote" | "custom" | "manual_required";
    resolvedValue: unknown;
    record: ConflictRecord;
  } {
    const policy = this.getPolicy(input.entityType, input.field);
    const cmp = HybridLogicalClock.compare(
      input.localTimestamp,
      input.remoteTimestamp,
    );

    let winner: "local" | "remote" | "custom" | "manual_required";
    let resolvedValue: unknown;

    switch (policy.strategy) {
      case "lww": {
        // Latest HLC timestamp wins
        if (cmp >= 0) {
          winner = "local";
          resolvedValue = input.localValue;
        } else {
          winner = "remote";
          resolvedValue = input.remoteValue;
        }
        break;
      }
      case "append-only":
      case "immutable": {
        // Once written, local immutable value is preserved
        winner = "local";
        resolvedValue = input.localValue;
        break;
      }
      case "additive": {
        // Sum numeric values
        winner = "custom";
        const numA =
          typeof input.localValue === "number" ? input.localValue : 0;
        const numB =
          typeof input.remoteValue === "number" ? input.remoteValue : 0;
        resolvedValue = numA + numB;
        break;
      }
      case "manual": {
        winner = "manual_required";
        resolvedValue = input.localValue; // Fallback until user decides
        break;
      }
      case "crdt": {
        if (
          policy.customResolverFn &&
          this.customResolvers.has(policy.customResolverFn)
        ) {
          const fn = this.customResolvers.get(policy.customResolverFn)!;
          winner = "custom";
          resolvedValue = fn(input);
        } else {
          // Default LWW for CRDT fallback
          winner = cmp >= 0 ? "local" : "remote";
          resolvedValue = cmp >= 0 ? input.localValue : input.remoteValue;
        }
        break;
      }
    }

    const record: ConflictRecord = {
      entityId: input.entityId,
      entityType: input.entityType,
      field: input.field,
      localValue: input.localValue,
      remoteValue: input.remoteValue,
      localTimestamp: input.localTimestamp,
      remoteTimestamp: input.remoteTimestamp,
      strategy: policy.strategy,
      resolvedValue,
      resolvedAt: new Date().toISOString(),
    };

    return { winner, resolvedValue, record };
  }
}
