//! BackgroundLifecycleState — managed Tauri state that owns the `OutboxScheduler`.
//!
//! This struct is registered with `app.manage(BackgroundLifecycleState::new(db_path))`
//! in the Tauri `setup` closure and then accessed from the `background_start`,
//! `background_stop`, and `background_status` Tauri commands.
//!
//! # Idempotency
//!
//! `start()` is idempotent: calling it while a scheduler is already running returns
//! `Ok(())` without spawning a second loop. This allows the webview to call
//! `background_start` on every page load / `DOMContentLoaded` event.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::BackgroundError;
use crate::scheduler::{EmitFn, OutboxSchedulerConfig, OutboxSchedulerHandle};

// ---------------------------------------------------------------------------
// Status snapshot
// ---------------------------------------------------------------------------

/// A point-in-time snapshot of the scheduler's status.
#[derive(Debug, serde::Serialize)]
pub struct BackgroundSchedulerStatus {
    pub running: bool,
}

// ---------------------------------------------------------------------------
// BackgroundLifecycleState
// ---------------------------------------------------------------------------

pub struct BackgroundLifecycleState {
    db_path: PathBuf,
    config: OutboxSchedulerConfig,
    handle: Mutex<Option<OutboxSchedulerHandle>>,
}

impl BackgroundLifecycleState {
    /// Creates a new, stopped lifecycle state.
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            config: OutboxSchedulerConfig::default(),
            handle: Mutex::new(None),
        }
    }

    /// Creates a new lifecycle state with a custom scheduler configuration.
    /// Primarily useful for tests with shorter intervals.
    pub fn with_config(db_path: PathBuf, config: OutboxSchedulerConfig) -> Self {
        Self {
            db_path,
            config,
            handle: Mutex::new(None),
        }
    }

    /// Starts the background scheduler if it is not already running.
    ///
    /// `emit_fn` is called on each tick with the `SyncTickPayload`. In
    /// production this wraps `app_handle.emit("background://sync-tick", &payload)`.
    pub fn start(&self, emit_fn: EmitFn) -> Result<(), BackgroundError> {
        let mut lock = self
            .handle
            .lock()
            .map_err(|_| BackgroundError::Database("lifecycle mutex poisoned".to_string()))?;

        // Idempotent: if a handle exists and the task is still alive, no-op.
        if let Some(h) = lock.as_ref() {
            if h.is_running() {
                return Ok(());
            }
        }

        let new_handle =
            crate::scheduler::start(self.db_path.clone(), self.config.clone(), emit_fn)?;
        *lock = Some(new_handle);
        Ok(())
    }

    /// Stops the background scheduler, awaiting graceful teardown.
    /// Returns `Err(BackgroundError::NotRunning)` if the scheduler is not active.
    pub async fn stop(&self) -> Result<(), BackgroundError> {
        let handle = {
            let mut lock = self
                .handle
                .lock()
                .map_err(|_| BackgroundError::Database("lifecycle mutex poisoned".to_string()))?;
            lock.take()
        };

        match handle {
            None => Err(BackgroundError::NotRunning),
            Some(h) => h.stop().await,
        }
    }

    /// Returns the current scheduler status without blocking.
    pub fn status(&self) -> BackgroundSchedulerStatus {
        let lock = self.handle.lock().unwrap_or_else(|p| p.into_inner());
        let running = lock.as_ref().map(|h| h.is_running()).unwrap_or(false);
        BackgroundSchedulerStatus { running }
    }
}
