//! `background-core` — Native background execution primitives for the Tauri boilerplate.
//!
//! Provides:
//! - `OutboxScheduler`: a tokio interval loop that polls `core_sync_outbox` and emits
//!   `background://sync-tick` Tauri events when pending work is detected.
//! - `BackgroundLifecycleState`: idempotent start/stop lifecycle wrapper, registered as
//!   Tauri managed state.
//!
//! This crate is Tauri-version-agnostic: it depends on `native-core` and `tokio` but does
//! not import the `tauri` crate directly. The Tauri `EmitFn` callback is injected by the
//! application crate (`apps/demo/src-tauri`), keeping this crate reusable across apps.

pub mod error;
pub mod lifecycle;
pub mod scheduler;

pub use error::BackgroundError;
pub use lifecycle::{BackgroundLifecycleState, BackgroundSchedulerStatus};
pub use scheduler::{
    start as start_scheduler, EmitFn, OutboxSchedulerConfig, OutboxSchedulerHandle, SyncTickPayload,
};
