import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");

describe("Security Regression Suite — Task Queue Read Bounds", () => {
  it("validates task-list limits before querying SQLite", () => {
    const source = fs.readFileSync(
      path.join(workspaceRoot, "packages/tasks/src/queue/TaskQueueService.ts"),
      "utf8",
    );
    const method = source.slice(source.indexOf("async listByState("));

    expect(source).toContain("export const MAX_TASK_LIST_SIZE = 100;");
    expect(method).toContain(
      "!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_TASK_LIST_SIZE",
    );
    expect(method.indexOf("if (!Number.isSafeInteger(limit)")).toBeLessThan(
      method.indexOf("const rows = await this.db.query"),
    );
  });
});
