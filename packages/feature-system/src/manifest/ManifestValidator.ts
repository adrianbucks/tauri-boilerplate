import { ValidationError } from "@platform/core";
import type { FeatureManifest } from "./FeatureManifest.js";

export class ManifestValidator {
  private static readonly ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  private static readonly PERMISSION_REGEX = /^[a-z0-9_-]+\.[a-z0-9_.-]+$/;
  private static readonly SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

  static validate(manifest: FeatureManifest): void {
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
      if (mig.version <= 0) {
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
  }
}
