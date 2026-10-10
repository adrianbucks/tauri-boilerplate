import type { MigrationScript } from "@platform/database";
import coreSchemaSql from "./core-schema.sql?raw";
import coreAuthenticationSql from "./core-authentication.sql?raw";
import coreReplicationSql from "./core-replication.sql?raw";
import coreTasksSql from "./core-tasks.sql?raw";
import coreTaskRetryPolicySql from "./core-task-retry-policy.sql?raw";
import coreDeviceLocalIdentitySql from "./core-device-local-identity.sql?raw";
import coreOutboxEnvelopeSql from "./core-outbox-envelope.sql?raw";
import coreOrganisationDomainUniqueSql from "./core-organisation-domain-unique.sql?raw";

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
  {
    version: 5,
    name: "persist_background_task_retry_jitter",
    checksum: "chk_platform_core_005",
    sql: coreTaskRetryPolicySql,
  },
  {
    version: 6,
    name: "distinguish_local_device_from_peer_identities",
    checksum: "chk_platform_core_006",
    sql: coreDeviceLocalIdentitySql,
  },
  {
    version: 7,
    name: "persist_complete_sync_outbox_envelopes",
    checksum: "chk_platform_core_007",
    sql: coreOutboxEnvelopeSql,
  },
  {
    version: 8,
    name: "enforce_normalized_organisation_domain_uniqueness",
    checksum: "chk_platform_core_008",
    sql: coreOrganisationDomainUniqueSql,
  },
];
