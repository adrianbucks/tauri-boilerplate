#!/usr/bin/env node

/**
 * Open Artifacts Script
 * Opens the release folder in the OS native file manager.
 */

import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RELEASE_DIR = path.resolve(__dirname, "../release");

if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

console.log(`Opening release directory: ${RELEASE_DIR}`);

const platform = process.platform;
let cmd = "";

if (platform === "win32") {
  cmd = `explorer "${RELEASE_DIR}"`;
} else if (platform === "darwin") {
  cmd = `open "${RELEASE_DIR}"`;
} else {
  cmd = `xdg-open "${RELEASE_DIR}"`;
}

exec(cmd, (err) => {
  if (err) {
    console.error(`Failed to open folder: ${err.message}`);
  }
});
