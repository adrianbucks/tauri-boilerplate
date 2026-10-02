/**
 * @file index.ts
 * @description Public API for @tooling/feature-validator.
 *
 * Exports manifest validation utilities (existing) and the new WP-021
 * source-level permission scanner and cross-checker for use in tests
 * and programmatic invocations.
 *
 * For CLI usage, see src/cli.ts (invoked via `pnpm feature-validate`).
 */

// Re-export existing manifest validation (schema + dependency resolution)
export {
  ManifestValidator,
  DependencyResolver,
  type FeatureManifest,
} from "@platform/feature-system";

// WP-021: Source-level permission scanner
export {
  scanFeaturePermissions,
  type PermissionReference,
  type ScanWarning,
  type ScanResult,
} from "./scanner.js";

// WP-021: Permission coverage checker (scanner results vs manifest)
export {
  checkPermissionCoverage,
  type PermissionCheckError,
  type PermissionCheckWarning,
  type PermissionCoverageResult,
} from "./checker.js";

// ---------------------------------------------------------------------------
// Convenience function — validates a set of manifests (schema + dependency)
// Kept for backward compatibility with callers of the original index.ts
// ---------------------------------------------------------------------------

import {
  ManifestValidator,
  DependencyResolver,
  type FeatureManifest,
} from "@platform/feature-system";

export function validateManifests(manifests: FeatureManifest[]): {
  valid: boolean;
  message: string;
} {
  try {
    for (const manifest of manifests) {
      ManifestValidator.validate(manifest);
    }
    const resolved = DependencyResolver.resolve(manifests);
    return {
      valid: true,
      message: `Successfully validated ${manifests.length} features. Dependency load order: ${resolved.orderedManifests.map((m) => m.id).join(" -> ")}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
