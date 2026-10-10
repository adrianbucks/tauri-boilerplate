pub mod provider;

pub use provider::{DeviceKeyError, DeviceKeyProvider, MAX_SIGNED_MESSAGE_BYTES};
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
    /// Generates an ephemeral Ed25519 device key provider.
    ///
    /// The returned provider keeps the private key in native custody and can
    /// sign messages for the lifetime of the provider. Use
    /// [`DeviceKeyProvider::load_or_create`] when the identity must survive
    /// application restarts.
    pub fn generate_ephemeral_device_key_provider(
        app_id: &str,
        platform_name: &str,
    ) -> Result<DeviceKeyProvider, DeviceKeyError> {
        DeviceKeyProvider::generate_ephemeral(app_id, platform_name)
    }

    /// Generates ephemeral identity metadata and immediately drops its signer.
    ///
    /// This method does not load or persist an identity despite its historical
    /// name. It remains for source compatibility; use
    /// [`Self::generate_ephemeral_device_key_provider`] for a usable transient
    /// identity or [`DeviceKeyProvider::load_or_create`] for a persistent one.
    #[deprecated(
        since = "0.1.0",
        note = "This creates an ephemeral identity and discards its signer; use generate_ephemeral_device_key_provider or DeviceKeyProvider::load_or_create"
    )]
    pub fn get_or_create_device_identity(
        app_id: &str,
        platform_name: &str,
    ) -> Result<DeviceIdentity, String> {
        let provider = Self::generate_ephemeral_device_key_provider(app_id, platform_name)
            .map_err(|e| format!("Failed to generate cryptographic device identity: {e}"))?;
        Ok(provider.identity().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_identity_generation() {
        let provider =
            KeyManager::generate_ephemeral_device_key_provider("demo-app", "windows").unwrap();
        let identity = provider.identity();
        assert!(identity.device_id.starts_with("dev_"));
        assert!(identity.public_key.starts_with("ed25519_pk_"));
        assert_eq!(identity.public_key.len(), 11 + 64);
        assert_eq!(identity.application_id, "demo-app");
    }
}
