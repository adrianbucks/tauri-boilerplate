pub mod error;

pub use error::PlatformError;

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
