use std::fs;
use std::path::Path;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::{OsRng, RngCore};
use thiserror::Error;

use crate::DeviceIdentity;

#[derive(Debug, Error)]
pub enum DeviceKeyError {
    #[error("I/O error during key operations: {0}")]
    Io(#[from] std::io::Error),
    #[error("Cryptographic key error: {0}")]
    Crypto(String),
    #[error("Invalid public key format: {0}")]
    InvalidPublicKey(String),
    #[error("Invalid signature format: {0}")]
    InvalidSignature(String),
}

/// Native provider for device identity keypair.
///
/// Holds the private Ed25519 signing key securely in native memory.
/// Private key bytes are NEVER serialized or exposed over IPC or SQLite.
pub struct DeviceKeyProvider {
    identity: DeviceIdentity,
    signing_key: SigningKey,
}

impl DeviceKeyProvider {
    /// Generates an in-memory ephemeral device key provider (used for testing or transient sessions).
    pub fn generate_ephemeral(
        application_id: &str,
        platform_name: &str,
    ) -> Result<Self, DeviceKeyError> {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        Self::from_seed(&seed, application_id, platform_name)
    }

    /// Loads an existing private key from disk or creates and saves a new one.
    pub fn load_or_create(
        key_path: Option<&Path>,
        application_id: &str,
        platform_name: &str,
    ) -> Result<Self, DeviceKeyError> {
        let Some(path) = key_path else {
            return Self::generate_ephemeral(application_id, platform_name);
        };

        if path.exists() {
            let seed = fs::read(path)?;
            if seed.len() != 32 {
                return Err(DeviceKeyError::Crypto(format!(
                    "Invalid device key file length: expected 32 bytes, got {}",
                    seed.len()
                )));
            }
            let mut seed_arr = [0u8; 32];
            seed_arr.copy_from_slice(&seed);
            Self::from_seed(&seed_arr, application_id, platform_name)
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut seed = [0u8; 32];
            OsRng.fill_bytes(&mut seed);

            // Write seed with restricted access
            fs::write(path, &seed)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perms = std::fs::Permissions::from_mode(0o600);
                let _ = std::fs::set_permissions(path, perms);
            }

            Self::from_seed(&seed, application_id, platform_name)
        }
    }

    /// Creates provider from 32-byte private seed.
    pub fn from_seed(
        seed: &[u8; 32],
        application_id: &str,
        platform_name: &str,
    ) -> Result<Self, DeviceKeyError> {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        let pub_bytes = verifying_key.to_bytes();

        // Deterministic device ID derived from first 8 bytes of the public key
        let device_id = format!("dev_{}", hex::encode(&pub_bytes[0..8]));
        // Standard Ed25519 public key hex string
        let public_key = format!("ed25519_pk_{}", hex::encode(pub_bytes));

        let identity = DeviceIdentity {
            device_id,
            public_key,
            platform: platform_name.to_string(),
            application_id: application_id.to_string(),
        };

        Ok(Self {
            identity,
            signing_key,
        })
    }

    /// Access the public device identity metadata.
    pub fn identity(&self) -> &DeviceIdentity {
        &self.identity
    }

    /// Returns the unique device identifier string.
    pub fn device_id(&self) -> &str {
        &self.identity.device_id
    }

    /// Returns the Ed25519 public key string (`ed25519_pk_<hex>`).
    pub fn public_key(&self) -> &str {
        &self.identity.public_key
    }

