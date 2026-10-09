import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// Security Regression Suite — Android Lifecycle, WorkManager & Signing
// ---------------------------------------------------------------------------
// These tests verify that the Android OS background sync adapter (WP-016a)
// and release signing configuration (WP-018c) comply with all architectural
// invariants:
//
//   (1) Invariant #8: Scoped permissions in AndroidManifest.xml (no broad storage/location).
//   (2) Invariant #5: Zero hardcoded signing passwords or committed private keystores.
//   (3) Network & Battery Constraints: WorkManager requires CONNECTED and BatteryNotLow.
//   (4) Cleartext Traffic Policy: Default and release forbid cleartext traffic.
//   (5) Dependency Minimums: minSdk >= 24 and androidx.work:work-runtime-ktx configured.
//   (6) CI Release Pipeline: Keystore extraction pulls strictly from GitHub Secrets.
// ---------------------------------------------------------------------------

describe("Security Regression Suite — Android Lifecycle & Signing Governance", () => {
  const androidManifestPath = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
  );
  const buildGradlePath = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/gen/android/app/build.gradle.kts",
  );
  const syncWorkerPath = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/gen/android/app/src/main/java/com/tauri/boilerplate/demo/SyncWorker.kt",
  );
  const mainActivityPath = path.join(
    workspaceRoot,
    "apps/demo/src-tauri/gen/android/app/src/main/java/com/tauri/boilerplate/demo/MainActivity.kt",
  );
  const releaseWorkflowPath = path.join(workspaceRoot, ".github/workflows/release.yml");

  const manifestSource = fs.readFileSync(androidManifestPath, "utf8");
  const buildGradleSource = fs.readFileSync(buildGradlePath, "utf8");
  const syncWorkerSource = fs.readFileSync(syncWorkerPath, "utf8");
  const mainActivitySource = fs.readFileSync(mainActivityPath, "utf8");
  const releaseWorkflowSource = fs.readFileSync(releaseWorkflowPath, "utf8");

  // -------------------------------------------------------------------------
  // Test 1: Invariant #8: Scoped Android Permissions
  // -------------------------------------------------------------------------
  it("Invariant #8: AndroidManifest.xml declares strictly scoped permissions without broad capabilities", () => {
    const permissionMatches = [
      ...manifestSource.matchAll(/<uses-permission\s+android:name="([^"]+)"\s*\/>/g),
    ].map((m) => m[1]);

    // Permitted low-risk network permissions
    const sanctionedPermissions = [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
    ];

    for (const perm of permissionMatches) {
      expect(sanctionedPermissions).toContain(perm);
    }

    // Explicitly forbid broad/risky permissions
    expect(permissionMatches).not.toContain("android.permission.READ_EXTERNAL_STORAGE");
    expect(permissionMatches).not.toContain("android.permission.WRITE_EXTERNAL_STORAGE");
    expect(permissionMatches).not.toContain("android.permission.ACCESS_FINE_LOCATION");
    expect(permissionMatches).not.toContain("android.permission.CAMERA");
    expect(permissionMatches).not.toContain("android.permission.RECORD_AUDIO");
  });

  // -------------------------------------------------------------------------
  // Test 2: Cleartext traffic is disabled by default
  // -------------------------------------------------------------------------
  it("Enforces usesCleartextTraffic=false by default and in release builds", () => {
    expect(manifestSource).toContain('android:usesCleartextTraffic="${usesCleartextTraffic}"');
    expect(buildGradleSource).toContain('manifestPlaceholders["usesCleartextTraffic"] = "false"');

    // Verify debug is the only buildType with cleartext enabled
    const debugBlock = buildGradleSource.match(/getByName\("debug"\)\s*\{([^}]+)\}/);
    expect(debugBlock).not.toBeNull();
    expect(debugBlock?.[1]).toContain('manifestPlaceholders["usesCleartextTraffic"] = "true"');

    const releaseBlock = buildGradleSource.match(
      /getByName\("release"\)\s*\{([\s\S]*?)(?=\n\s*getByName|\n\s*kotlinOptions|\n\s*buildFeatures)/,
    );
    expect(releaseBlock).not.toBeNull();
    expect(releaseBlock?.[1]).not.toContain(
      'manifestPlaceholders["usesCleartextTraffic"] = "true"',
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: WorkManager dependency and Android SDK minimums
  // -------------------------------------------------------------------------
  it("Declares androidx.work runtime dependency and satisfies minSdk >= 24", () => {
    expect(buildGradleSource).toContain('implementation("androidx.work:work-runtime-ktx:');

    const minSdkMatch = buildGradleSource.match(/minSdk\s*=\s*(\d+)/);
    expect(minSdkMatch).not.toBeNull();
    const minSdk = Number.parseInt(minSdkMatch?.[1] ?? "0", 10);
    expect(minSdk).toBeGreaterThanOrEqual(24);
  });

  // -------------------------------------------------------------------------
  // Test 4: WorkManager constraints (Network & Battery)
  // -------------------------------------------------------------------------
  it("WorkManager scheduler enforces NetworkType.CONNECTED and requiresBatteryNotLow(true)", () => {
    expect(mainActivitySource).toContain("NetworkType.CONNECTED");
    expect(mainActivitySource).toContain("setRequiresBatteryNotLow(true)");
    expect(mainActivitySource).toContain("PeriodicWorkRequestBuilder<SyncWorker>");
    expect(mainActivitySource).toContain("ExistingPeriodicWorkPolicy.KEEP");
  });

  // -------------------------------------------------------------------------
  // Test 5: Invariant #5: Zero hardcoded secrets in build.gradle.kts
  // -------------------------------------------------------------------------
  it("Invariant #5: Keystore signing configuration pulls from environment without hardcoded passwords", () => {
    expect(buildGradleSource).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
    expect(buildGradleSource).toContain('System.getenv("ANDROID_KEYSTORE_PASSWORD")');
    expect(buildGradleSource).toContain('System.getenv("ANDROID_KEY_ALIAS")');

    // Must not contain hardcoded plaintext credentials
    expect(buildGradleSource).not.toMatch(/storePassword\s*=\s*"[^$]/);
    expect(buildGradleSource).not.toMatch(/keyPassword\s*=\s*"[^$]/);
  });

  // -------------------------------------------------------------------------
  // Test 6: Invariant #5: Zero keystore or private key binaries committed
  // -------------------------------------------------------------------------
  it("Invariant #5: No binary release keystores (*.jks, *.keystore) are tracked in git repository", () => {
    const androidAppDir = path.join(workspaceRoot, "apps/demo/src-tauri/gen/android/app");
    const files = fs.readdirSync(androidAppDir);

    const forbiddenExtensions = [".jks", ".keystore", ".p12", ".pfx"];
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      expect(forbiddenExtensions).not.toContain(ext);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: CI Release Workflow Keystore Integration
  // -------------------------------------------------------------------------
  it("Release workflow extracts Android keystore strictly from secrets", () => {
    expect(releaseWorkflowSource).toContain(
      "ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}",
    );
    expect(releaseWorkflowSource).toContain(
      "ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}",
    );
    expect(releaseWorkflowSource).toContain(
      "base64 -d > apps/demo/src-tauri/gen/android/app/release.jks",
    );
  });
});
