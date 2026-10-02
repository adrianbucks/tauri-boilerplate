/**
 * @file scanner.ts
 * @description Build-time source scanner for feature permission references.
 *
 * Walks all TypeScript/TSX files in a feature's src/ directory and extracts
 * every permission string literal passed to the authorization engine's
 * can(), require(), and requireTrusted() methods.
 *
 * This enables build-time verification that every permission used in feature
 * source code is declared in the feature's FeatureManifest.permissions[] array.
 *
 * SCANNING STRATEGY
 * -----------------
 * The scanner uses the TypeScript Compiler API for reliable AST traversal.
 * It identifies call expressions of the following forms:
 *
 *   auth.can(subject, 'permission.name', ...)
 *   auth.require(subject, 'permission.name', ...)
 *   auth.requireTrusted(ctx, 'permission.name', ...)
 *   this.auth.can(subject, 'permission.name', ...)
 *   this.auth.require(subject, 'permission.name', ...)
 *   this.auth.requireTrusted(ctx, 'permission.name', ...)
 *   this.requirePermission(ctx, PERM_CONSTANT, ...)
 *
 * Because permissions are typically passed via named constants (e.g.
 * WIDGET_PERMISSIONS.READ), the scanner also resolves those references
 * by tracking string literal initialisers in `as const` objects within
 * the feature's permissions.ts file.
 *
 * LIMITATIONS
 * -----------
 * - Template literal permission strings cannot be statically resolved.
 *   These are flagged as warnings, not errors.
 * - Dynamic permission names computed at runtime are out of scope.
 */

import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PermissionReference {
  /** The resolved permission string, e.g. "widgets.read" */
  readonly permission: string;
  /** Absolute path to the source file containing the reference */
  readonly file: string;
  /** 1-indexed line number of the call expression */
  readonly line: number;
  /** How the permission was resolved */
  readonly resolution: "string-literal" | "constant-reference";
}

export interface ScanWarning {
  readonly message: string;
  readonly file: string;
  readonly line: number;
}

export interface ScanResult {
  readonly references: PermissionReference[];
  readonly warnings: ScanWarning[];
}

// ---------------------------------------------------------------------------
// Authorization method names the scanner recognises as permission gates
// ---------------------------------------------------------------------------

/**
 * Method names on the AuthorizationEngine / service private wrappers that
 * receive a permission name as their SECOND argument (index 1).
 */
const AUTH_ENGINE_METHODS_PERM_ARG1 = new Set([
  "can",
  "require",
  "requireTrusted",
]);

/**
 * Private service wrapper methods (e.g. `requirePermission`) that receive
 * a permission name as their SECOND argument (index 1).
 * These wrap auth.require/requireTrusted and are the primary call sites in
 * feature services.
 */
const SERVICE_WRAPPER_METHODS_PERM_ARG1 = new Set(["requirePermission"]);

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

/**
 * Scans all TypeScript/TSX source files under `featureSrcDir` and returns
 * every resolved permission reference found at auth call sites.
 *
 * @param featureSrcDir - Absolute path to the feature's src/ directory
 */
