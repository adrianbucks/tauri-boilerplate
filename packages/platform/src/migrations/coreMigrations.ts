import type { MigrationScript } from "@platform/database";
import coreSchemaSql from "./core-schema.sql?raw";
import coreAuthenticationSql from "./core-authentication.sql?raw";
import coreReplicationSql from "./core-replication.sql?raw";
import coreTasksSql from "./core-tasks.sql?raw";

export const coreMigrations: readonly MigrationScript[] = [
  {
    version: 1,
    name: "create_platform_core_schema",
    checksum: "chk_platform_core_001",
    sql: coreSchemaSql,
  },
  {
    version: 2,
    name: "add_local_authentication_state",
    checksum: "chk_platform_core_002",
    sql: coreAuthenticationSql,
  },
  {
    version: 3,
    name: "add_replication_outbox_inbox_tombstones",
    checksum: "chk_platform_core_003",
    sql: coreReplicationSql,
  },
  {
    version: 4,
    name: "add_durable_background_tasks",
    checksum: "chk_platform_core_004",
    sql: coreTasksSql,
  },
];
