use serde::{Deserialize, Serialize};

use crate::PlatformError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativePrincipal {
    pub(crate) user_id: String,
    pub(crate) device_id: String,
    pub(crate) organisation_id: String,
    pub(crate) permissions: Vec<String>,
}

impl NativePrincipal {
    pub fn from_authenticated_session(
        user_id: impl Into<String>,
        organisation_id: impl Into<String>,
        permissions: Vec<String>,
    ) -> Self {
        Self {
            user_id: user_id.into(),
            device_id: "test-device".to_string(),
            organisation_id: organisation_id.into(),
            permissions,
        }
    }

    pub(crate) fn from_authenticated_device_session(
        user_id: impl Into<String>,
        device_id: impl Into<String>,
        organisation_id: impl Into<String>,
        permissions: Vec<String>,
    ) -> Self {
        Self {
            user_id: user_id.into(),
            device_id: device_id.into(),
            organisation_id: organisation_id.into(),
            permissions,
        }
    }

    pub(crate) fn can(&self, permission: &str) -> bool {
        self.permissions.iter().any(|value| value == permission || value == "*")
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NativeWidgetRecord {
    pub id: String,
    pub organisation_id: String,
    pub name: String,
    pub sku: String,
    pub quantity: i64,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NativeWidgetListRequest {
    pub organisation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct NativeWidgetCreateRequest {
    pub organisation_id: String,
    pub sync_group_id: String,
    pub name: String,
    pub sku: String,
    pub quantity: i64,
    pub description: Option<String>,
    pub correlation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct NativeWidgetBulkCreateRequest {
    pub organisation_id: String,
    pub sync_group_id: String,
    pub widgets: Vec<NativeWidgetCreateItem>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NativeWidgetCreateItem {
    pub name: String,
    pub sku: String,
    pub quantity: i64,
    pub description: Option<String>,
}

pub(crate) fn authorize_widget_create(
    principal: &NativePrincipal,
    organisation_id: &str,
) -> Result<(), PlatformError> {
    if !principal.can("widgets.create") {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Native principal lacks widgets.create",
            "You are not authorized to create widgets",
            "widget_create_permission_denied",
        ));
    }
    if principal.organisation_id != organisation_id {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Widget organisation scope does not match native principal",
            "You are not authorized to modify this organisation",
            "widget_create_scope_denied",
        ));
    }
    Ok(())
}

pub(crate) fn authorize_widget_read(
    principal: &NativePrincipal,
    organisation_id: &str,
) -> Result<(), PlatformError> {
    if !principal.can("widgets.read") {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Native principal lacks widgets.read",
            "You are not authorized to view widgets",
            "widget_read_permission_denied",
        ));
    }
    if principal.organisation_id != organisation_id {
        return Err(PlatformError::new(
            "AUTHORIZATION_ERROR",
            "Widget organisation scope does not match native principal",
            "You are not authorized to view this organisation",
            "widget_read_scope_denied",
        ));
    }
    Ok(())
}