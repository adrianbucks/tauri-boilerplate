use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crypto_core::PasswordVerifier;
use identity_core::{DeviceIdentity, KeyManager};
use crate::PlatformError;
use crate::widget::{
    authorize_widget_create, authorize_widget_read, NativePrincipal, NativeWidgetBulkCreateRequest,
    NativeWidgetCreateItem, NativeWidgetCreateRequest, NativeWidgetRecord,
};
use crate::organisation::{
    authorize_organisation_create, authorize_organisation_read, NativeOrganisationCreateRequest,
    NativeOrganisationRecord,
};

const MAX_AUTHENTICATION_FAILURES: i64 = 5;
const LOCKOUT_SECONDS: u64 = 300;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseHealth {
    pub db_path: String,
    pub sqlite_version: String,
    pub journal_mode: String,
    pub foreign_keys_enabled: bool,
    pub integrity_check: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeMigration {
    pub owner: String,
    pub version: i64,
    pub name: String,
    pub checksum: String,
    pub sql: String,
}

#[derive(Debug, Deserialize)]
pub struct DbJsonOperation {
    #[serde(rename = "type")]
    pub op_type: String,
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

pub struct DurableDatabase {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl DurableDatabase {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, PlatformError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| database_error("db_parent", error))?;
        }

        let connection = Connection::open(&path).map_err(|error| database_error("db_open", error))?;
        connection
            .busy_timeout(BUSY_TIMEOUT)
            .map_err(|error| database_error("db_busy_timeout", error))?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;",
            )
            .map_err(|error| database_error("db_configure", error))?;

        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    pub fn execute_batch(&self, sql: &str) -> Result<(), PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        connection
            .execute_batch(sql)
            .map_err(|error| database_error("db_execute", error))
    }

    pub fn load_or_create_device_identity(
        &self,
        application_id: &str,
        platform: &str,
    ) -> Result<DeviceIdentity, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let existing = connection
            .query_row(
                "SELECT device_id, public_key
                 FROM core_devices
                 WHERE application_id = ?1 AND platform = ?2 AND user_id IS NULL
                 ORDER BY created_at ASC
                 LIMIT 1",
                params![application_id, platform],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| database_error("device_identity_lookup", error))?;
        if let Some((device_id, public_key)) = existing {
            return Ok(DeviceIdentity {
                device_id,
                public_key,
                platform: platform.to_string(),
                application_id: application_id.to_string(),
            });
        }

        let identity = KeyManager::get_or_create_device_identity(application_id, platform)
            .map_err(|error| {
                PlatformError::new(
                    "AUTHENTICATION_ERROR",
                    format!("Failed to generate device identity: {error}"),
                    "Unable to access device identity",
                    "device_identity_generate",
                )
            })?;
        let now = current_epoch_seconds().to_string();
        connection
            .execute(
                "INSERT INTO core_devices
                 (id, created_at, updated_at, device_id, public_key, platform,
                  application_id, status, registered_at)
                 VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, 'APPROVED', ?2)",
                params![
                    format!("device_record_{}", identity.device_id),
                    now,
                    identity.device_id,
                    identity.public_key,
                    identity.platform,
                    identity.application_id
                ],
            )
            .map_err(|error| database_error("device_identity_bind", error))?;
        Ok(identity)
    }

    pub fn transaction(&self, sql: &str) -> Result<(), PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("db_begin", error))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| database_error("db_transaction", error))?;
        transaction
            .commit()
            .map_err(|error| database_error("db_commit", error))
    }

    pub fn apply_migrations(
        &self,
        migrations: &[NativeMigration],
    ) -> Result<usize, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS core_migrations (
                    owner TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    PRIMARY KEY (owner, version)
                );",
            )
            .map_err(|error| database_error("db_migration_table", error))?;

        let mut ordered = migrations.to_vec();
        ordered.sort_by(|left, right| {
            migration_owner_order(&left.owner)
                .cmp(&migration_owner_order(&right.owner))
                .then(left.version.cmp(&right.version))
        });

        let mut applied_count = 0;
        for migration in ordered {
            let existing: Option<String> = connection
                .query_row(
                    "SELECT checksum FROM core_migrations WHERE owner = ?1 AND version = ?2",
                    params![migration.owner, migration.version],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| database_error("db_migration_lookup", error))?;

            if let Some(checksum) = existing {
                if checksum != migration.checksum {
                    return Err(database_error_message(
                        "db_migration_checksum",
                        &format!(
                            "Migration checksum mismatch for {}:v{}",
                            migration.owner, migration.version
                        ),
                    ));
                }
                continue;
            }

            let transaction = connection
                .unchecked_transaction()
                .map_err(|error| database_error("db_migration_begin", error))?;
            transaction
                .execute_batch(&migration.sql)
                .map_err(|error| database_error("db_migration_execute", error))?;
            transaction
                .execute(
                    "INSERT INTO core_migrations (owner, version, name, applied_at, checksum)
                     VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?4)",
                    params![
                        migration.owner,
                        migration.version,
                        migration.name,
                        migration.checksum
                    ],
                )
                .map_err(|error| database_error("db_migration_record", error))?;
            transaction
                .commit()
                .map_err(|error| database_error("db_migration_commit", error))?;
            applied_count += 1;
        }

        Ok(applied_count)
    }

    pub fn health_check(&self) -> Result<DatabaseHealth, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;

        let sqlite_version = connection
            .query_row("SELECT sqlite_version()", [], |row| row.get::<_, String>(0))
            .map_err(|error| database_error("db_version", error))?;
        let journal_mode = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .map_err(|error| database_error("db_journal_mode", error))?;
        let foreign_keys_enabled = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .map_err(|error| database_error("db_foreign_keys", error))?
            == 1;
        let integrity_check = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .map_err(|error| database_error("db_integrity", error))?;

        Ok(DatabaseHealth {
            db_path: self.path.display().to_string(),
            sqlite_version,
            journal_mode,
            foreign_keys_enabled,
            integrity_check,
        })
    }

    pub fn table_exists(&self, table_name: &str) -> Result<bool, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table_name],
                |row| row.get(0),
            )
            .map_err(|error| database_error("db_table_exists", error))?;
        Ok(count == 1)
    }

    pub fn column_exists(
        &self,
        table_name: &str,
        column_name: &str,
    ) -> Result<bool, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let escaped_table = table_name.replace('"', "\"\"");
        let sql = format!("PRAGMA table_info(\"{escaped_table}\")");
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| database_error("db_column_exists", error))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| database_error("db_column_exists", error))?;
        for column in columns {
            if column.map_err(|error| database_error("db_column_exists", error))? == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn list_widgets(
        &self,
        principal: &NativePrincipal,
        organisation_id: &str,
    ) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
        authorize_widget_read(principal, organisation_id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let mut statement = connection
            .prepare(
                "SELECT id, organisation_id, name, sku, quantity, deleted_at
                 FROM widgets
                 WHERE organisation_id = ?1 AND deleted_at IS NULL
                 ORDER BY name ASC, id ASC",
            )
            .map_err(|error| database_error("widget_list_prepare", error))?;
        let rows = statement
            .query_map([organisation_id], |row| {
                Ok(NativeWidgetRecord {
                    id: row.get(0)?,
                    organisation_id: row.get(1)?,
                    name: row.get(2)?,
                    sku: row.get(3)?,
                    quantity: row.get(4)?,
                    deleted_at: row.get(5)?,
                })
            })
            .map_err(|error| database_error("widget_list_query", error))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| database_error("widget_list_row", error))
    }

    pub fn list_organisations(
        &self,
        principal: &NativePrincipal,
    ) -> Result<Vec<NativeOrganisationRecord>, PlatformError> {
        authorize_organisation_read(principal)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let mut statement = connection
            .prepare(
                "SELECT id, created_at, updated_at, name, domain, status
                 FROM core_organisations
                 WHERE ?1 = 1 OR id = ?2
                 ORDER BY name ASC, id ASC",
            )
            .map_err(|error| database_error("organisation_list_prepare", error))?;
        let rows = statement
            .query_map(
                params![
                    i64::from(principal.can("organisations.manage")),
                    principal.organisation_id
                ],
                |row| {
                Ok(NativeOrganisationRecord {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    updated_at: row.get(2)?,
                    name: row.get(3)?,
                    domain: row.get(4)?,
                    status: row.get(5)?,
                })
                },
            )
            .map_err(|error| database_error("organisation_list_query", error))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| database_error("organisation_list_row", error))
    }

    pub fn create_organisation(
        &self,
        principal: &NativePrincipal,
        request: NativeOrganisationCreateRequest,
    ) -> Result<NativeOrganisationRecord, PlatformError> {
        if let Err(error) = authorize_organisation_create(principal) {
            self.record_mutation_failure(
                principal,
                "ORGANISATION_CREATE_FAILED",
                &principal.organisation_id,
                &request.correlation_id,
                "Organisation",
                &error,
            )?;
            return Err(error);
        }
        let name = request.name.trim();
        let domain = request
            .domain
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        if name.is_empty() {
            let error = PlatformError::new(
                "VALIDATION_ERROR",
                "Organisation name is required",
                "Please provide an organisation name",
                "organisation_create_validation",
            );
            self.record_mutation_failure(
                principal,
                "ORGANISATION_CREATE_FAILED",
                &principal.organisation_id,
                &request.correlation_id,
                "Organisation",
                &error,
            )?;
            return Err(error);
        }

        let id = format!(
            "org_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| database_error("organisation_create_clock", error))?
                .as_nanos()
        );
        let now = current_epoch_seconds().to_string();
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("organisation_create_begin", error))?;
        if let Some(domain) = domain.as_deref() {
            let exists: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM core_organisations WHERE domain = ?1",
                    [domain],
                    |row| row.get(0),
                )
                .map_err(|error| database_error("organisation_domain_lookup", error))?;
            if exists > 0 {
                let error = PlatformError::new(
                    "VALIDATION_ERROR",
                    "Organisation domain is already in use",
                    "Domain is already in use by another organisation",
                    "organisation_domain_duplicate",
                );
                let audit_id = format!(
                    "audit_native_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|cause| database_error("organisation_failure_audit_clock", cause))?
                        .as_nanos()
                );
                let metadata = serde_json::json!({
                    "entityName": "Organisation",
                    "errorCode": error.code,
                })
                .to_string();
                transaction
                    .execute(
                        "INSERT INTO core_audit_events
                         (id, event_type, user_id, device_id, organisation_id,
                          correlation_id, timestamp, metadata_json)
                         VALUES (?1, 'ORGANISATION_CREATE_FAILED', ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![
                            audit_id,
                            principal.user_id,
                            principal.device_id,
                            principal.organisation_id,
                            request.correlation_id,
                            current_epoch_seconds().to_string(),
                            metadata
                        ],
                    )
                    .map_err(|cause| database_error("organisation_failure_audit_insert", cause))?;
                transaction
                    .commit()
                    .map_err(|cause| database_error("organisation_failure_audit_commit", cause))?;
                return Err(error);
            }
        }
        transaction
            .execute(
                "INSERT INTO core_organisations
                 (id, created_at, updated_at, created_by, updated_by, name, domain, status)
                 VALUES (?1, ?2, ?2, ?3, ?3, ?4, ?5, 'ACTIVE')",
                params![id, now, principal.user_id, name, domain],
            )
            .map_err(|error| database_error("organisation_create_insert", error))?;
        let audit_id = format!(
            "audit_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| database_error("organisation_audit_clock", error))?
                .as_nanos()
        );
        let metadata = serde_json::json!({
            "entityName": "Organisation",
            "organisationId": id,
        })
        .to_string();
        transaction
            .execute(
                "INSERT INTO core_audit_events
                 (id, event_type, user_id, device_id, organisation_id,
                  correlation_id, timestamp, metadata_json)
                 VALUES (?1, 'ORGANISATION_CREATED', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    audit_id,
                    principal.user_id,
                    principal.device_id,
                    principal.organisation_id,
                    request.correlation_id,
                    current_epoch_seconds().to_string(),
                    metadata
                ],
            )
            .map_err(|error| database_error("organisation_audit_insert", error))?;
        transaction
            .commit()
            .map_err(|error| database_error("organisation_create_commit", error))?;

        Ok(NativeOrganisationRecord {
            id,
            created_at: now.clone(),
            updated_at: now,
            name: name.to_string(),
            domain,
            status: "ACTIVE".to_string(),
        })
    }

    pub fn create_widget(
        &self,
        principal: &NativePrincipal,
        request: NativeWidgetCreateRequest,
    ) -> Result<NativeWidgetRecord, PlatformError> {
        if let Err(error) = authorize_widget_create(principal, &request.organisation_id) {
            self.record_mutation_failure(
                principal,
                "WIDGET_CREATE_FAILED",
                &principal.organisation_id,
                &request.correlation_id,
                "Widget",
                &error,
            )?;
            return Err(error);
        }
        let name = request.name.trim();
        let sku = request.sku.trim().to_uppercase();
        if name.is_empty() || sku.is_empty() || request.quantity < 0 {
            let error = PlatformError::new(
                "VALIDATION_ERROR",
                "Invalid widget create input",
                "Provide a name, SKU, and non-negative quantity",
                "widget_create_validation",
            );
            self.record_mutation_failure(
                principal,
                "WIDGET_CREATE_FAILED",
                &request.organisation_id,
                &request.correlation_id,
                "Widget",
                &error,
            )?;
            return Err(error);
        }
        let id = format!(
            "wid_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| database_error("widget_create_clock", error))?
                .as_nanos()
        );
        let now = current_epoch_seconds().to_string();
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("widget_create_begin", error))?;
        transaction
            .execute(
                "INSERT INTO widgets
                 (id, created_at, updated_at, created_by, updated_by, entity_id,
                  organisation_id, sync_group_id, schema_version, sync_version,
                  data_classification, name, sku, quantity, description)
                 VALUES (?1, ?2, ?2, ?3, ?3, ?1, ?4, ?5, 1, 1, 'INTERNAL', ?6, ?7, ?8, ?9)",
                params![
                    id,
                    now,
                    principal.user_id,
                    request.organisation_id,
                    request.sync_group_id,
                    name,
                    sku,
                    request.quantity,
                    request.description
                ],
            )
            .map_err(|error| database_error("widget_create_insert", error))?;
        let audit_id = format!(
            "audit_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| database_error("widget_audit_clock", error))?
                .as_nanos()
        );
        let metadata = serde_json::json!({
            "entityName": "Widget",
            "widgetId": id,
            "sku": sku,
        })
        .to_string();
        transaction
            .execute(
                "INSERT INTO core_audit_events
                 (id, event_type, user_id, device_id, organisation_id,
                  correlation_id, timestamp, metadata_json)
                 VALUES (?1, 'WIDGET_CREATED', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    audit_id,
                    principal.user_id,
                    principal.device_id,
                    request.organisation_id,
                    request.correlation_id,
                    current_epoch_seconds().to_string(),
                    metadata
                ],
            )
            .map_err(|error| database_error("widget_audit_insert", error))?;
        transaction
            .commit()
            .map_err(|error| database_error("widget_create_commit", error))?;
        Ok(NativeWidgetRecord {
            id,
            organisation_id: request.organisation_id,
            name: name.to_string(),
            sku,
            quantity: request.quantity,
            deleted_at: None,
        })
    }

    pub fn create_widgets(
        &self,
        principal: &NativePrincipal,
        request: NativeWidgetBulkCreateRequest,
    ) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
        if !principal.can("widgets.create") {
            return Err(PlatformError::new(
                "AUTHORIZATION_ERROR",
                "Native principal lacks widgets.create",
                "You are not authorized to create widgets",
                "widget_create_permission_denied",
            ));
        }
        if principal.organisation_id != request.organisation_id {
            return Err(PlatformError::new(
                "AUTHORIZATION_ERROR",
                "Widget organisation scope does not match native principal",
                "You are not authorized to modify this organisation",
                "widget_create_scope_denied",
            ));
        }

        let normalized = request
            .widgets
            .clone()
            .into_iter()
            .map(|item| normalize_widget_item(item))
            .collect::<Result<Vec<_>, _>>();
        let normalized = match normalized {
            Ok(items) => items,
            Err(error) => {
                self.record_import_failure(principal, &request, &error)?;
                return Err(error);
            }
        };
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("widget_bulk_create_begin", error))?;
        let mut created = Vec::with_capacity(normalized.len());
        for (name, sku, quantity, description) in normalized {
            let id = format!(
                "wid_native_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| database_error("widget_bulk_create_clock", error))?
                    .as_nanos()
            );
            let now = current_epoch_seconds().to_string();
            transaction
                .execute(
                    "INSERT INTO widgets
                     (id, created_at, updated_at, created_by, updated_by, entity_id,
                      organisation_id, sync_group_id, schema_version, sync_version,
                      data_classification, name, sku, quantity, description)
                     VALUES (?1, ?2, ?2, ?3, ?3, ?1, ?4, ?5, 1, 1, 'INTERNAL', ?6, ?7, ?8, ?9)",
                    params![
                        id,
                        now,
                        principal.user_id,
                        request.organisation_id,
                        request.sync_group_id,
                        name,
                        sku,
                        quantity,
                        description
                    ],
                )
                .map_err(|error| database_error("widget_bulk_create_insert", error))?;
            created.push(NativeWidgetRecord {
                id,
                organisation_id: request.organisation_id.clone(),
                name,
                sku,
                quantity,
                deleted_at: None,
            });
        }
        let audit_id = format!(
            "audit_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| database_error("widget_bulk_audit_clock", error))?
                .as_nanos()
        );
        let metadata = serde_json::json!({
            "entityName": "Widgets",
            "importedCount": created.len(),
        })
        .to_string();
        transaction
            .execute(
                "INSERT INTO core_audit_events
                 (id, event_type, user_id, device_id, organisation_id,
                  correlation_id, timestamp, metadata_json)
                 VALUES (?1, 'IMPORT_COMPLETED', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    audit_id,
                    principal.user_id,
                    principal.device_id,
                    request.organisation_id,
                    request.correlation_id,
                    current_epoch_seconds().to_string(),
                    metadata
                ],
            )
            .map_err(|error| database_error("widget_bulk_audit_insert", error))?;
        transaction
            .commit()
            .map_err(|error| database_error("widget_bulk_create_commit", error))?;
        Ok(created)
    }

    fn record_import_failure(
        &self,
        principal: &NativePrincipal,
        request: &NativeWidgetBulkCreateRequest,
        error: &PlatformError,
    ) -> Result<(), PlatformError> {
        let audit_id = format!(
            "audit_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|cause| database_error("widget_failure_audit_clock", cause))?
                .as_nanos()
        );
        let metadata = serde_json::json!({
            "entityName": "Widgets",
            "errorCode": error.code,
        })
        .to_string();
        let connection = self
            .connection
            .lock()
            .map_err(|cause| database_error_message("db_lock", &cause.to_string()))?;
        connection
            .execute(
                "INSERT INTO core_audit_events
                 (id, event_type, user_id, device_id, organisation_id,
                  correlation_id, timestamp, metadata_json)
                 VALUES (?1, 'IMPORT_FAILED', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    audit_id,
                    principal.user_id,
                    principal.device_id,
                    request.organisation_id,
                    request.correlation_id,
                    current_epoch_seconds().to_string(),
                    metadata
                ],
            )
            .map_err(|cause| database_error("widget_failure_audit_insert", cause))?;
        Ok(())
    }

    fn record_mutation_failure(
        &self,
        principal: &NativePrincipal,
        event_type: &str,
        organisation_id: &str,
        correlation_id: &str,
        entity_name: &str,
        error: &PlatformError,
    ) -> Result<(), PlatformError> {
        let audit_id = format!(
            "audit_native_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|cause| database_error("mutation_failure_audit_clock", cause))?
                .as_nanos()
        );
        let metadata = serde_json::json!({
            "entityName": entity_name,
            "errorCode": error.code,
        })
        .to_string();
        let connection = self
            .connection
            .lock()
            .map_err(|cause| database_error_message("db_lock", &cause.to_string()))?;
        connection
            .execute(
                "INSERT INTO core_audit_events
                 (id, event_type, user_id, device_id, organisation_id,
                  correlation_id, timestamp, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    audit_id,
                    event_type,
                    principal.user_id,
                    principal.device_id,
                    organisation_id,
                    correlation_id,
                    current_epoch_seconds().to_string(),
                    metadata
                ],
            )
            .map_err(|cause| database_error("mutation_failure_audit_insert", cause))?;
        Ok(())
    }

    pub fn set_password_verifier(
        &self,
        user_id: &str,
        password: &str,
    ) -> Result<(), PlatformError> {
        let verifier = PasswordVerifier::new()
            .map_err(|error| authentication_error("auth_verifier_init", error))?;
        let stored_verifier = verifier
            .hash(password)
            .map_err(|error| authentication_error("auth_verifier_hash", error))?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let changed = connection
            .execute(
                "UPDATE core_users
                 SET credential_verifier = ?1,
                     credential_algorithm_version = 1,
                     failed_authentication_attempts = 0,
                     locked_until = NULL,
                     credential_updated_at = strftime('%s', 'now')
                 WHERE id = ?2",
                params![stored_verifier, user_id],
            )
            .map_err(|error| database_error("auth_credential_update", error))?;
        if changed != 1 {
            return Err(authentication_error_message(
                "auth_user_missing",
                "User credential target does not exist",
            ));
        }
        Ok(())
    }

    pub fn authenticate_user(
        &self,
        user_id: &str,
        device_id: &str,
        password: &str,
    ) -> Result<NativePrincipal, PlatformError> {
        let verifier = PasswordVerifier::new()
            .map_err(|error| authentication_error("auth_verifier_init", error))?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("auth_begin", error))?;

        let user = transaction
            .query_row(
                "SELECT organisation_id, status, credential_verifier,
                        failed_authentication_attempts, locked_until
                 FROM core_users WHERE id = ?1",
                [user_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| database_error("auth_user_lookup", error))?;

        let (organisation_id, user_status, stored_verifier, failures, locked_until) =
            user.ok_or_else(|| authentication_error_message("auth_failed", "Authentication failed"))?;
        if user_status != "ACTIVE" {
            return Err(authentication_error_message("auth_failed", "Authentication failed"));
        }

        let device_valid = transaction
            .query_row(
                "SELECT COUNT(*) FROM core_devices
                 WHERE device_id = ?1 AND status IN ('APPROVED', 'ACTIVE')
                   AND (user_id IS NULL OR user_id = ?2)",
                params![device_id, user_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| database_error("auth_device_lookup", error))?
            == 1;
        if !device_valid {
            return Err(authentication_error_message("auth_failed", "Authentication failed"));
        }

        let now = current_epoch_seconds();
        if locked_until
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|until| until > now)
        {
            return Err(authentication_error_message("auth_locked", "Authentication failed"));
        }

        let valid = stored_verifier
            .as_deref()
            .and_then(|hash| verifier.verify(password, hash).ok())
            .unwrap_or(false);
        if !valid {
            let next_failures = failures.saturating_add(1);
            let next_lock = if next_failures >= MAX_AUTHENTICATION_FAILURES {
                Some((now + LOCKOUT_SECONDS).to_string())
            } else {
                None
            };
            transaction
                .execute(
                    "UPDATE core_users
                     SET failed_authentication_attempts = ?1, locked_until = ?2
                     WHERE id = ?3",
                    params![next_failures, next_lock, user_id],
                )
                .map_err(|error| database_error("auth_failure_update", error))?;
            transaction
                .commit()
                .map_err(|error| database_error("auth_failure_commit", error))?;
            return Err(authentication_error_message("auth_failed", "Authentication failed"));
        }

        let permission_rows = transaction
            .prepare(
                "SELECT p.name
                 FROM core_user_roles ur
                 JOIN core_roles r ON r.id = ur.role_id AND r.organisation_id = ur.organisation_id
                 JOIN core_role_permissions rp ON rp.role_id = r.id
                 JOIN core_permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = ?1 AND ur.organisation_id = ?2
                 ORDER BY p.name",
            )
            .map_err(|error| database_error("auth_permissions_prepare", error))?
            .query_map(params![user_id, organisation_id], |row| row.get(0))
            .map_err(|error| database_error("auth_permissions_query", error))?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|error| database_error("auth_permissions_row", error))?;

        transaction
            .execute(
                "UPDATE core_users
                 SET failed_authentication_attempts = 0, locked_until = NULL
                 WHERE id = ?1",
                [user_id],
            )
            .map_err(|error| database_error("auth_success_update", error))?;
        transaction
            .commit()
            .map_err(|error| database_error("auth_success_commit", error))?;

        Ok(NativePrincipal::from_authenticated_device_session(
            user_id,
            device_id,
            organisation_id,
            permission_rows,
        ))
    }

    pub fn query_json(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        
        let mut statement = connection
            .prepare(sql)
            .map_err(|error| database_error("db_query_prepare", error))?;
        
        // Get column names first
        let col_count = statement.column_count();
        let mut col_names = Vec::new();
        for i in 0..col_count {
            let col_name = statement
                .column_name(i)
                .map_err(|error| database_error("db_query_column_name", error))?
                .to_string();
            col_names.push(col_name);
        }
        
        // Convert JSON params to SQLite params
        let sql_params: Vec<Box<dyn rusqlite::ToSql>> = params
            .iter()
            .map(|v| json_value_to_sql_param(v))
            .collect();
        
        let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params
            .iter()
            .map(|p| p.as_ref())
            .collect();
        
        let mut rows = statement
            .query(param_refs.as_slice())
            .map_err(|error| database_error("db_query_execute", error))?;
        
        let mut results = Vec::new();
        while let Some(row) = rows
            .next()
            .map_err(|error| database_error("db_query_next", error))?
        {
            let mut obj = serde_json::json!({});
            for (i, col_name) in col_names.iter().enumerate() {
                let value: serde_json::Value = match row.get_ref(i) {
                    Ok(val) => match val {
                        rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                        rusqlite::types::ValueRef::Integer(i) => serde_json::Value::Number(i.into()),
                        rusqlite::types::ValueRef::Real(f) => {
                            serde_json::Number::from_f64(f)
                                .map(serde_json::Value::Number)
                                .unwrap_or(serde_json::Value::Null)
                        }
                        rusqlite::types::ValueRef::Text(t) => {
                            serde_json::Value::String(
                                String::from_utf8_lossy(t).into_owned()
                            )
                        }
                        rusqlite::types::ValueRef::Blob(b) => {
                            // Encode blob as base64 JSON string
                            serde_json::Value::String(format!("blob:{}", base64_encode(b)))
                        }
                    },
                    Err(_) => serde_json::Value::Null,
                };
                obj[col_name.clone()] = value;
            }
            results.push(obj);
        }
        
        Ok(serde_json::json!({"rows": results}))
    }

    pub fn execute_json(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        
        let mut statement = connection
            .prepare(sql)
            .map_err(|error| database_error("db_execute_prepare", error))?;
        
        // Convert JSON params to SQLite params
        let sql_params: Vec<Box<dyn rusqlite::ToSql>> = params
            .iter()
            .map(|v| json_value_to_sql_param(v))
            .collect();
        
        let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params
            .iter()
            .map(|p| p.as_ref())
            .collect();
        
        statement
            .execute(param_refs.as_slice())
            .map_err(|error| database_error("db_execute", error))
            .map(|rows_affected| {
                serde_json::json!({"rows_affected": rows_affected})
            })
    }

    pub fn transaction_json(
        &self,
        operations: Vec<DbJsonOperation>,
    ) -> Result<(), PlatformError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| database_error_message("db_lock", "Database connection lock poisoned"))?;
        
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| database_error("db_transaction_begin", error))?;
        
        for op in operations {
            let mut statement = transaction
                .prepare(&op.sql)
                .map_err(|error| database_error("db_transaction_prepare", error))?;
            
            // Convert JSON params to SQLite params
            let sql_params: Vec<Box<dyn rusqlite::ToSql>> = op
                .params
                .iter()
                .map(|v| json_value_to_sql_param(v))
                .collect();
            
            let param_refs: Vec<&dyn rusqlite::ToSql> = sql_params
                .iter()
                .map(|p| p.as_ref())
                .collect();
            
            match op.op_type.as_str() {
                "query" => {
                    let mut rows = statement
                        .query(param_refs.as_slice())
                        .map_err(|error| database_error("db_transaction_query", error))?;
                    while rows
                        .next()
                        .map_err(|error| database_error("db_transaction_next", error))?
                        .is_some()
                    {
                        // Consume rows
                    }
                }
                "execute" => {
                    statement
                        .execute(param_refs.as_slice())
                        .map_err(|error| database_error("db_transaction_execute", error))?;
                }
                _ => {
                    return Err(database_error_message(
                        "db_transaction_invalid_op",
                        &format!("Invalid operation type: {}", op.op_type),
                    ));
                }
            }
        }
        
        transaction
            .commit()
            .map_err(|error| database_error("db_transaction_commit", error))
    }
}

