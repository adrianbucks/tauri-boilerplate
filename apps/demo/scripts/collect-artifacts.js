#!/usr/bin/env node

/**
 * Artifact Collector Script
 * Collects Windows (.msi, .exe) and Android (.apk, .aab) installers
 * from root target/ and Android build folders into apps/demo/release/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const RELEASE_DIR = path.join(APP_DIR, "release");

const WINDOWS_TARGET_DIR = path.join(RELEASE_DIR, "windows");
const ANDROID_TARGET_DIR = path.join(RELEASE_DIR, "android");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findFiles(dir, filterRegex) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function scan(current) {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile() && filterRegex.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  scan(dir);
  return results;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function copyArtifact(srcPath, destDir) {
  ensureDir(destDir);
  const fileName = path.basename(srcPath);
  const destPath = path.join(destDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  const stat = fs.statSync(destPath);
  return { name: fileName, size: formatBytes(stat.size), dest: destPath };
}

console.log("\n========================================");
console.log("       Tauri Artifact Collector        ");
console.log("========================================\n");

ensureDir(RELEASE_DIR);

// 1. Windows Bundles
const windowsCandidates = [
  path.join(REPO_ROOT, "target", "release", "bundle"),
  path.join(APP_DIR, "src-tauri", "target", "release", "bundle"),
];

let windowsFound = [];
for (const cand of windowsCandidates) {
  const msiFiles = findFiles(path.join(cand, "msi"), /\.msi$/i);
  const nsisFiles = findFiles(path.join(cand, "nsis"), /\.exe$/i);
  windowsFound = windowsFound.concat(msiFiles, nsisFiles);
}

// 2. Android Bundles
const androidCandidates = [
  path.join(
    APP_DIR,
    "src-tauri",
    "gen",
    "android",
    "app",
    "build",
    "outputs",
    "apk",
  ),
  path.join(
    APP_DIR,
    "src-tauri",
    "gen",
    "android",
    "app",
    "build",
    "outputs",
    "bundle",
  ),
];

let androidFound = [];
for (const cand of androidCandidates) {
  const apkFiles = findFiles(cand, /\.(apk|aab)$/i);
  androidFound = androidFound.concat(apkFiles);
}

const collected = [];

if (windowsFound.length > 0) {
  console.log("📦 Windows Installers Found:");
  for (const file of windowsFound) {
    const info = copyArtifact(file, WINDOWS_TARGET_DIR);
    collected.push({ Platform: "Windows", ...info });
    console.log(`  -> Copied: ${info.name} (${info.size})`);
  }
} else {
  console.log("ℹ️  No Windows installers found in target/release/bundle.");
  console.log("   Build Windows with: pnpm --filter @apps/demo tauri:build");
}

console.log("");

if (androidFound.length > 0) {
  console.log("📦 Android Binaries Found:");
  for (const file of androidFound) {
    const info = copyArtifact(file, ANDROID_TARGET_DIR);
    collected.push({ Platform: "Android", ...info });
    console.log(`  -> Copied: ${info.name} (${info.size})`);
  }
} else {
  console.log(
    "ℹ️  No Android APKs found in src-tauri/gen/android/.../outputs.",
  );
  console.log(
    "   Build Android with: pnpm --filter @apps/demo tauri -- android build --apk",
  );
}

console.log("\n----------------------------------------");
if (collected.length > 0) {
  console.log(`✅ Staged ${collected.length} artifact(s) to:`);
  console.log(`   ${RELEASE_DIR}`);
} else {
  console.log(`Release directory ready at: ${RELEASE_DIR}`);
}
console.log("----------------------------------------\n");
