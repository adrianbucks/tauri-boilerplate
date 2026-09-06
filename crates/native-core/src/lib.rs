pub mod database;
pub mod error;
pub mod organisation;
pub mod schema;
pub mod session;
pub mod widget;

pub use database::{DatabaseHealth, DurableDatabase, NativeMigration, DbJsonOperation};
pub use error::PlatformError;
pub use schema::{core_migration, core_migrations};
pub use session::{
    create_organisation_for_session, create_widget_for_session, create_widgets_for_session,
    list_organisations_for_session, list_widgets_for_session, session_view, AuthenticateUserRequest,
    NativeSessionStore, NativeSessionView,
};
pub use widget::{
    NativePrincipal, NativeWidgetBulkCreateRequest, NativeWidgetCreateItem,
    NativeWidgetCreateRequest, NativeWidgetListRequest, NativeWidgetRecord,
};
pub use organisation::{NativeOrganisationCreateRequest, NativeOrganisationRecord};
pub use identity_core::{DeviceIdentity, DeviceKeyError, DeviceKeyProvider};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_error_serialization() {
        let err = PlatformError::new(
            "VALIDATION_ERROR",
            "SKU cannot be empty",
            "Please provide a valid SKU",
            "corr_test_123",
        )
        .with_details("Field 'sku' failed regex validation");

        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("VALIDATION_ERROR"));
        assert!(json.contains("corr_test_123"));
    }
}
