/**
 * @file cli.ts
 * @description CLI entry point for the Feature Manifest & Permission Validator.
 *
 * WP-021: Build-Time Feature Permission Enforcement Gate
 *
 * Usage:
 *   pnpm feature-validate
 *   tsx src/cli.ts --features ../../features
 *   tsx src/cli.ts --features ../../features --verbose
 *
 * Exit codes:
 *   0  All features pass validation (manifest schema, dependency order,
 *      and source-level permission coverage)
 *   1  One or more features have undeclared permission references or
 *      manifest validation errors
 *
 * This CLI is invoked by `pnpm turbo feature-validate` in CI and by
 * developers running `pnpm feature-validate` locally before opening a PR.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  ManifestValidator,
  DependencyResolver,
} from "@platform/feature-system";
import type { FeatureManifest } from "@platform/feature-system";
import {
  scanFeaturePermissions,
  buildPermissionConstantMap,
} from "./scanner.js";
import { checkPermissionCoverage } from "./checker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// ANSI colour helpers (keep dependency-free)
// ---------------------------------------------------------------------------

const isCI = process.env.CI === "true";
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function colour(code: string, text: string): string {
  return isCI ? text : `${code}${text}${c.reset}`;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { featuresDir: string; verbose: boolean } {
  let featuresDir = path.resolve(__dirname, "../../features");
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--features" && argv[i + 1]) {
      const nextArg = argv[++i];
      if (nextArg) {
        featuresDir = path.resolve(nextArg);
      }
    } else if (argv[i] === "--verbose" || argv[i] === "-v") {
      verbose = true;
    }
  }

  return { featuresDir, verbose };
}

// ---------------------------------------------------------------------------
// Feature discovery
// ---------------------------------------------------------------------------

interface DiscoveredFeature {
  id: string;
  manifest: FeatureManifest;
  srcDir: string;
  packageName: string;
}

async function discoverFeatures(
  featuresDir: string,
): Promise<DiscoveredFeature[]> {
  if (!fs.existsSync(featuresDir)) {
    console.error(
      colour(c.red, `✖ Features directory not found: ${featuresDir}`),
    );
    process.exit(1);
  }

  const featureDirs = fs
    .readdirSync(featuresDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(featuresDir, e.name));

  const discovered: DiscoveredFeature[] = [];

  for (const featureDir of featureDirs) {
    const srcDir = path.join(featureDir, "src");
    const indexPath = path.join(srcDir, "index.ts");
    const manifestPath = path.join(srcDir, "manifest.ts");

    if (!fs.existsSync(manifestPath)) {
      // Not all directories are features — silently skip non-feature dirs
      continue;
    }

    try {
      // Dynamically import the manifest from the compiled JS output if available.
      const candidatePaths = [
        path.join(featureDir, "dist", "src", "manifest.js"),
        path.join(featureDir, "dist", "manifest.js"),
        path.join(featureDir, "dist", "src", "index.js"),
        path.join(featureDir, "dist", "index.js"),
      ];

      let manifest: FeatureManifest | null = null;

      for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
          try {
            const fileUrl = pathToFileURL(candidate).href;
            const mod = (await import(fileUrl)) as Record<string, unknown>;
            manifest = findManifestExport(mod);
            if (manifest) break;
          } catch {
            // try next candidate
          }
        }
      }

      if (!manifest) {
        // Fallback: read manifest.ts statically with AST to extract feature ID and permissions
        manifest = parseManifestStatically(manifestPath, srcDir);
      }

      if (!manifest) {
        console.warn(
          colour(
            c.yellow,
            `  ⚠ Could not load manifest from ${featureDir}. Run 'pnpm build' first.`,
          ),
        );
        continue;
      }

      const pkgJsonPath = path.join(featureDir, "package.json");
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
        name: string;
      };

      discovered.push({
        id: manifest.id,
        manifest,
        srcDir,
        packageName: pkgJson.name,
      });
    } catch (err) {
      console.warn(
        colour(
          c.yellow,
          `  ⚠ Skipped ${featureDir}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Manifest extraction helpers
// ---------------------------------------------------------------------------

function findManifestExport(
  mod: Record<string, unknown>,
): FeatureManifest | null {
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (isFeatureManifest(val)) return val;
  }
  return null;
}

function isFeatureManifest(val: unknown): val is FeatureManifest {
  return (
    typeof val === "object" &&
    val !== null &&
    typeof (val as Record<string, unknown>)["id"] === "string" &&
    Array.isArray((val as Record<string, unknown>)["permissions"]) &&
    Array.isArray((val as Record<string, unknown>)["migrations"])
  );
}

/**
 * Parses the manifest statically from its TypeScript source when no compiled
 * output is available or import fails. Uses TypeScript AST and constant resolution.
 */
