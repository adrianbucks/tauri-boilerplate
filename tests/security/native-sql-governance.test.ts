import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../");

describe("Security Regression Suite — Native SQL Guard", () => {
  it("keeps Rust regression cases for comment-obfuscated dangerous SQL commands", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain(
      "fn sql_safety_guard_blocks_dangerous_commands_with_comments()",
    );
    expect(databaseSource).toContain("PRAGMA/* split token */ foreign_keys = OFF;");
    expect(databaseSource).toContain("; PRAGMA foreign_keys = OFF;");
    expect(databaseSource).toContain("\\u{feff}PRAGMA foreign_keys = OFF;");
    expect(databaseSource).toContain("BEGIN TRANSACTION;");
    expect(databaseSource).toContain("COMMIT;");
    expect(databaseSource).toContain("ROLLBACK;");
    expect(databaseSource).toContain("SAVEPOINT client_savepoint;");
    expect(databaseSource).toContain("RELEASE SAVEPOINT client_savepoint;");
    expect(databaseSource).toContain("ATTACH/* split token */ DATABASE");
    expect(databaseSource).toContain("DETACH/* split token */ DATABASE");
    expect(databaseSource).toContain("VACUUM/* split token */ INTO");
  });

  it("keeps bounded result limits on the generic native query bridge", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain("const MAX_QUERY_RESULT_ROWS: usize = 10_000;");
    expect(databaseSource).toContain("const MAX_QUERY_RESULT_BYTES: usize = 10 * 1024 * 1024;");
    expect(databaseSource).toContain("const MAX_QUERY_RESULT_COLUMNS: usize = 256;");
    expect(databaseSource).toContain("fn query_json_rejects_results_above_bridge_limits()");
  });

  it("keeps a regression proving the SQL bridge rejects statement tails", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain(
      "fn sql_bridge_rejects_multiple_statements_before_execution()",
    );
    expect(databaseSource).toContain(
      "INSERT INTO tail_guard (value) VALUES ('first'); PRAGMA foreign_keys = OFF;",
    );
  });

  it("keeps native SQL command input limits and their regression coverage", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain("const MAX_SQL_STATEMENT_BYTES: usize = 1024 * 1024;");
    expect(databaseSource).toContain("const MAX_SQL_PARAMETERS: usize = 999;");
    expect(databaseSource).toContain("const MAX_SQL_PARAMETER_BYTES: usize = 1024 * 1024;");
    expect(databaseSource).toContain("const MAX_SQL_REQUEST_BYTES: usize = 10 * 1024 * 1024;");
    expect(databaseSource).toContain("const MAX_SQL_TRANSACTION_OPERATIONS: usize = 1_000;");
    expect(databaseSource).toContain(
      "fn sql_bridge_rejects_oversized_inputs_before_database_execution()",
    );
  });

  it("guards against unsigned integer parameters wrapping in SQLite", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain("unsigned > i64::MAX as u64");
    expect(databaseSource).toContain("db_parameter_invalid");
    expect(databaseSource).toContain("u64::MAX.into()");
  });

  it("keeps read-only query enforcement for SQL statements with RETURNING", () => {
    const databaseSource = fs.readFileSync(
      path.join(workspaceRoot, "crates/native-core/src/database.rs"),
      "utf8",
    );

    expect(databaseSource).toContain("if !statement.readonly()");
    expect(databaseSource).toContain(
      "fn query_operations_reject_writes_even_when_sql_returns_rows()",
    );
    expect(databaseSource).toContain("DELETE FROM query_guard WHERE id = 1 RETURNING id;");
  });
});
