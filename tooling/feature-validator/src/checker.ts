/**
 * @file checker.ts
 * @description Cross-checks scanned permission references against a feature's
 * manifest declaration, producing actionable errors for undeclared permissions.
 *
 * This is the enforcement layer of WP-021 (Build-Time Feature Permission
 * Enforcement Gate). It enforces Invariant #2 of the feature system contract:
 * every permission used via the authorization engine MUST be declared in the
 * feature's FeatureManifest.permissions[] array.
 *
 * A missing declaration means the permission can never be granted at runtime —
 * any user calling that code path will receive an AuthorizationError regardless
 * of their role. This is a runtime silent failure that build-time checking
 * catches before deployment.
 */

import type { FeatureManifest } from "@platform/feature-system";
import type { PermissionReference, ScanWarning } from "./scanner.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PermissionCheckError {
  /** The permission string that is used in source but not declared */
  readonly permission: string;
  /** Source file location of the unauthorized reference */
  readonly file: string;
  /** 1-indexed line number */
  readonly line: number;
  /** Human-readable error message */
  readonly message: string;
}

export interface PermissionCheckWarning {
  /** The permission declared in the manifest but never referenced in source */
  readonly permission: string;
  /** Human-readable warning message */
  readonly message: string;
}

export interface PermissionCoverageResult {
  /** True when all source references match manifest declarations */
  readonly valid: boolean;
  /** Undeclared permissions found in source (hard failures) */
  readonly errors: readonly PermissionCheckError[];
  /** Declared permissions not found in any source scan (informational) */
  readonly unusedPermissions: readonly PermissionCheckWarning[];
  /** Scan warnings (template literals, unresolvable references, etc.) */
  readonly scanWarnings: readonly ScanWarning[];
}

// ---------------------------------------------------------------------------
// Main checker
// ---------------------------------------------------------------------------

/**
 * Validates that every permission reference found in `references` is declared
 * in `manifest.permissions[].name`.
 *
 * @param manifest      - The feature manifest containing declared permissions
 * @param references    - Permission references discovered by the scanner
 * @param scanWarnings  - Non-fatal scan warnings to pass through
 */
export function checkPermissionCoverage(
  manifest: FeatureManifest,
  references: readonly PermissionReference[],
  scanWarnings: readonly ScanWarning[],
): PermissionCoverageResult {
  // Build the declared permission set from the manifest
  const declaredPermissions = new Set<string>(manifest.permissions.map((p) => p.name));

  // Find permissions used in source but NOT declared in manifest
  const errors: PermissionCheckError[] = [];
  for (const ref of references) {
    if (!declaredPermissions.has(ref.permission)) {
      errors.push({
        permission: ref.permission,
        file: ref.file,
        line: ref.line,
        message:
          `Feature '${manifest.id}': Permission '${ref.permission}' is used at ` +
          `${relativizePath(ref.file)}:${ref.line} but is NOT declared in the ` +
          `feature manifest. Add it to manifest.permissions[] or remove the call site.`,
      });
    }
  }

  // Find permissions declared in manifest but never referenced in source
  // (these are warnings only — they may be reserved for future use or
  //  used in navigation requiredPermission fields)
  const referencedPermissions = new Set(references.map((r) => r.permission));
  const unusedPermissions: PermissionCheckWarning[] = [];
  for (const declared of declaredPermissions) {
    if (!referencedPermissions.has(declared)) {
      unusedPermissions.push({
        permission: declared,
        message:
          `Feature '${manifest.id}': Permission '${declared}' is declared in ` +
          `the manifest but no authorization call site was found in feature source. ` +
          `This may be intentional (e.g. navigation gates, reserved permissions).`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    unusedPermissions,
    scanWarnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts an absolute file path to a shorter project-relative path for
 * display in error messages.
 */
function relativizePath(absolutePath: string): string {
  // Normalise separators
  const normalised = absolutePath.replace(/\\/g, "/");

  // Strip everything up to and including "features/"
  const featuresIdx = normalised.lastIndexOf("/features/");
  if (featuresIdx !== -1) {
    return normalised.slice(featuresIdx + 1); // "features/foo/src/..."
  }

  // Fallback: just the last 3 path segments
  const parts = normalised.split("/");
  return parts.slice(-3).join("/");
}
