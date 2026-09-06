use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::{
    DurableDatabase, NativeOrganisationCreateRequest, NativeOrganisationRecord, NativePrincipal,
    NativeWidgetBulkCreateRequest, NativeWidgetCreateRequest, NativeWidgetRecord, PlatformError,
};

#[derive(Debug, Deserialize)]
pub struct AuthenticateUserRequest {
    pub user_id: String,
    pub device_id: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NativeSessionView {
    pub user_id: String,
    pub organisation_id: String,
    pub permissions: Vec<String>,
}

pub struct NativeSessionStore {
    current: Mutex<Option<NativePrincipal>>,
}

impl NativeSessionStore {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    pub fn authenticate(
        &self,
        database: &DurableDatabase,
        request: AuthenticateUserRequest,
    ) -> Result<NativeSessionView, PlatformError> {
        let principal = database.authenticate_user(
            &request.user_id,
            &request.device_id,
            &request.password,
        )?;
        let view = session_view(&principal);
        let mut current = self
            .current
            .lock()
            .map_err(|_| session_error("session_lock", "Session state lock poisoned"))?;
        *current = Some(principal);
        Ok(view)
    }

    pub fn current_principal(&self) -> Result<NativePrincipal, PlatformError> {
        self.current
            .lock()
            .map_err(|_| session_error("session_lock", "Session state lock poisoned"))?
            .clone()
            .ok_or_else(|| session_error("session_missing", "No authenticated native session"))
    }

    pub fn logout(&self) -> Result<(), PlatformError> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| session_error("session_lock", "Session state lock poisoned"))?;
        *current = None;
        Ok(())
    }
}

impl Default for NativeSessionStore {
    fn default() -> Self {
        Self::new()
    }
}

pub fn session_view(principal: &NativePrincipal) -> NativeSessionView {
    NativeSessionView {
        user_id: principal.user_id.clone(),
        organisation_id: principal.organisation_id.clone(),
        permissions: principal.permissions.clone(),
    }
}

fn session_error(code: &str, message: &str) -> PlatformError {
    PlatformError::new(
        "AUTHENTICATION_ERROR",
        message,
        "Authentication is required",
        code,
    )
}

pub fn list_widgets_for_session(
    database: &DurableDatabase,
    sessions: &NativeSessionStore,
    organisation_id: &str,
) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
    let principal = sessions.current_principal()?;
    database.list_widgets(&principal, organisation_id)
}

pub fn create_widget_for_session(
    database: &DurableDatabase,
    sessions: &NativeSessionStore,
    request: NativeWidgetCreateRequest,
) -> Result<NativeWidgetRecord, PlatformError> {
    let principal = sessions.current_principal()?;
    database.create_widget(&principal, request)
}

pub fn create_widgets_for_session(
    database: &DurableDatabase,
    sessions: &NativeSessionStore,
    request: NativeWidgetBulkCreateRequest,
) -> Result<Vec<NativeWidgetRecord>, PlatformError> {
    let principal = sessions.current_principal()?;
    database.create_widgets(&principal, request)
}

pub fn list_organisations_for_session(
    database: &DurableDatabase,
    sessions: &NativeSessionStore,
) -> Result<Vec<NativeOrganisationRecord>, PlatformError> {
    let principal = sessions.current_principal()?;
    database.list_organisations(&principal)
}

pub fn create_organisation_for_session(
    database: &DurableDatabase,
    sessions: &NativeSessionStore,
    request: NativeOrganisationCreateRequest,
) -> Result<NativeOrganisationRecord, PlatformError> {
    let principal = sessions.current_principal()?;
    database.create_organisation(&principal, request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logout_removes_the_native_principal() {
        let sessions = NativeSessionStore::new();
        assert!(sessions.current_principal().is_err());
        sessions.logout().expect("logout should be idempotent");
        assert!(sessions.current_principal().is_err());
    }
}