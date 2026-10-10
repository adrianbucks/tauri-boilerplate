//! OutboxScheduler — a tokio-based periodic background loop that ticks the
//! sync outbox at a configurable interval.
//!
//! # Design
//!
//! The scheduler runs as a detached `tokio::task` inside the Tauri process.
//! On each interval tick it:
//!   1. Opens a fresh rusqlite connection to the database path on a
//!      `spawn_blocking` thread (rusqlite `Connection` is `!Send`).
//!   2. Queries `core_sync_outbox` for distinct organisations with pending rows.
//!   3. Emits a `background://sync-tick` Tauri event carrying the pending count
//!      and organisation list, allowing the TypeScript `BackgroundLifecycleService`
//!      to enqueue an `OutboxSyncWorker` task for each organisation via the
//!      existing `TaskQueueService`.
//!
//! The scheduler is **idempotent**: if no pending rows exist the tick is a no-op
//! (no event emitted). Retries and backoff are handled by the TS task layer
//! (`TaskWorker` + `BackoffPolicy`) — the scheduler's only job is to ensure the
//! queue is awoken on a schedule even when the webview has no active listeners.
//!
//! # Lifecycle Safety
//!
//! The scheduler is controlled via a `tokio_util::sync::CancellationToken`.
//! `OutboxSchedulerHandle::stop()` cancels the token and awaits the task's
//! `JoinHandle`, ensuring graceful teardown before the process exits.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::watch;
use tokio::time;

use crate::error::BackgroundError;

// ---------------------------------------------------------------------------
// Tick event payload
// ---------------------------------------------------------------------------

/// Payload carried by the `background://sync-tick` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct SyncTickPayload {
    /// ISO-8601 UTC timestamp of the tick.
    pub ticked_at: String,
    /// Number of distinct organisations with pending outbox rows at tick time.
    pub pending_count: u64,
    /// Distinct organisation IDs that have pending outbox rows.
    pub pending_organisations: Vec<String>,
}

// ---------------------------------------------------------------------------
// Scheduler handle
// ---------------------------------------------------------------------------

/// An opaque handle to a running `OutboxScheduler`.
/// Dropping the handle closes its cancellation channel, causing the background
/// task to exit. Call `stop()` when graceful completion must be awaited.
pub struct OutboxSchedulerHandle {
    cancel_tx: watch::Sender<bool>,
    join: tokio::task::JoinHandle<()>,
}

impl OutboxSchedulerHandle {
    /// Signals the scheduler to stop and awaits clean exit.
    pub async fn stop(self) -> Result<(), BackgroundError> {
        // Sending true signals shutdown; ignore error if receiver dropped.
        let _ = self.cancel_tx.send(true);
        self.join
            .await
            .map_err(|e| BackgroundError::Join(e.to_string()))
    }

    /// Returns `true` if the underlying task is still running.
    pub fn is_running(&self) -> bool {
        !self.join.is_finished()
    }
}

// ---------------------------------------------------------------------------
// Scheduler configuration
// ---------------------------------------------------------------------------

/// Configuration for the `OutboxScheduler`.
#[derive(Debug, Clone)]
pub struct OutboxSchedulerConfig {
    /// How often to poll the outbox table (default: 30 s).
    pub interval: Duration,
}

impl Default for OutboxSchedulerConfig {
    fn default() -> Self {
        Self {
            interval: Duration::from_secs(30),
        }
    }
}

// ---------------------------------------------------------------------------
// Emit callback type
// ---------------------------------------------------------------------------

/// A trait object that can emit Tauri events from native code.
/// We use a boxed closure instead of a direct `tauri::AppHandle` reference to
/// keep this crate Tauri-version-agnostic and to allow easy mock injection in
/// unit tests.
pub type EmitFn = Box<dyn Fn(SyncTickPayload) + Send + Sync + 'static>;

// ---------------------------------------------------------------------------
// OutboxScheduler
// ---------------------------------------------------------------------------

/// Starts the background outbox polling loop and returns a handle.
///
/// # Arguments
///
/// * `db_path` - Path to the SQLite database file. The scheduler re-opens a
///   fresh connection on each tick via `spawn_blocking`, since rusqlite
///   `Connection` is `!Send`.
/// * `config`  - Scheduler timing parameters.
/// * `emit_fn` - Callback invoked with the tick payload when pending rows are
///   found. In production this wraps `tauri::AppHandle::emit`; in tests it
///   captures to a `Vec`.
pub fn start(
    db_path: PathBuf,
    config: OutboxSchedulerConfig,
    emit_fn: EmitFn,
) -> Result<OutboxSchedulerHandle, BackgroundError> {
    if config.interval.is_zero() {
        return Err(BackgroundError::InvalidConfig(
            "polling interval must be greater than zero".to_string(),
        ));
    }
    let (cancel_tx, mut cancel_rx) = watch::channel(false);

    let join = tokio::spawn(async move {
        let mut interval = time::interval(config.interval);
        // Skip missed ticks rather than bursting to catch up after sleep.
        interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                changed = cancel_rx.changed() => {
                    if changed.is_err() || *cancel_rx.borrow() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    run_tick(&db_path, &emit_fn).await;
                }
            }
        }
    });

    Ok(OutboxSchedulerHandle { cancel_tx, join })
}

// ---------------------------------------------------------------------------
// Tick implementation
// ---------------------------------------------------------------------------

