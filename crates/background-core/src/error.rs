use thiserror::Error;

/// Errors that may arise from the background scheduling subsystem.
#[derive(Debug, Error)]
pub enum BackgroundError {
    #[error("scheduler is already running")]
    AlreadyRunning,

    #[error("scheduler is not running")]
    NotRunning,

    #[error("database error: {0}")]
    Database(String),

    #[error("tokio join error: {0}")]
    Join(String),
}

impl From<BackgroundError> for native_core::PlatformError {
    fn from(err: BackgroundError) -> Self {
        let (code, message) = match &err {
            BackgroundError::AlreadyRunning => ("bg_already_running", err.to_string()),
            BackgroundError::NotRunning => ("bg_not_running", err.to_string()),
            BackgroundError::Database(_) => ("bg_database_error", err.to_string()),
            BackgroundError::Join(_) => ("bg_join_error", err.to_string()),
        };
        native_core::PlatformError::new(
            code,
            message,
            "Background scheduler error",
            "background-core",
        )
    }
}
