pub mod provider;

pub use provider::{DeviceKeyError, DeviceKeyProvider};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub public_key: String,
    pub platform: String,
    pub application_id: String,
}

pub struct KeyManager;

impl KeyManager {
    /// Generates a genuine Ed25519 device ID and public key pair.
    /// In production, private keys are held exclusively in native custody via `DeviceKeyProvider`.
    pub fn get_or_create_device_identity(
        app_id: &str,
        platform_name: &str,
    ) -> Result<DeviceIdentity, String> {
        let provider = DeviceKeyProvider::generate_ephemeral(app_id, platform_name)
            .map_err(|e| format!("Failed to generate cryptographic device identity: {e}"))?;
        Ok(provider.identity().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_identity_generation() {
        let identity =
            KeyManager::get_or_create_device_identity("demo-app", "windows").unwrap();
        assert!(identity.device_id.starts_with("dev_"));
        assert!(identity.public_key.starts_with("ed25519_pk_"));
        assert_eq!(identity.public_key.len(), 11 + 64);
        assert_eq!(identity.application_id, "demo-app");
    }
}