/// Executes one poll cycle. Opens a fresh connection, queries the outbox for
/// pending rows, and emits an event if any are found. Infallible at the top
/// level — errors are written to stderr to avoid crashing the scheduler loop.
async fn run_tick(db_path: &Path, emit_fn: &EmitFn) {
    let ticked_at = utc_iso_now();
    let path = db_path.to_path_buf();

    let result = tokio::task::spawn_blocking(move || {
        native_core::DurableDatabase::open(&path).and_then(|db| db.query_pending_outbox_orgs())
    })
    .await;

    match result {
        Ok(Ok(orgs)) => {
            if orgs.is_empty() {
                // Nothing to do — skip emit to avoid noisy no-op events.
                return;
            }
            let payload = SyncTickPayload {
                ticked_at,
                pending_count: orgs.len() as u64,
                pending_organisations: orgs,
            };
            emit_fn(payload);
        }
        Ok(Err(e)) => {
            eprintln!("[background-core] Outbox query error on tick: {e:?}");
        }
        Err(e) => {
            eprintln!("[background-core] spawn_blocking join error on tick: {e}");
        }
    }
}

/// Returns the current UTC time as a valid ISO-8601 Gregorian timestamp.
fn utc_iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let total_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let s = total_secs % 60;
    let m = (total_secs / 60) % 60;
    let h = (total_secs / 3600) % 24;
    let days = (total_secs / 86400).min(i64::MAX as u64) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Converts days since 1970-01-01 to a Gregorian civil date.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted_days = days_since_epoch + 719_468;
    let era = if shifted_days >= 0 {
        shifted_days
    } else {
        shifted_days - 146_096
    } / 146_097;
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use native_core::DurableDatabase;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    static TEST_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn civil_date_conversion_handles_epoch_leap_day_and_year_boundary() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(19_783), (2024, 3, 1));
        assert_eq!(civil_from_days(20_088), (2024, 12, 31));
    }

    #[test]
    fn scheduler_rejects_zero_interval_before_spawning() {
        let result = start(
            PathBuf::new(),
            OutboxSchedulerConfig {
                interval: Duration::ZERO,
            },
            Box::new(|_| {}),
        );
        assert!(matches!(result, Err(BackgroundError::InvalidConfig(_))));
    }

    fn temp_db() -> (DurableDatabase, PathBuf) {
        let count = TEST_DB_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "bg_sched_test_{}_{}_{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            count
        ));
        let db = DurableDatabase::open(&path).expect("open temp db");
        (db, path)
    }

    fn outbox_schema(db: &DurableDatabase) {
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS core_sync_outbox (\
              id TEXT PRIMARY KEY,\
              envelope_id TEXT NOT NULL,\
              organisation_id TEXT NOT NULL,\
              sync_group_id TEXT NOT NULL,\
              payload_json TEXT NOT NULL,\
              signer_public_key TEXT NOT NULL,\
              signature TEXT NOT NULL,\
              status TEXT NOT NULL DEFAULT 'pending',\
              created_at TEXT NOT NULL\
            )",
        )
        .expect("create outbox table");
    }

    #[tokio::test]
    async fn scheduler_emits_no_tick_when_outbox_is_empty() {
        let (db, path) = temp_db();
        outbox_schema(&db);
        drop(db); // release connection so scheduler can open its own

        let emitted: Arc<Mutex<Vec<SyncTickPayload>>> = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();
        let emit_fn: EmitFn = Box::new(move |p| {
            emitted_clone.lock().unwrap().push(p);
        });

        let config = OutboxSchedulerConfig {
            interval: Duration::from_millis(20),
        };
        let handle = start(path.clone(), config, emit_fn).expect("valid scheduler config");

        tokio::time::sleep(Duration::from_millis(120)).await;
        handle.stop().await.expect("clean stop");

        let events = emitted.lock().unwrap();
        assert!(
            events.is_empty(),
            "Expected no tick events for empty outbox, got {}",
            events.len()
        );

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn scheduler_stops_cleanly_on_cancellation() {
        let (db, path) = temp_db();
        outbox_schema(&db);
        drop(db);

        let config = OutboxSchedulerConfig {
            interval: Duration::from_millis(50),
        };
        let emit_fn: EmitFn = Box::new(|_| {});
        let handle = start(path.clone(), config, emit_fn).expect("valid scheduler config");

        assert!(
            handle.is_running(),
            "Scheduler should be running after start"
        );
        handle.stop().await.expect("clean stop");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn scheduler_emits_tick_when_outbox_has_pending_rows() {
        let (db, path) = temp_db();
        outbox_schema(&db);
        db.execute_batch(
            "INSERT INTO core_sync_outbox \
              (id, envelope_id, organisation_id, sync_group_id, payload_json, \
               signer_public_key, signature, status, created_at) \
             VALUES ('e1','env1','org-abc','grp1','{}','pk','sig','pending','2024-01-01T00:00:00Z')",
        )
        .expect("insert outbox row");
        drop(db);

        let emitted: Arc<Mutex<Vec<SyncTickPayload>>> = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();
        let emit_fn: EmitFn = Box::new(move |p| {
            emitted_clone.lock().unwrap().push(p);
        });

        let config = OutboxSchedulerConfig {
            interval: Duration::from_millis(20),
        };
        let handle = start(path.clone(), config, emit_fn).expect("valid scheduler config");

        tokio::time::sleep(Duration::from_millis(120)).await;
        handle.stop().await.expect("clean stop");

        let events = emitted.lock().unwrap();
        assert!(
            !events.is_empty(),
            "Expected at least one tick event for pending outbox row"
        );
        assert_eq!(events[0].pending_count, 1);
        assert!(events[0]
            .pending_organisations
            .contains(&"org-abc".to_string()));

        let _ = std::fs::remove_file(&path);
    }
}
