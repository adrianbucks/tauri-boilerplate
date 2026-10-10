import { isSafePruningFilterCondition, ValidationError } from "@platform/core";
import type { FeatureManifest } from "./FeatureManifest.js";

export class ManifestValidator {
  private static readonly ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  private static readonly PERMISSION_REGEX = /^[a-z0-9_-]+\.[a-z0-9_.-]+$/;
  private static readonly SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  private static readonly SYNC_NAMESPACE_SEGMENT_REGEX =
    /^(?:\{(?:application|organisation|syncGroup)\}|[a-zA-Z0-9_-]+)$/;
  private static readonly CONFLICT_STRATEGIES = new Set([
    "lww",
    "append-only",
    "additive",
    "manual",
    "immutable",
    "crdt",
  ]);

  private static invalidShape(field: string, featureId = "unknown"): never {
    throw new ValidationError({
      message: `Feature manifest '${featureId}' has an invalid or missing '${field}' field.`,
      userMessage: "Invalid feature configuration",
      correlationId: `val_feat_shape_${featureId}`,
    });
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private static isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }

  private static validateStructure(value: unknown): asserts value is FeatureManifest {
    if (!this.isRecord(value)) this.invalidShape("manifest");
    const featureId = typeof value.id === "string" ? value.id : "unknown";

    if (typeof value.name !== "string" || value.name.trim().length === 0) {
      this.invalidShape("name", featureId);
    }
    if (!this.isStringArray(value.dependencies)) this.invalidShape("dependencies", featureId);
    if (
      value.optionalDependencies !== undefined &&
      !this.isStringArray(value.optionalDependencies)
    ) {
      this.invalidShape("optionalDependencies", featureId);
    }

    if (!Array.isArray(value.permissions)) this.invalidShape("permissions", featureId);
    for (const permission of value.permissions) {
      if (
        !this.isRecord(permission) ||
        typeof permission.name !== "string" ||
        typeof permission.description !== "string"
      ) {
        this.invalidShape("permissions[]", featureId);
      }
    }

    if (!Array.isArray(value.migrations)) this.invalidShape("migrations", featureId);
    for (const migration of value.migrations) {
      if (
        !this.isRecord(migration) ||
        typeof migration.name !== "string" ||
        typeof migration.sql !== "string" ||
        typeof migration.checksum !== "string" ||
        typeof migration.version !== "number"
      ) {
        this.invalidShape("migrations[]", featureId);
      }
    }

    if (value.syncPolicies !== undefined) {
      if (!Array.isArray(value.syncPolicies)) this.invalidShape("syncPolicies", featureId);
      for (const policy of value.syncPolicies) {
        if (
          !this.isRecord(policy) ||
          typeof policy.entityType !== "string" ||
          typeof policy.namespacePattern !== "string" ||
          typeof policy.syncable !== "boolean" ||
          !this.isRecord(policy.conflictPolicy) ||
          typeof policy.conflictPolicy.strategy !== "string"
        ) {
          this.invalidShape("syncPolicies[]", featureId);
        }
      }
    }

    if (value.pruningPolicies !== undefined) {
      if (!Array.isArray(value.pruningPolicies)) this.invalidShape("pruningPolicies", featureId);
      for (const policy of value.pruningPolicies) {
        if (
          !this.isRecord(policy) ||
          typeof policy.id !== "string" ||
          typeof policy.displayName !== "string" ||
          typeof policy.tableName !== "string" ||
          typeof policy.timestampColumn !== "string" ||
          typeof policy.defaultRetentionDays !== "number" ||
          (policy.filterCondition !== undefined && typeof policy.filterCondition !== "string")
        ) {
          this.invalidShape("pruningPolicies[]", featureId);
        }
      }
    }

    if (value.navigation !== undefined) {
      if (!Array.isArray(value.navigation)) this.invalidShape("navigation", featureId);
      for (const item of value.navigation) {
        if (
          !this.isRecord(item) ||
          typeof item.id !== "string" ||
          typeof item.label !== "string" ||
          typeof item.path !== "string" ||
          (item.icon !== undefined && typeof item.icon !== "string") ||
          (item.requiredPermission !== undefined && typeof item.requiredPermission !== "string") ||
          (item.order !== undefined && typeof item.order !== "number")
        ) {
          this.invalidShape("navigation[]", featureId);
        }
      }
    }

    if (value.description !== undefined && typeof value.description !== "string") {
      this.invalidShape("description", featureId);
    }
  }

