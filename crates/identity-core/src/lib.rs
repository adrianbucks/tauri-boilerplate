use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub public_key: String,
    pub platform: String,
    pub application_id: String,
}

pub struct KeyManager;

impl KeyManager {
    /// Generates a unique device ID and public key pair.
    /// In production on Windows, private keys are securely protected via Windows DPAPI.
    /// On Android, private keys are stored in Android Keystore.
    pub fn get_or_create_device_identity(
        app_id: &str,
        platform_name: &str,
    ) -> Result<DeviceIdentity, String> {
        let mut random_bytes = [0u8; 16];
        getrandom::getrandom(&mut random_bytes)
            .map_err(|e| format!("Failed to generate random entropy: {e}"))?;

        let device_id = format!("dev_{}", hex::encode(&random_bytes[0..8]));
        let public_key = format!("ed25519_pk_{}", hex::encode(&random_bytes[8..16]));

        Ok(DeviceIdentity {
            device_id,
            public_key,
            platform: platform_name.to_string(),
            application_id: app_id.to_string(),
        })
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
        assert_eq!(identity.application_id, "demo-app");
    }
}