fn database_error(code: &str, error: impl std::fmt::Display) -> PlatformError {
    database_error_message(code, &error.to_string())
}

fn normalize_widget_item(
    item: NativeWidgetCreateItem,
) -> Result<(String, String, i64, Option<String>), PlatformError> {
    let name = item.name.trim().to_string();
    let sku = item.sku.trim().to_uppercase();
    if name.is_empty() || sku.is_empty() || item.quantity < 0 {
        return Err(PlatformError::new(
            "VALIDATION_ERROR",
            "Invalid widget bulk create input",
            "Provide a name, SKU, and non-negative quantity",
            "widget_bulk_create_validation",
        ));
    }
    Ok((name, sku, item.quantity, item.description))
}

fn database_error_message(code: &str, message: &str) -> PlatformError {
    PlatformError::new(
        "DATABASE_ERROR",
        message,
        "Unable to access local database",
        code,
    )
    .with_details(message)
}

fn base64_encode(data: &[u8]) -> String {
    // Manual base64 encoding since we don't have base64 crate
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    
    for chunk in data.chunks(3) {
        let b1 = chunk[0];
        let b2 = chunk.get(1).copied().unwrap_or(0);
        let b3 = chunk.get(2).copied().unwrap_or(0);
        
        let n = ((b1 as u32) << 16) | ((b2 as u32) << 8) | (b3 as u32);
        
        result.push(TABLE[((n >> 18) & 63) as usize] as char);
        result.push(TABLE[((n >> 12) & 63) as usize] as char);
        
        if chunk.len() > 1 {
            result.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        
        if chunk.len() > 2 {
            result.push(TABLE[(n & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    
    result
}

fn json_value_to_sql_param(value: &serde_json::Value) -> Box<dyn rusqlite::ToSql> {
    match value {
        serde_json::Value::Null => Box::new(None::<String>),
        serde_json::Value::Bool(b) => Box::new(if *b { 1i64 } else { 0i64 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(u) = n.as_u64() {
                Box::new(u as i64)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(None::<String>)
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            // Serialize complex types as JSON strings
            Box::new(value.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("tauri-boilerplate-{name}-{suffix}.db"))
    }

    #[test]
    fn configures_and_reports_durable_sqlite_state() {
        let path = test_path("health");
        let database = DurableDatabase::open(&path).expect("database should open");
        let health = database.health_check().expect("health check should pass");

        assert_eq!(health.journal_mode, "wal");
        assert!(health.foreign_keys_enabled);
        assert_eq!(health.integrity_check, "ok");

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn committed_data_survives_reopening_the_database() {
        let path = test_path("restart");
        {
            let database = DurableDatabase::open(&path).expect("database should open");
            database
                .execute_batch(
                    "CREATE TABLE values_table (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
                     INSERT INTO values_table (value) VALUES ('persisted');",
                )
                .expect("write should commit");
        }

        let database = DurableDatabase::open(&path).expect("database should reopen");
        let health = database.health_check().expect("health check should pass");
        assert_eq!(health.integrity_check, "ok");
        database
            .execute_batch("SELECT value FROM values_table;")
            .expect("reopened database should contain the table");

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn device_identity_binding_survives_database_restart() {
        let path = test_path("device-identity");
        let first = {
            let database = DurableDatabase::open(&path).expect("database should open");
            database
                .apply_migrations(&crate::core_migrations())
                .expect("core migrations should apply");
            database
                .load_or_create_device_identity("app.test", "windows")
                .expect("device identity should bind");
        };
        let second = {
            let database = DurableDatabase::open(&path).expect("database should reopen");
            database
                .load_or_create_device_identity("app.test", "windows")
                .expect("device identity should reload");
        };

        assert_eq!(first, second);

        let database = DurableDatabase::open(&path).expect("database should reopen for count");
        let connection = database.connection.lock().unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_devices WHERE application_id = 'app.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        drop(connection);
        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn foreign_key_constraints_are_enforced() {
        let path = test_path("foreign-keys");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .execute_batch(
                "CREATE TABLE parent (id INTEGER PRIMARY KEY);
                 CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));",
            )
            .expect("schema should create");

        let error = database
            .execute_batch("INSERT INTO child (parent_id) VALUES (999);")
            .expect_err("orphan row should be rejected");
        assert_eq!(error.code, "DATABASE_ERROR");

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn failed_transaction_does_not_commit_partial_changes() {
        let path = test_path("transaction");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .execute_batch("CREATE TABLE events (value TEXT NOT NULL);")
            .expect("schema should create");

        let error = database
            .transaction(
                "INSERT INTO events (value) VALUES ('committed');
                 INSERT INTO missing_table (value) VALUES ('rolled back');",
            )
            .expect_err("transaction should fail");
        assert_eq!(error.code, "DATABASE_ERROR");

        let connection = database
            .connection
            .lock()
            .expect("database lock should be available");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(count, 0);

        drop(connection);
        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn applies_native_migrations_idempotently_in_platform_order() {
        let path = test_path("migrations");
        let database = DurableDatabase::open(&path).expect("database should open");
        let migrations = vec![
            NativeMigration {
                owner: "feature.widgets".to_string(),
                version: 1,
                name: "create_widgets".to_string(),
                checksum: "feature-1".to_string(),
                sql: "CREATE TABLE widgets (id TEXT PRIMARY KEY);".to_string(),
            },
            NativeMigration {
                owner: "platform".to_string(),
                version: 1,
                name: "create_organisations".to_string(),
                checksum: "platform-1".to_string(),
                sql: "CREATE TABLE organisations (id TEXT PRIMARY KEY);".to_string(),
            },
        ];

        assert_eq!(database.apply_migrations(&migrations).unwrap(), 2);
        assert_eq!(database.apply_migrations(&migrations).unwrap(), 0);
        let connection = database.connection.lock().unwrap();
        let first_owner: String = connection
            .query_row(
                "SELECT owner FROM core_migrations ORDER BY rowid LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first_owner, "platform");
        drop(connection);

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn rejects_checksum_changes_and_rolls_back_failed_migrations() {
        let path = test_path("migration-failure");
        let database = DurableDatabase::open(&path).expect("database should open");
        let broken = NativeMigration {
            owner: "platform".to_string(),
            version: 1,
            name: "create_before_failure".to_string(),
            checksum: "original".to_string(),
            sql: "CREATE TABLE before_failure (id TEXT PRIMARY KEY);
                  INSERT INTO missing_table VALUES ('fail');"
                .to_string(),
        };

        assert!(database.apply_migrations(&[broken.clone()]).is_err());
        let connection = database.connection.lock().unwrap();
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'before_failure'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 0);
        drop(connection);

        let valid = NativeMigration {
            sql: "CREATE TABLE before_failure (id TEXT PRIMARY KEY);".to_string(),
            ..broken.clone()
        };
        assert_eq!(database.apply_migrations(&[valid]).unwrap(), 1);

        let changed = NativeMigration {
            checksum: "changed".to_string(),
            ..broken
        };
        assert!(database.apply_migrations(&[changed]).is_err());

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn lists_only_authorized_widgets_within_the_principal_organisation() {
        let path = test_path("widget-read");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .apply_migrations(&[NativeMigration {
                owner: "feature.example-feature".to_string(),
                version: 1,
                name: "create_widgets_table".to_string(),
                checksum: "chk_widgets_001".to_string(),
                sql: include_str!("../../../features/example-feature/src/migrations/widgets-schema.sql")
                    .to_string(),
            }])
            .expect("widget migration should apply");
        database
            .execute_batch(
                "INSERT INTO widgets
                 (id, created_at, updated_at, entity_id, organisation_id, sync_group_id, name, sku, quantity)
                 VALUES
                 ('w1', 'now', 'now', 'e1', 'org_1', 'group_1', 'Alpha', 'A-1', 5),
                 ('w2', 'now', 'now', 'e2', 'org_2', 'group_2', 'Beta', 'B-1', 7),
                 ('w3', 'now', 'now', 'e3', 'org_1', 'group_1', 'Deleted', 'D-1', 9); 
                 UPDATE widgets SET deleted_at = 'now' WHERE id = 'w3';",
            )
            .expect("widget data should insert");

        let principal = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["widgets.read".to_string()],
        );
        let widgets = database
            .list_widgets(&principal, "org_1")
            .expect("authorized read should succeed");
        assert_eq!(widgets.len(), 1);
        assert_eq!(widgets[0].id, "w1");

        assert!(database.list_widgets(&principal, "org_2").is_err());
        let denied = NativePrincipal::from_authenticated_session("user_1", "org_1", Vec::new());
        assert!(database.list_widgets(&denied, "org_1").is_err());

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn creates_widgets_only_for_authorized_principal_scope() {
        let path = test_path("widget-create");
        let database = DurableDatabase::open(&path).expect("database should open");
        let mut migrations = crate::core_migrations();
        migrations.push(NativeMigration {
            owner: "feature.example-feature".to_string(),
            version: 1,
            name: "create_widgets_table".to_string(),
            checksum: "chk_widgets_001".to_string(),
            sql: include_str!("../../../features/example-feature/src/migrations/widgets-schema.sql")
                .to_string(),
        });
        database
            .apply_migrations(&migrations)
            .expect("widget migration should apply");

        let principal = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["widgets.create".to_string()],
        );
        let created = database
            .create_widget(
                &principal,
                NativeWidgetCreateRequest {
                    organisation_id: "org_1".to_string(),
                    sync_group_id: "group_1".to_string(),
                    name: "  Alpha  ".to_string(),
                    sku: "a-1".to_string(),
                    quantity: 5,
                    description: None,
                    correlation_id: "corr_widget_alpha".to_string(),
                },
            )
            .expect("authorized create should succeed");
        assert_eq!(created.name, "Alpha");
        assert_eq!(created.sku, "A-1");
        let connection = database.connection.lock().unwrap();
        let audit: (String, String, String) = connection
            .query_row(
                "SELECT event_type, device_id, correlation_id
                 FROM core_audit_events WHERE event_type = 'WIDGET_CREATED'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(audit, ("WIDGET_CREATED".to_string(), "test-device".to_string(), "corr_widget_alpha".to_string()));
        drop(connection);

        let validation_error = database
            .create_widget(
                &principal,
                NativeWidgetCreateRequest {
                    organisation_id: "org_1".to_string(),
                    sync_group_id: "group_1".to_string(),
                    name: "Invalid".to_string(),
                    sku: "I-1".to_string(),
                    quantity: -1,
                    description: None,
                    correlation_id: "corr_widget_invalid".to_string(),
                },
            )
            .expect_err("invalid quantity should fail");
        assert_eq!(validation_error.code, "VALIDATION_ERROR");
        let connection = database.connection.lock().unwrap();
        let failure_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events WHERE event_type = 'WIDGET_CREATE_FAILED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failure_count, 1);
        drop(connection);

        assert!(database
            .create_widget(
                &principal,
                NativeWidgetCreateRequest {
                    organisation_id: "org_2".to_string(),
                    sync_group_id: "group_2".to_string(),
                    name: "Beta".to_string(),
                    sku: "B-1".to_string(),
                    quantity: 1,
                    description: None,
                    correlation_id: "corr_widget_beta".to_string(),
                },
            )
            .is_err());

        let denied = NativePrincipal::from_authenticated_session("user_1", "org_1", Vec::new());
        assert!(database
            .create_widget(
                &denied,
                NativeWidgetCreateRequest {
                    organisation_id: "org_1".to_string(),
                    sync_group_id: "group_1".to_string(),
                    name: "Gamma".to_string(),
                    sku: "G-1".to_string(),
                    quantity: 1,
                    description: None,
                    correlation_id: "corr_widget_gamma".to_string(),
                },
            )
            .is_err());

        let connection = database.connection.lock().unwrap();
        let failure_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events WHERE event_type = 'WIDGET_CREATE_FAILED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failure_count, 3);
        drop(connection);

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn bulk_widget_create_rolls_back_when_any_item_is_invalid() {
        let path = test_path("widget-bulk-rollback");
        let database = DurableDatabase::open(&path).expect("database should open");
        let mut migrations = crate::core_migrations();
        migrations.push(NativeMigration {
            owner: "feature.example-feature".to_string(),
            version: 1,
            name: "create_widgets_table".to_string(),
            checksum: "chk_widgets_001".to_string(),
            sql: include_str!("../../../features/example-feature/src/migrations/widgets-schema.sql")
                .to_string(),
        });
        database
            .apply_migrations(&migrations)
            .expect("widget migration should apply");
        let principal = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["widgets.create".to_string()],
        );

        database
            .create_widgets(
                &principal,
                NativeWidgetBulkCreateRequest {
                    organisation_id: "org_1".to_string(),
                    sync_group_id: "group_1".to_string(),
                    correlation_id: "corr_bulk_success".to_string(),
                    widgets: vec![NativeWidgetCreateItem {
                        name: "Existing".to_string(),
                        sku: "E-1".to_string(),
                        quantity: 1,
                        description: None,
                    }],
                },
            )
            .expect("valid bulk create should succeed");

        let connection = database.connection.lock().unwrap();
        let audit_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events WHERE event_type = 'IMPORT_COMPLETED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(audit_count, 1);
        drop(connection);

        let error = database
            .create_widgets(
                &principal,
                NativeWidgetBulkCreateRequest {
                    organisation_id: "org_1".to_string(),
                    sync_group_id: "group_1".to_string(),
                    correlation_id: "corr_bulk_rollback".to_string(),
                    widgets: vec![
                        NativeWidgetCreateItem {
                            name: "Valid".to_string(),
                            sku: "V-1".to_string(),
                            quantity: 1,
                            description: None,
                        },
                        NativeWidgetCreateItem {
                            name: "Invalid".to_string(),
                            sku: "I-1".to_string(),
                            quantity: -1,
                            description: None,
                        },
                    ],
                },
            )
            .expect_err("invalid item should abort the whole batch");
        assert_eq!(error.code, "VALIDATION_ERROR");

        let widgets = database
            .list_widgets(&
                &NativePrincipal::from_authenticated_session(
                    "user_1",
                    "org_1",
                    vec!["widgets.read".to_string()],
                ),
                "org_1",
            )
            .expect("authorized read should succeed");
        assert_eq!(widgets.len(), 1);

        let connection = database.connection.lock().unwrap();
        let audit_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events WHERE event_type = 'IMPORT_COMPLETED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(audit_count, 1);
        let failure_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events WHERE event_type = 'IMPORT_FAILED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failure_count, 1);
        drop(connection);

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn lists_only_the_authenticated_organisation_for_authorized_principal() {
        let path = test_path("organisation-read");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .apply_migrations(&crate::core_migrations())
            .expect("core migrations should apply");
        database
            .execute_batch(
                "INSERT INTO core_organisations
                 (id, created_at, updated_at, name, domain, status)
                 VALUES
                 ('org_1', 'now', 'now', 'Acme', 'acme.example', 'ACTIVE'),
                 ('org_2', 'now', 'now', 'Other', 'other.example', 'ACTIVE');",
            )
            .expect("organisation fixtures should insert");

        let principal = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["organisations.read".to_string()],
        );
        let organisations = database
            .list_organisations(&principal)
            .expect("authorized organisation read should succeed");
        assert_eq!(organisations.len(), 1);
        assert_eq!(organisations[0].id, "org_1");

        let manager = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["organisations.manage".to_string()],
        );
        assert_eq!(database.list_organisations(&manager).unwrap().len(), 2);

        let denied = NativePrincipal::from_authenticated_session("user_1", "org_1", Vec::new());
        assert!(database.list_organisations(&denied).is_err());

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn creates_organisations_with_native_identity_and_unique_domain() {
        let path = test_path("organisation-create");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .apply_migrations(&crate::core_migrations())
            .expect("core migrations should apply");
        database
            .execute_batch(
                "INSERT INTO core_organisations
                 (id, created_at, updated_at, name, domain, status)
                 VALUES ('org_1', 'now', 'now', 'Acme', NULL, 'ACTIVE');",
            )
            .expect("organisation fixture should insert");

        let principal = NativePrincipal::from_authenticated_session(
            "user_1",
            "org_1",
            vec!["organisations.create".to_string()],
        );
        let validation_error = database
            .create_organisation(
                &principal,
                NativeOrganisationCreateRequest {
                    name: "  ".to_string(),
                    domain: None,
                    correlation_id: "corr_org_invalid".to_string(),
                },
            )
            .expect_err("empty organisation name should fail");
        assert_eq!(validation_error.code, "VALIDATION_ERROR");
        let connection = database.connection.lock().unwrap();
        let failure_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events
                 WHERE event_type = 'ORGANISATION_CREATE_FAILED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failure_count, 1);
        drop(connection);

        let created = database
            .create_organisation(
                &principal,
                NativeOrganisationCreateRequest {
                    name: "  New Org  ".to_string(),
                    domain: Some(" NEW.EXAMPLE ".to_string()),
                    correlation_id: "corr_org_create".to_string(),
                },
            )
            .expect("authorized create should succeed");
        assert_eq!(created.name, "New Org");
        assert_eq!(created.domain.as_deref(), Some("new.example"));
        let connection = database.connection.lock().unwrap();
        let audit: (String, String, String) = connection
            .query_row(
                "SELECT event_type, device_id, correlation_id
                 FROM core_audit_events WHERE event_type = 'ORGANISATION_CREATED'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(audit, ("ORGANISATION_CREATED".to_string(), "test-device".to_string(), "corr_org_create".to_string()));
        drop(connection);

        let duplicate = database
            .create_organisation(
                &principal,
                NativeOrganisationCreateRequest {
                    name: "Other Org".to_string(),
                    domain: Some("new.example".to_string()),
                    correlation_id: "corr_org_duplicate".to_string(),
                },
            )
            .expect_err("duplicate domain should be rejected");
        assert_eq!(duplicate.code, "VALIDATION_ERROR");

        let denied = NativePrincipal::from_authenticated_session("user_1", "org_1", Vec::new());
        assert!(database
            .create_organisation(
                &denied,
                NativeOrganisationCreateRequest {
                    name: "Denied".to_string(),
                    domain: None,
                    correlation_id: "corr_org_denied".to_string(),
                },
            )
            .is_err());

        let connection = database.connection.lock().unwrap();
        let failure_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM core_audit_events
                 WHERE event_type = 'ORGANISATION_CREATE_FAILED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failure_count, 3);
        drop(connection);

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn authenticates_active_user_and_derives_permissions_from_native_state() {
        let path = test_path("authentication");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .apply_migrations(&crate::core_migrations())
            .expect("core migrations should apply");
        database
            .execute_batch(
                "INSERT INTO core_organisations (id, created_at, updated_at, name)
                 VALUES ('org_1', 'now', 'now', 'Acme');
                 INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_1', 'now', 'now', 'org_1', 'Alice', 'ACTIVE');
                 INSERT INTO core_devices
                 (id, created_at, updated_at, device_id, public_key, platform, application_id, status, registered_at)
                 VALUES ('device_row', 'now', 'now', 'device_1', 'public', 'windows', 'demo', 'ACTIVE', 'now');
                 INSERT INTO core_roles
                 (id, created_at, updated_at, organisation_id, name)
                 VALUES ('role_1', 'now', 'now', 'org_1', 'Reader');
                 INSERT INTO core_permissions (id, name) VALUES ('perm_1', 'widgets.read');
                 INSERT INTO core_role_permissions (id, role_id, permission_id)
                 VALUES ('role_perm_1', 'role_1', 'perm_1');
                 INSERT INTO core_user_roles
                 (id, user_id, role_id, organisation_id, granted_at)
                 VALUES ('user_role_1', 'user_1', 'role_1', 'org_1', 'now');",
            )
            .expect("authentication fixtures should insert");
        database
            .set_password_verifier("user_1", "correct password")
            .expect("password verifier should be stored");

        let principal = database
            .authenticate_user("user_1", "device_1", "correct password")
            .expect("valid credentials should authenticate");
        assert_eq!(principal.organisation_id, "org_1");
        assert!(principal.can("widgets.read"));
        assert!(!principal.can("widgets.write"));

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn locks_after_repeated_failures_and_denies_correct_password() {
        let path = test_path("authentication-lockout");
        let database = DurableDatabase::open(&path).expect("database should open");
        database
            .apply_migrations(&crate::core_migrations())
            .expect("core migrations should apply");
        database
            .execute_batch(
                "INSERT INTO core_organisations (id, created_at, updated_at, name)
                 VALUES ('org_1', 'now', 'now', 'Acme');
                 INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_1', 'now', 'now', 'org_1', 'Alice', 'ACTIVE');
                 INSERT INTO core_devices
                 (id, created_at, updated_at, device_id, public_key, platform, application_id, status, registered_at)
                 VALUES ('device_row', 'now', 'now', 'device_1', 'public', 'windows', 'demo', 'ACTIVE', 'now');",
            )
            .expect("authentication fixtures should insert");
        database
            .set_password_verifier("user_1", "correct password")
            .expect("password verifier should be stored");

        for _ in 0..MAX_AUTHENTICATION_FAILURES {
            assert!(database
                .authenticate_user("user_1", "device_1", "wrong password")
                .is_err());
        }
        let locked = database
            .authenticate_user("user_1", "device_1", "correct password")
            .expect_err("locked user must not authenticate");
        assert_eq!(locked.code, "AUTHENTICATION_ERROR");

        let unknown_device = database
            .authenticate_user("user_1", "unknown", "correct password")
            .expect_err("unknown device must not authenticate");
        assert_eq!(unknown_device.code, "AUTHENTICATION_ERROR");

        drop(database);
        fs::remove_file(&path).expect("database file should exist");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    // WP-001: Durable SQLite adapter tests
    #[test]
    fn restart_persistence_survives_close_and_reopen() {
        let path = test_path("wp001-restart-persistence");
        
        // Write data to database
        {
            let db = DurableDatabase::open(&path).expect("database should open");
            db.apply_migrations(&crate::core_migrations())
                .expect("core migrations should apply");
            db.execute_batch(
                "INSERT INTO core_organisations (id, created_at, updated_at, name)
                 VALUES ('org_persist', '2024-01-01', '2024-01-01', 'Persistent Org');",
            )
            .expect("insert should succeed");
            // Database drops here, file should be persisted
        }
        
        // Verify data persists after reopening
        {
            let db = DurableDatabase::open(&path).expect("database should reopen");
            let result: String = db
                .connection
                .lock()
                .expect("lock should work")
                .query_row("SELECT name FROM core_organisations WHERE id = 'org_persist'", [], |row| {
                    row.get(0)
                })
                .expect("query should work");
            
            assert_eq!(result, "Persistent Org");
        }
        
        fs::remove_file(&path).expect("cleanup");
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn foreign_key_enforcement_prevents_orphaned_records() {
        let path = test_path("wp001-foreign-key-enforcement");
        {
            let db = DurableDatabase::open(&path).expect("database should open");
            db.apply_migrations(&crate::core_migrations())
                .expect("core migrations should apply");
            
            // FK constraint: core_users.organisation_id -> core_organisations.id
            let org_insert = db.execute_batch(
                "INSERT INTO core_organisations (id, created_at, updated_at, name)
                 VALUES ('org_fk_test', '2024-01-01', '2024-01-01', 'Test Org');",
            );
            assert!(org_insert.is_ok(), "valid org insert should succeed");
            
            // Try to insert user with non-existent organisation
            let invalid_user = db.execute_batch(
                "INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_fk_invalid', '2024-01-01', '2024-01-01', 'org_nonexistent', 'Invalid', 'ACTIVE');",
            );
            assert!(invalid_user.is_err(), "FK violation should fail");
            
            // Valid insert with existing organisation
            let valid_user = db.execute_batch(
                "INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_fk_valid', '2024-01-01', '2024-01-01', 'org_fk_test', 'Valid', 'ACTIVE');",
            );
            assert!(valid_user.is_ok(), "valid FK insert should succeed");
        }
        
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn wal_mode_is_enabled() {
        let path = test_path("wp001-wal-mode");
        {
            let db = DurableDatabase::open(&path).expect("database should open");
            let health = db.health_check().expect("health check should work");
            
            assert_eq!(health.journal_mode, "wal", "journal mode should be WAL");
        }
        
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn integrity_check_passes() {
        let path = test_path("wp001-integrity-check");
        {
            let db = DurableDatabase::open(&path).expect("database should open");
            db.apply_migrations(&crate::core_migrations())
                .expect("core migrations should apply");
            
            let health = db.health_check().expect("health check should work");
            
            assert!(health.foreign_keys_enabled, "foreign keys should be enabled");
            assert_eq!(health.integrity_check, "ok", "integrity check should pass");
        }
        
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn transaction_rollback_undoes_all_operations() {
        let path = test_path("wp001-transaction-rollback");
        {
            let db = DurableDatabase::open(&path).expect("database should open");
            db.apply_migrations(&crate::core_migrations())
                .expect("core migrations should apply");
            
            // Insert valid org
            db.execute_batch(
                "INSERT INTO core_organisations (id, created_at, updated_at, name)
                 VALUES ('org_rollback', '2024-01-01', '2024-01-01', 'Rollback Test');",
            )
            .expect("insert should succeed");
            
            // Try transaction with partial failure (FK violation in the middle)
            let failed_tx = db.transaction(
                "INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_1', '2024-01-01', '2024-01-01', 'org_rollback', 'Alice', 'ACTIVE');
                 INSERT INTO core_users
                 (id, created_at, updated_at, organisation_id, display_name, status)
                 VALUES ('user_2', '2024-01-01', '2024-01-01', 'org_nonexistent', 'Invalid', 'ACTIVE');",
            );
            
            assert!(failed_tx.is_err(), "transaction with FK violation should fail");
            
            // Verify first insert was rolled back
            let user_count: i64 = db
                .connection
                .lock()
                .expect("lock should work")
                .query_row("SELECT COUNT(*) FROM core_users", [], |row| row.get(0))
                .expect("query should work");
            
            assert_eq!(user_count, 0, "all user inserts should have been rolled back");
        }
        
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }
}

fn migration_owner_order(owner: &str) -> (u8, &str) {
    if owner == "platform" {
        (0, owner)
    } else {
        (1, owner)
    }
}

fn authentication_error(code: &str, error: impl std::fmt::Display) -> PlatformError {
    authentication_error_message(code, &error.to_string())
}

fn authentication_error_message(code: &str, message: &str) -> PlatformError {
    PlatformError::new(
        "AUTHENTICATION_ERROR",
        message,
        "Authentication failed",
        code,
    )
}

fn current_epoch_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}