    /// Signs an arbitrary message using the native Ed25519 private key.
    /// Returns 64-byte raw signature.
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let signature: Signature = self.signing_key.sign(message);
        signature.to_bytes().to_vec()
    }

    /// Signs an arbitrary message and returns hex-encoded 64-byte signature.
    pub fn sign_hex(&self, message: &[u8]) -> String {
        hex::encode(self.sign(message))
    }

    /// Verifies a signature against an Ed25519 public key.
    /// Accepts public key with or without `ed25519_pk_` prefix.
    pub fn verify(
        public_key_str: &str,
        message: &[u8],
        signature_bytes: &[u8],
    ) -> Result<bool, DeviceKeyError> {
        let clean_hex = public_key_str.strip_prefix("ed25519_pk_").unwrap_or(public_key_str);
        let pub_bytes = hex::decode(clean_hex).map_err(|e| {
            DeviceKeyError::InvalidPublicKey(format!("Failed to decode hex public key: {e}"))
        })?;

        if pub_bytes.len() != 32 {
            return Err(DeviceKeyError::InvalidPublicKey(format!(
                "Expected 32 bytes for Ed25519 public key, got {}",
                pub_bytes.len()
            )));
        }

        let mut key_arr = [0u8; 32];
        key_arr.copy_from_slice(&pub_bytes);

        let verifying_key = VerifyingKey::from_bytes(&key_arr).map_err(|e| {
            DeviceKeyError::InvalidPublicKey(format!("Invalid Ed25519 public key: {e}"))
        })?;

        if signature_bytes.len() != 64 {
            return Err(DeviceKeyError::InvalidSignature(format!(
                "Expected 64 bytes for Ed25519 signature, got {}",
                signature_bytes.len()
            )));
        }

        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(signature_bytes);
        let signature = Signature::from_bytes(&sig_arr);

        Ok(verifying_key.verify(message, &signature).is_ok())
    }

    /// Verifies a hex-encoded signature against an Ed25519 public key.
    pub fn verify_hex(
        public_key_str: &str,
        message: &[u8],
        signature_hex: &str,
    ) -> Result<bool, DeviceKeyError> {
        let sig_bytes = hex::decode(signature_hex).map_err(|e| {
            DeviceKeyError::InvalidSignature(format!("Failed to decode hex signature: {e}"))
        })?;
        Self::verify(public_key_str, message, &sig_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_genuine_ed25519_key_generation_and_signing() {
        let provider =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();

        assert!(provider.device_id().starts_with("dev_"));
        assert!(provider.public_key().starts_with("ed25519_pk_"));
        // 32 bytes = 64 hex chars + 11 chars prefix = 75 chars
        assert_eq!(provider.public_key().len(), 11 + 64);

        let message = b"canonical test operation payload for sync replication";
        let signature = provider.sign(message);
        assert_eq!(signature.len(), 64);

        // Positive verification
        let is_valid =
            DeviceKeyProvider::verify(provider.public_key(), message, &signature).unwrap();
        assert!(is_valid);

        // Tampered message must fail verification
        let is_valid_tampered =
            DeviceKeyProvider::verify(provider.public_key(), b"tampered message", &signature).unwrap();
        assert!(!is_valid_tampered);
    }

    #[test]
    fn test_signature_rejected_by_wrong_public_key() {
        let provider_a =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();
        let provider_b =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();

        let message = b"authenticate device handshake";
        let signature_a = provider_a.sign(message);

        // Verification with provider_b's public key must fail
        let is_valid =
            DeviceKeyProvider::verify(provider_b.public_key(), message, &signature_a).unwrap();
        assert!(!is_valid);
    }

    #[test]
    fn test_restart_persistence_with_protected_file() {
        let unique_id = hex::encode(&rand_core::OsRng.next_u64().to_le_bytes());
        let dir = std::env::temp_dir().join(format!("id_test_{unique_id}"));
        fs::create_dir_all(&dir).unwrap();
        let key_file = dir.join("device_identity.key");

        // 1. First run: generates key and writes file
        let provider_first =
            DeviceKeyProvider::load_or_create(Some(&key_file), "com.platform.test", "windows")
                .unwrap();
        let device_id_first = provider_first.device_id().to_string();
        let public_key_first = provider_first.public_key().to_string();

        assert!(key_file.exists());
        let file_bytes = fs::read(&key_file).unwrap();
        assert_eq!(file_bytes.len(), 32);

        // 2. Second run: reloads from file
        let provider_reloaded =
            DeviceKeyProvider::load_or_create(Some(&key_file), "com.platform.test", "windows")
                .unwrap();
        assert_eq!(provider_reloaded.device_id(), device_id_first);
        assert_eq!(provider_reloaded.public_key(), public_key_first);

        // 3. Signature created after reload verifies against initial public key
        let message = b"cross-restart verification check";
        let signature = provider_reloaded.sign(message);
        assert!(DeviceKeyProvider::verify(&public_key_first, message, &signature).unwrap());

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }
}
