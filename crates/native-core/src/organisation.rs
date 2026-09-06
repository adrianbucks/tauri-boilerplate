use serde::{Deserialize, Serialize};

use crate::{NativePrincipal, PlatformError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NativeOrganisationRecord {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    pub domain: Option<String>,
    pub status: String,
}

pub(crate) fn authorize_organisation_read(
    principal: &NativePrincipal,
) -> Result<(), PlatformError> {
    if !principal.can("organisations.read") && !principal.can("organisations.manage") {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Native principal lacks organisations.read",
            "You are not authorized to view organisations",
            "organisation_read_permission_denied",
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct NativeOrganisationCreateRequest {
    pub name: String,
    pub domain: Option<String>,
    pub correlation_id: String,
}

pub(crate) fn authorize_organisation_create(
    principal: &NativePrincipal,
) -> Result<(), PlatformError> {
    if !principal.can("organisations.create") && !principal.can("organisations.manage") {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Native principal lacks organisations.create",
            "You are not authorized to create organisations",
            "organisation_create_permission_denied",
        ));
    }
    Ok(())
}