function parseManifestStatically(
  manifestPath: string,
  srcDir: string,
): FeatureManifest | null {
  try {
    const source = fs.readFileSync(manifestPath, "utf8");
    const sourceFile = ts.createSourceFile(
      manifestPath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );

    // Find all .ts files in srcDir to build constant map
    const sourceFiles: string[] = [];
    function collectTsFiles(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectTsFiles(full);
        else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ) {
          sourceFiles.push(full);
        }
      }
    }
    collectTsFiles(srcDir);
    const constantMap = buildPermissionConstantMap(srcDir, sourceFiles);

    let featureId = "";
    const permissions: Array<{ name: string; description: string }> = [];

    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        if (
          node.name.text === "id" &&
          ts.isStringLiteral(node.initializer) &&
          !featureId
        ) {
          featureId = node.initializer.text;
        }
        if (
          node.name.text === "permissions" &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          for (const elem of node.initializer.elements) {
            if (ts.isObjectLiteralExpression(elem)) {
              for (const prop of elem.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === "name"
                ) {
                  if (ts.isStringLiteral(prop.initializer)) {
                    permissions.push({
                      name: prop.initializer.text,
                      description: "",
                    });
                  } else if (ts.isPropertyAccessExpression(prop.initializer)) {
                    const objName = ts.isIdentifier(prop.initializer.expression)
                      ? prop.initializer.expression.text
                      : "";
                    const propName = prop.initializer.name.text;
                    const resolved = constantMap.get(`${objName}.${propName}`);
                    if (resolved) {
                      permissions.push({ name: resolved, description: "" });
                    }
                  }
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    if (!featureId) return null;

    return {
      id: featureId,
      name: featureId,
      version: "0.0.0",
      description: "",
      dependencies: [],
      permissions,
      migrations: [],
    } as FeatureManifest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main validation runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { featuresDir, verbose } = parseArgs(argv);

  console.log(colour(c.bold, "\n🔍 Feature Manifest & Permission Validator"));
  console.log(
    colour(c.dim, `   WP-021 — Build-Time Feature Permission Enforcement Gate`),
  );
  console.log(colour(c.dim, `   Features directory: ${featuresDir}\n`));

  // -------------------------------------------------------------------
  // 1. Discover features
  // -------------------------------------------------------------------
  const features = await discoverFeatures(featuresDir);

  if (features.length === 0) {
    console.log(
      colour(c.yellow, "⚠  No features discovered. Nothing to validate."),
    );
    process.exit(0);
  }

  console.log(
    colour(
      c.dim,
      `   Found ${features.length} feature(s): ${features.map((f) => f.id).join(", ")}\n`,
    ),
  );

  // -------------------------------------------------------------------
  // 2. Manifest schema & dependency validation
  // -------------------------------------------------------------------
  console.log(
    colour(c.bold, "Phase 1: Manifest schema & dependency validation"),
  );
  let manifestErrors = 0;

  for (const feature of features) {
    try {
      ManifestValidator.validate(feature.manifest);
      console.log(colour(c.green, `  ✔ ${feature.id} — manifest schema valid`));
    } catch (err) {
      console.error(
        colour(
          c.red,
          `  ✖ ${feature.id} — manifest schema invalid: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      manifestErrors++;
    }
  }

  try {
    const manifests = features.map((f) => f.manifest);
    const resolved = DependencyResolver.resolve(manifests);
    const order = resolved.orderedManifests.map((m) => m.id).join(" → ");
    console.log(colour(c.green, `  ✔ Dependency order valid: ${order}`));
  } catch (err) {
    console.error(
      colour(
        c.red,
        `  ✖ Dependency resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    manifestErrors++;
  }

  // -------------------------------------------------------------------
  // 3. Source-level permission coverage scan
  // -------------------------------------------------------------------
  console.log(
    colour(c.bold, "\nPhase 2: Source-level permission coverage scan"),
  );
  let coverageErrors = 0;
  let totalWarnings = 0;

  for (const feature of features) {
    console.log(
      colour(c.cyan, `\n  Feature: ${feature.id} (${feature.packageName})`),
    );
    console.log(colour(c.dim, `  Source:  ${feature.srcDir}`));

    const scanResult = scanFeaturePermissions(feature.srcDir);
    const checkResult = checkPermissionCoverage(
      feature.manifest,
      scanResult.references,
      scanResult.warnings,
    );

    // Print scan warnings (template literals, unresolvable references)
    for (const warning of checkResult.scanWarnings) {
      totalWarnings++;
      console.warn(
        colour(c.yellow, `  ⚠ [scan-warning] ${warning.file}:${warning.line}`),
      );
      console.warn(colour(c.dim, `      ${warning.message}`));
    }

    if (verbose) {
      // Print all resolved permission references
      for (const ref of scanResult.references) {
        console.log(
          colour(
            c.dim,
            `  → '${ref.permission}' at ${shortPath(ref.file)}:${ref.line} (${ref.resolution})`,
          ),
        );
      }
    }

    // Print unused declared permissions (informational)
    for (const unused of checkResult.unusedPermissions) {
      if (verbose) {
        console.log(colour(c.dim, `  ℹ [unused] ${unused.permission}`));
      }
    }

    // Print undeclared permission ERRORS (hard failures)
    for (const error of checkResult.errors) {
      coverageErrors++;
      console.error(colour(c.red, `\n  ✖ UNDECLARED PERMISSION`));
      console.error(colour(c.red, `      ${error.message}`));
    }

    if (checkResult.valid) {
      const count = scanResult.references.length;
      const declaredCount = feature.manifest.permissions.length;
      console.log(
        colour(
          c.green,
          `  ✔ ${feature.id} — ${count} reference(s) found, ${declaredCount} permission(s) declared — coverage OK`,
        ),
      );
    }
  }

  // -------------------------------------------------------------------
  // 4. Summary
  // -------------------------------------------------------------------
  console.log(
    colour(c.bold, "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
  );

  const totalErrors = manifestErrors + coverageErrors;

  if (totalErrors === 0) {
    console.log(
      colour(
        c.green,
        `\n✅ All ${features.length} feature(s) passed validation.`,
      ),
    );
    if (totalWarnings > 0) {
      console.log(
        colour(
          c.yellow,
          `   ${totalWarnings} scan warning(s) — review template literal and unresolvable permission references.`,
        ),
      );
    }
    console.log();
    process.exit(0);
  } else {
    console.error(
      colour(
        c.red,
        `\n✖ Validation failed: ${totalErrors} error(s) found across ${features.length} feature(s).`,
      ),
    );
    if (manifestErrors > 0) {
      console.error(
        colour(
          c.red,
          `   • ${manifestErrors} manifest schema/dependency error(s)`,
        ),
      );
    }
    if (coverageErrors > 0) {
      console.error(
        colour(
          c.red,
          `   • ${coverageErrors} undeclared permission reference(s)`,
        ),
      );
      console.error(
        colour(
          c.dim,
          `\n   Fix: Add the missing permission(s) to manifest.permissions[],`,
        ),
      );
      console.error(
        colour(
          c.dim,
          `   or remove the call site if the permission is no longer needed.\n`,
        ),
      );
    }
    console.log();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortPath(p: string): string {
  const normalised = p.replace(/\\/g, "/");
  const parts = normalised.split("/");
  // Return last 3 segments for readability
  return parts.slice(-3).join("/");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  console.error(
    colour(
      c.red,
      `\n✖ Unexpected validator error: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
  process.exit(1);
});
