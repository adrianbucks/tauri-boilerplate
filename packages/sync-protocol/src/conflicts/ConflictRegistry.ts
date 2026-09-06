import { HybridLogicalClock } from "../hlc/HybridLogicalClock.js";
import type {
  ConflictPolicy,
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
  /**
   * Fields declared as holding absolute values (e.g., stock_count).
   * Absolute fields must use 'lww' — never 'additive'.
   * Key: `${entityType}.${field}`
   */
  private readonly absoluteLwwFields = new Set<string>();

  /**
   * Declares a field as holding an absolute value (e.g., current stock quantity).
   * Absolute fields must use 'lww' semantics. Registering 'additive' on an
   * absolute field will throw, preventing the CS-010 class of error at
   * registration time rather than at conflict resolution time.
   */
  registerAbsoluteLwwField(entityType: string, field: string): void {
    this.absoluteLwwFields.add(`${entityType}.${field}`);
  }

  isAbsoluteLwwField(entityType: string, field: string): boolean {
    return this.absoluteLwwFields.has(`${entityType}.${field}`);
  }

  registerEntityPolicy(entityType: string, policy: ConflictPolicy): void {
    this.entityPolicies.set(entityType, policy);
  }

  /**
   * Registers a conflict policy for a specific field on an entity type.
   *
   * @throws if `policy.strategy === 'additive'` and the field has been
   *   declared as an absolute LWW field via `registerAbsoluteLwwField`.
   */
  registerFieldPolicy(
    entityType: string,
    field: string,
    policy: ConflictPolicy,
  ): void {
    const key = `${entityType}.${field}`;
    if (policy.strategy === "additive" && this.absoluteLwwFields.has(key)) {
      throw new Error(
        `[ConflictRegistry] Cannot register 'additive' strategy for '${key}': ` +
          `this field is declared as an absolute value (use 'lww' instead). ` +
          `Additive semantics are only valid for independent delta values.`,
      );
    }
    this.fieldPolicies.set(key, policy);
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
   * Validates that a registered policy is safe for the given entity/field.
   * Throws if the combination is semantically invalid (CS-010).
   */
  validate(entityType: string, field?: string): void {
    const policy = this.getPolicy(entityType, field);
    if (field && policy.strategy === "additive") {
      const key = `${entityType}.${field}`;
      if (this.absoluteLwwFields.has(key)) {
        throw new Error(
          `[ConflictRegistry] Conflict policy validation failed: ` +
            `'${key}' is an absolute value field but has 'additive' strategy registered. ` +
            `Change strategy to 'lww'.`,
        );
      }
    }
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
        // Guard: must not be an absolute LWW field
        if (input.field) {
          const key = `${input.entityType}.${input.field}`;
          if (this.absoluteLwwFields.has(key)) {
            throw new Error(
              `[ConflictRegistry] Attempted 'additive' resolution on absolute value field '${key}'. ` +
                `This field must use 'lww'. Applying additive semantics to absolute values ` +
                `would corrupt replicated state (CS-010).`,
            );
          }
        }
        // Sum numeric delta values
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
