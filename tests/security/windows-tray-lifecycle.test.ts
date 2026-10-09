import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// Security Regression Suite — WP-016b: Windows System Tray Lifecycle
// ---------------------------------------------------------------------------
// These tests verify that the system tray minimize-to-tray implementation
// (WP-016b) does not introduce any security regressions:
//
//   (1) No private key material leaks through tray event payloads.
//   (2) The close-to-tray handler calls prevent_close() before hide().
//   (3) The only sanctioned exit path from the tray is app.exit(0).
//   (4) Tray menu item IDs are stable string literals (no injection risk).
//   (5) Tray code is conditionally compiled to Windows only (not Android).
//   (6) The background://sync-now-requested payload carries only a timestamp.
//   (7) No new broad capabilities were added to the capability matrix.
//   (8) background_start is invoked inside platform init, not in render path.
// ---------------------------------------------------------------------------

describe("Security Regression Suite — WP-016b: Windows System Tray Lifecycle", () => {
  const libRsPath = path.join(workspaceRoot, "apps/demo/src-tauri/src/lib.rs");
  const capabilityPath = path.join(workspaceRoot, "apps/demo/src-tauri/capabilities/default.json");
  const usePlatformPath = path.join(workspaceRoot, "apps/demo/src/hooks/usePlatform.tsx");

  const libRsSource = fs.readFileSync(libRsPath, "utf8");
  const capabilityContent = JSON.parse(fs.readFileSync(capabilityPath, "utf8")) as {
    permissions: string[];
    description: string;
    windows: string[];
  };
  const usePlatformSource = fs.readFileSync(usePlatformPath, "utf8");

  // -----------------------------------------------------------------------
  // Test 1: No private key material in tray event payloads
  // -----------------------------------------------------------------------
  it("Invariant #5: tray sync-now event emits only a UTC timestamp — no key material", () => {
    const syncNowBlock = libRsSource.match(
      /"tray_sync_now"[\s\S]*?\.emit\("background:\/\/sync-now-requested",\s*([^)]+)\)/,
    );
    expect(syncNowBlock).not.toBeNull();

    const emitPayload = syncNowBlock?.[1] ?? "";
    expect(emitPayload).toContain("ts");
    expect(emitPayload).not.toContain("private");
    expect(emitPayload).not.toContain("secret");
    expect(emitPayload).not.toContain("seed");
    expect(emitPayload).not.toContain("password");
    expect(emitPayload).not.toContain("credential");
  });

  // -----------------------------------------------------------------------
  // Test 2: Close-to-tray calls prevent_close BEFORE hide
  // -----------------------------------------------------------------------
  it("WP-016b: on_window_event calls prevent_close before hide for main window", () => {
    expect(libRsSource).toContain("CloseRequested { api, .. }");

    const preventCloseIdx = libRsSource.indexOf("api.prevent_close()");
    const hideIdx = libRsSource.indexOf("window.hide().ok()");
    expect(preventCloseIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(-1);
    expect(preventCloseIdx).toBeLessThan(hideIdx);

    expect(libRsSource).toContain('window.label() == "main"');
  });

  // -----------------------------------------------------------------------
  // Test 3: Only app.exit(0) is used as the process exit from tray
  // -----------------------------------------------------------------------
  it("WP-016b: tray quit handler uses app.exit(0) — no raw process::exit", () => {
    expect(libRsSource).toContain("app.exit(0)");
    expect(libRsSource).not.toContain("process::exit");
    expect(libRsSource).not.toContain("std::process::exit");
  });

  // -----------------------------------------------------------------------
  // Test 4: Tray menu item IDs are stable string literals
  // -----------------------------------------------------------------------
  it("WP-016b: tray menu item IDs are hardcoded stable string literals", () => {
    expect(libRsSource).toContain('"tray_show"');
    expect(libRsSource).toContain('"tray_sync_now"');
    expect(libRsSource).toContain('"tray_quit"');

    // 3 IDs × 2 occurrences (definition + match arm) = 6 minimum
    const matchArmCount = (libRsSource.match(/"tray_/g) ?? []).length;
    expect(matchArmCount).toBeGreaterThanOrEqual(6);
  });

  // -----------------------------------------------------------------------
  // Test 5: Tray code is conditionally compiled to Windows only
  // -----------------------------------------------------------------------
  it('WP-016b: tray construction is guarded by #[cfg(target_os = "windows")]', () => {
    expect(libRsSource).toContain('#[cfg(target_os = "windows")]');

    const trayBuilderIdx = libRsSource.indexOf("TrayIconBuilder::new()");
    const cfgIdx = libRsSource.lastIndexOf('#[cfg(target_os = "windows")]', trayBuilderIdx);
    expect(cfgIdx).toBeGreaterThan(-1);
    expect(trayBuilderIdx).toBeGreaterThan(-1);
    expect(cfgIdx).toBeLessThan(trayBuilderIdx);
  });

  // -----------------------------------------------------------------------
  // Test 6: No new broad capabilities were added (Invariant #8)
  // -----------------------------------------------------------------------
  it("Invariant #8: tray integration did not add wildcard or broad capabilities", () => {
    const perms = capabilityContent.permissions;

    expect(perms).not.toContain("*");
    expect(perms.some((p) => p.includes("*"))).toBe(false);
    expect(perms).not.toContain("core:default");
    expect(perms).not.toContain("core:event:default");

    const dangerousPerms = perms.filter(
      (p) => p.startsWith("core:shell") || p.startsWith("core:fs") || p.startsWith("core:process"),
    );
    expect(dangerousPerms).toHaveLength(0);
    expect(capabilityContent.windows).toEqual(["main"]);
  });

  // -----------------------------------------------------------------------
  // Test 7: TypeScript listener cleanup prevents memory leaks
  // -----------------------------------------------------------------------
  it("WP-016b: usePlatform cleans up the sync-now event listener on unmount", () => {
    expect(usePlatformSource).toContain("unlistenRef.current?.()");
    expect(usePlatformSource).toContain('"background://sync-now-requested"');
    expect(usePlatformSource).toContain("useRef");
  });

  // -----------------------------------------------------------------------
  // Test 8: background_start is called inside init(), not in render path
  // -----------------------------------------------------------------------
  it("WP-016b: background_start is invoked inside init() — not in a render path", () => {
    const initFnMatch = usePlatformSource.match(
      /const init = useCallback\(async \(\) => \{([\s\S]*?)\}, \[nativeGateway\]\)/,
    );
    expect(initFnMatch).not.toBeNull();

    const initBody = initFnMatch?.[1] ?? "";
    expect(initBody).toContain('"background_start"');

    // 2 occurrences: init body + sync-now handler
    const totalInvocations = (usePlatformSource.match(/"background_start"/g) ?? []).length;
    expect(totalInvocations).toBeGreaterThanOrEqual(2);
  });
});