  static validate(manifest: FeatureManifest): void {
    this.validateStructure(manifest);

    // Validate ID
    if (!manifest.id || !this.ID_REGEX.test(manifest.id)) {
      throw new ValidationError({
        message: `Feature manifest ID '${manifest.id}' is invalid. It must be lowercase kebab-case (e.g. 'inventory-tracking').`,
        userMessage: "Invalid feature configuration",
        correlationId: `val_feat_${manifest.id || "unknown"}`,
      });
    }

    // Validate Version
    if (!manifest.version || !this.SEMVER_REGEX.test(manifest.version)) {
      throw new ValidationError({
        message: `Feature manifest version '${manifest.version}' for '${manifest.id}' is not a valid Semantic Version (e.g. '1.0.0').`,
        userMessage: "Invalid feature version",
        correlationId: `val_feat_${manifest.id}`,
      });
    }

    // Validate Permissions
    for (const perm of manifest.permissions) {
      if (!this.PERMISSION_REGEX.test(perm.name)) {
        throw new ValidationError({
          message: `Permission '${perm.name}' in feature '${manifest.id}' must follow hierarchical dot-notation (e.g. 'inventory.read').`,
          userMessage: "Invalid permission definition",
          correlationId: `val_perm_${manifest.id}`,
        });
      }
    }

    // Validate Migration Versions (unique and positive)
    const seenVersions = new Set<number>();
    for (const mig of manifest.migrations) {
      if (!Number.isSafeInteger(mig.version) || mig.version <= 0) {
        throw new ValidationError({
          message: `Migration '${mig.name}' in feature '${manifest.id}' has an invalid version ${mig.version}. Versions must be positive integers.`,
          userMessage: "Invalid migration version",
          correlationId: `val_mig_${manifest.id}`,
        });
      }
      if (seenVersions.has(mig.version)) {
        throw new ValidationError({
          message: `Duplicate migration version ${mig.version} detected in feature '${manifest.id}'.`,
          userMessage: "Duplicate migration version in feature",
          correlationId: `val_mig_${manifest.id}`,
        });
      }
      seenVersions.add(mig.version);
    }

    // Validate sync policy declarations at the manifest boundary. Invalid
    // policy metadata must not enter the registry and later reach sync setup.
    if (manifest.syncPolicies) {
      const seenEntityTypes = new Set<string>();
      for (const policy of manifest.syncPolicies) {
        if (!/^[a-z][a-z0-9_]*$/.test(policy.entityType)) {
          throw new ValidationError({
            message: `Sync policy in feature '${manifest.id}' has invalid entityType '${policy.entityType}'.`,
            userMessage: "Invalid sync policy entity type",
            correlationId: `val_sync_${manifest.id}`,
          });
        }
        if (seenEntityTypes.has(policy.entityType)) {
          throw new ValidationError({
            message: `Duplicate sync policy entityType '${policy.entityType}' in feature '${manifest.id}'.`,
            userMessage: "Duplicate sync policy",
            correlationId: `val_sync_${manifest.id}`,
          });
        }
        seenEntityTypes.add(policy.entityType);

        const segments = policy.namespacePattern.split("/");
        const requiredSegments = ["{application}", "{organisation}", "{syncGroup}"];
        if (
          segments.some((segment) => !this.SYNC_NAMESPACE_SEGMENT_REGEX.test(segment)) ||
          requiredSegments.some((required) => !segments.includes(required))
        ) {
          throw new ValidationError({
            message: `Sync policy '${policy.entityType}' in feature '${manifest.id}' must use safe path segments and include ${requiredSegments.join(", ")}.`,
            userMessage: "Invalid sync namespace pattern",
            correlationId: `val_sync_${manifest.id}`,
          });
        }

        if (
          !policy.conflictPolicy ||
          typeof policy.conflictPolicy.strategy !== "string" ||
          !this.CONFLICT_STRATEGIES.has(policy.conflictPolicy.strategy)
        ) {
          throw new ValidationError({
            message: `Sync policy '${policy.entityType}' in feature '${manifest.id}' has an unsupported conflict strategy.`,
            userMessage: "Invalid sync conflict strategy",
            correlationId: `val_sync_${manifest.id}`,
          });
        }
        if (typeof policy.syncable !== "boolean") {
          throw new ValidationError({
            message: `Sync policy '${policy.entityType}' in feature '${manifest.id}' must declare syncable as a boolean.`,
            userMessage: "Invalid sync policy declaration",
            correlationId: `val_sync_${manifest.id}`,
          });
        }
      }
    }

    // Validate Pruning Policies
    if (manifest.pruningPolicies) {
      const IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;
      const seenPolicyIds = new Set<string>();

      for (const policy of manifest.pruningPolicies) {
        if (!policy.id) {
          throw new ValidationError({
            message: `Pruning policy in feature '${manifest.id}' must have a valid non-empty id.`,
            userMessage: "Invalid pruning policy configuration",
            correlationId: `val_prune_${manifest.id}`,
          });
        }
        if (seenPolicyIds.has(policy.id)) {
          throw new ValidationError({
            message: `Duplicate pruning policy id '${policy.id}' in feature '${manifest.id}'.`,
            userMessage: "Duplicate pruning policy in feature",
            correlationId: `val_prune_${manifest.id}`,
          });
        }
        seenPolicyIds.add(policy.id);

        if (!IDENTIFIER_REGEX.test(policy.tableName)) {
          throw new ValidationError({
            message: `Pruning policy '${policy.id}' in feature '${manifest.id}' has invalid tableName '${policy.tableName}'.`,
            userMessage: "Invalid pruning policy table",
            correlationId: `val_prune_${manifest.id}`,
          });
        }

        if (!IDENTIFIER_REGEX.test(policy.timestampColumn)) {
          throw new ValidationError({
            message: `Pruning policy '${policy.id}' in feature '${manifest.id}' has invalid timestampColumn '${policy.timestampColumn}'.`,
            userMessage: "Invalid pruning policy timestamp column",
            correlationId: `val_prune_${manifest.id}`,
          });
        }

        if (!Number.isFinite(policy.defaultRetentionDays) || policy.defaultRetentionDays <= 0) {
          throw new ValidationError({
            message: `Pruning policy '${policy.id}' in feature '${manifest.id}' must have a positive finite defaultRetentionDays (got ${policy.defaultRetentionDays}).`,
            userMessage: "Invalid pruning policy retention days",
            correlationId: `val_prune_${manifest.id}`,
          });
        }

        if (policy.filterCondition && !isSafePruningFilterCondition(policy.filterCondition)) {
          throw new ValidationError({
            message: `Pruning policy '${policy.id}' in feature '${manifest.id}' has an unsafe filterCondition. Use a single column comparison with a literal value.`,
            userMessage: "Invalid pruning policy filter",
            correlationId: `val_prune_filter_${manifest.id}`,
          });
        }
      }
    }
  }
}