export function scanFeaturePermissions(featureSrcDir: string): ScanResult {
  if (!fs.existsSync(featureSrcDir)) {
    return { references: [], warnings: [] };
  }

  // 1. Collect all .ts / .tsx files
  const sourceFiles = collectTypeScriptFiles(featureSrcDir);

  // 2. Build a constant map from permissions.ts (PERM_CONST.KEY -> "value")
  const constantMap = buildPermissionConstantMap(featureSrcDir, sourceFiles);

  // 3. Scan each file for authorization call sites
  const references: PermissionReference[] = [];
  const warnings: ScanWarning[] = [];

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );

    scanNode(
      sourceFile,
      sourceFile,
      filePath,
      constantMap,
      references,
      warnings,
    );
  }

  // Deduplicate references by (permission, file, line)
  const seen = new Set<string>();
  const deduplicated: PermissionReference[] = [];
  for (const ref of references) {
    const key = `${ref.permission}|${ref.file}|${ref.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(ref);
    }
  }

  return { references: deduplicated, warnings };
}

// ---------------------------------------------------------------------------
// AST traversal
// ---------------------------------------------------------------------------

function scanNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  constantMap: Map<string, string>,
  references: PermissionReference[],
  warnings: ScanWarning[],
): void {
  if (ts.isCallExpression(node)) {
    const extracted = extractPermissionFromCall(
      node,
      sourceFile,
      filePath,
      constantMap,
      warnings,
    );
    if (extracted) {
      references.push(extracted);
    }
  }

  ts.forEachChild(node, (child) =>
    scanNode(child, sourceFile, filePath, constantMap, references, warnings),
  );
}

function extractPermissionFromCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
  constantMap: Map<string, string>,
  warnings: ScanWarning[],
): PermissionReference | null {
  const expr = node.expression;
  let methodName: string | null = null;
  let permArgIndex: number = 1; // default: permission is second argument

  // Match: someObj.methodName(...) or this.someObj.methodName(...)
  if (ts.isPropertyAccessExpression(expr)) {
    methodName = expr.name.text;
  }

  if (!methodName) return null;

  const isAuthEngineMethod = AUTH_ENGINE_METHODS_PERM_ARG1.has(methodName);
  const isWrapperMethod = SERVICE_WRAPPER_METHODS_PERM_ARG1.has(methodName);

  if (!isAuthEngineMethod && !isWrapperMethod) return null;

  const args = node.arguments;
  if (args.length <= permArgIndex) return null;

  const permArg = args[permArgIndex];
  if (!permArg) return null;
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const lineNumber = line + 1; // convert to 1-indexed

  // Case 1: String literal — "widgets.read" or 'widgets.read'
  if (ts.isStringLiteral(permArg)) {
    return {
      permission: permArg.text,
      file: filePath,
      line: lineNumber,
      resolution: "string-literal",
    };
  }

  // Case 2: Property access on a constant object — WIDGET_PERMISSIONS.READ
  if (ts.isPropertyAccessExpression(permArg)) {
    const resolved = resolveConstantReference(permArg, constantMap);
    if (resolved !== null) {
      return {
        permission: resolved,
        file: filePath,
        line: lineNumber,
        resolution: "constant-reference",
      };
    }

    // Could not resolve — emit a warning, not an error
    const ref = getNodeText(permArg, sourceFile);
    warnings.push({
      message: `Cannot statically resolve permission reference '${ref}'. Ensure the constant is defined in a 'permissions.ts' file within the feature.`,
      file: filePath,
      line: lineNumber,
    });
    return null;
  }

  // Case 3: Template literal — warn, cannot resolve
  if (ts.isTemplateLiteral(permArg)) {
    warnings.push({
      message: `Template literal permission strings cannot be statically verified. Use string constants from permissions.ts instead.`,
      file: filePath,
      line: lineNumber,
    });
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Constant resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a PropertyAccessExpression like `WIDGET_PERMISSIONS.READ` to its
 * string value using the constant map built from permissions.ts files.
 */
function resolveConstantReference(
  node: ts.PropertyAccessExpression,
  constantMap: Map<string, string>,
): string | null {
  const objectName = getObjectName(node.expression);
  if (!objectName) return null;

  const propertyName = node.name.text;
  const key = `${objectName}.${propertyName}`;
  return constantMap.get(key) ?? null;
}

/** Extracts the base object name from an expression, handling `this.X` */
function getObjectName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  // Handle `this.WIDGET_PERMISSIONS` (less common but possible)
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return expr.name.text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Permission constant map builder
// ---------------------------------------------------------------------------

/**
 * Builds a map of `OBJECT_NAME.KEY -> "string-value"` from `as const`
 * object declarations in any TypeScript file within the feature source.
 *
 * Handles patterns like:
 *   export const WIDGET_PERMISSIONS = { READ: "widgets.read" } as const;
 */
export function buildPermissionConstantMap(
  featureSrcDir: string,
  sourceFiles: string[],
): Map<string, string> {
  const map = new Map<string, string>();

  // Prioritise permissions.ts files but scan all to catch inline constants
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    extractConstantsFromFile(sourceFile, map);
  }

  return map;
}

function extractConstantsFromFile(
  sourceFile: ts.SourceFile,
  map: Map<string, string>,
): void {
  ts.forEachChild(sourceFile, (node) => {
    // export const X = { ... } as const;
    if (!ts.isVariableStatement(node)) return;

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;

      const objectName = decl.name.text;
      const init = unwrapAsConst(decl.initializer);

      if (!init || !ts.isObjectLiteralExpression(init)) continue;

      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))
          continue;
        if (!ts.isStringLiteral(prop.initializer)) continue;

        const propName = ts.isIdentifier(prop.name)
          ? prop.name.text
          : prop.name.text;
        const value = prop.initializer.text;
        map.set(`${objectName}.${propName}`, value);
      }
    }
  });
}

/**
 * Unwraps `expr as const` (type assertion) to get the inner expression.
 */
function unwrapAsConst(expr: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expr) &&
    ts.isTypeReferenceNode(expr.type) &&
    ts.isIdentifier(expr.type.typeName) &&
    expr.type.typeName.text === "const"
  ) {
    return expr.expression;
  }
  // Also handle satisfies / plain object
  if (ts.isAsExpression(expr)) {
    return expr.expression;
  }
  return expr;
}

// ---------------------------------------------------------------------------
// File system utilities
// ---------------------------------------------------------------------------

function collectTypeScriptFiles(dir: string): string[] {
  const results: string[] = [];
  collectTypeScriptFilesRecursive(dir, results);
  return results;
}

function collectTypeScriptFilesRecursive(dir: string, results: string[]): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and build output directories
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      collectTypeScriptFilesRecursive(fullPath, results);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".spec.tsx")
    ) {
      results.push(fullPath);
    }
  }
}

// ---------------------------------------------------------------------------
// AST text helper
// ---------------------------------------------------------------------------

function getNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}
