import type { MigrationScript } from "@platform/database";
import coreSchemaSql from "./core-schema.sql?raw";
import coreAuthenticationSql from "./core-authentication.sql?raw";

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
];
