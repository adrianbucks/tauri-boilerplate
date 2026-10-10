use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::{OsRng, RngCore};
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;
use thiserror::Error;
use zeroize::Zeroizing;

use crate::DeviceIdentity;

/// Maximum message size accepted by native signing and verification.
pub const MAX_SIGNED_MESSAGE_BYTES: usize = 10 * 1024 * 1024;

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
    /// Rejects oversized hex IPC inputs before an adapter decodes them.
    pub fn validate_message_hex_length(encoded_length: usize) -> Result<(), DeviceKeyError> {
        if encoded_length > MAX_SIGNED_MESSAGE_BYTES.saturating_mul(2) {
            return Err(DeviceKeyError::Crypto(
                "Signed message exceeds the maximum supported size".to_string(),
            ));
        }
        Ok(())
    }
    /// Generates an in-memory ephemeral device key provider (used for testing or transient sessions).
    pub fn generate_ephemeral(
        application_id: &str,
        platform_name: &str,
    ) -> Result<Self, DeviceKeyError> {
        let mut seed = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *seed);
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

        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }

        if let Some(seed) = read_existing_seed(path)? {
            return Self::from_seed(&seed, application_id, platform_name);
        }

        let mut seed = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *seed);

        if write_seed_exclusive(path, &seed)? {
            Self::from_seed(&seed, application_id, platform_name)
        } else {
            // Another process created the identity first. Load that stable key
            // instead of replacing it or returning a key that was not persisted.
            let persisted_seed = read_existing_seed(path)?.ok_or_else(|| {
                DeviceKeyError::Crypto("Device key disappeared during creation".to_string())
            })?;
            Self::from_seed(&persisted_seed, application_id, platform_name)
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

    /// Signs a bounded message using the native Ed25519 private key.
    /// Returns a 64-byte raw signature.
    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, DeviceKeyError> {
        if message.len() > MAX_SIGNED_MESSAGE_BYTES {
            return Err(DeviceKeyError::Crypto(
                "Signed message exceeds the maximum supported size".to_string(),
            ));
        }
        let signature: Signature = self.signing_key.sign(message);
        Ok(signature.to_bytes().to_vec())
    }

    /// Signs a bounded message and returns its hex-encoded 64-byte signature.
    pub fn sign_hex(&self, message: &[u8]) -> Result<String, DeviceKeyError> {
        self.sign(message).map(hex::encode)
    }

    /// Verifies a signature against an Ed25519 public key.
    /// Accepts public key with or without `ed25519_pk_` prefix.
    pub fn verify(
        public_key_str: &str,
        message: &[u8],
        signature_bytes: &[u8],
    ) -> Result<bool, DeviceKeyError> {
        if message.len() > MAX_SIGNED_MESSAGE_BYTES {
            return Err(DeviceKeyError::Crypto(
                "Signed message exceeds the maximum supported size".to_string(),
            ));
        }
        let clean_hex = public_key_str
            .strip_prefix("ed25519_pk_")
            .unwrap_or(public_key_str);
        if clean_hex.len() != 64 {
            return Err(DeviceKeyError::InvalidPublicKey(format!(
                "Expected 64 hex characters for Ed25519 public key, got {}",
                clean_hex.len()
            )));
        }
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
        Self::validate_message_hex_length(message.len().saturating_mul(2))?;
        let clean_hex = public_key_str
            .strip_prefix("ed25519_pk_")
            .unwrap_or(public_key_str);
        if clean_hex.len() != 64 {
            return Err(DeviceKeyError::InvalidPublicKey(format!(
                "Expected 64 hex characters for Ed25519 public key, got {}",
                clean_hex.len()
            )));
        }
        if signature_hex.len() != 128 {
            return Err(DeviceKeyError::InvalidSignature(format!(
                "Expected 128 hex characters for Ed25519 signature, got {}",
                signature_hex.len()
            )));
        }
        let sig_bytes = hex::decode(signature_hex).map_err(|e| {
            DeviceKeyError::InvalidSignature(format!("Failed to decode hex signature: {e}"))
        })?;
        Self::verify(public_key_str, message, &sig_bytes)
    }
}

fn read_existing_seed(path: &Path) -> Result<Option<Zeroizing<[u8; 32]>>, DeviceKeyError> {
    let mut incomplete_reads = 0;
    let path_metadata = loop {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(DeviceKeyError::Crypto(
                        "Device key path must be a regular file, not a symlink or special file"
                            .to_string(),
                    ));
                }
                if metadata.len() == 32 {
                    break metadata;
                }
                if metadata.len() > 32 {
                    return Err(invalid_seed_length(metadata.len()));
                }
                incomplete_reads += 1;
                if incomplete_reads >= 50 {
                    return Err(invalid_seed_length(metadata.len()));
                }
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
    };

    let key_file = File::open(path)?;
    let opened_metadata = key_file.metadata()?;
    if !opened_metadata.is_file() || opened_metadata.len() != path_metadata.len() {
        return Err(DeviceKeyError::Crypto(
            "Device key path must be a regular file, not a symlink or special file".to_string(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened_metadata.dev() != path_metadata.dev()
            || opened_metadata.ino() != path_metadata.ino()
        {
            return Err(DeviceKeyError::Crypto(
                "Device key path changed while it was being opened".to_string(),
            ));
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        key_file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }

    let mut bytes = Zeroizing::new(Vec::with_capacity(33));
    key_file.take(33).read_to_end(&mut bytes)?;
    if bytes.len() != 32 {
        return Err(invalid_seed_length(bytes.len() as u64));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes);

    Ok(Some(Zeroizing::new(seed)))
}

fn invalid_seed_length(length: u64) -> DeviceKeyError {
    DeviceKeyError::Crypto(format!(
        "Invalid device key file length: expected 32 bytes, got {length}"
    ))
}

fn write_seed_exclusive(path: &Path, seed: &[u8; 32]) -> Result<bool, DeviceKeyError> {
    #[cfg(unix)]
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    #[cfg(unix)]
    let file_name = path.file_name().ok_or_else(|| {
        DeviceKeyError::Crypto("Device key path must include a file name".to_string())
    })?;

    #[cfg(unix)]
    for _ in 0..10 {
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let mut temp_name = file_name.to_os_string();
        temp_name.push(format!(".{}.tmp", hex::encode(nonce)));
        let temp_path: PathBuf =
            parent.map_or_else(|| PathBuf::from(&temp_name), |dir| dir.join(&temp_name));

        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }

        let mut temp_file = match options.open(&temp_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };

        let write_result = temp_file
            .write_all(seed)
            .and_then(|()| temp_file.sync_all());
        drop(temp_file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(error.into());
        }

        let link_result = fs::hard_link(&temp_path, path);
        let _ = fs::remove_file(&temp_path);
        match link_result {
            Ok(()) => return Ok(true),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => return Ok(false),
            Err(error) => return Err(error.into()),
        }
    }

    #[cfg(unix)]
    {
        return Err(DeviceKeyError::Crypto(
            "Could not allocate a unique temporary device key file".to_string(),
        ));
    }

    #[cfg(not(unix))]
    {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = match options.open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if let Err(error) = file.write_all(seed).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(error.into());
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_hex_length_is_bounded_before_decoding() {
        assert!(
            DeviceKeyProvider::validate_message_hex_length(MAX_SIGNED_MESSAGE_BYTES * 2).is_ok()
        );
        assert!(
            DeviceKeyProvider::validate_message_hex_length(MAX_SIGNED_MESSAGE_BYTES * 2 + 1)
                .is_err()
        );
    }

    #[test]
    fn signing_rejects_messages_above_the_provider_limit() {
        let provider =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();
        let message = vec![0; MAX_SIGNED_MESSAGE_BYTES + 1];

        assert!(provider.sign(&message).is_err());
        assert!(provider.sign_hex(&message).is_err());
    }

    #[test]
    fn test_genuine_ed25519_key_generation_and_signing() {
        let provider =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();

        assert!(provider.device_id().starts_with("dev_"));
        assert!(provider.public_key().starts_with("ed25519_pk_"));
        // 32 bytes = 64 hex chars + 11 chars prefix = 75 chars
        assert_eq!(provider.public_key().len(), 11 + 64);

        let message = b"canonical test operation payload for sync replication";
        let signature = provider.sign(message).unwrap();
        assert_eq!(signature.len(), 64);

        // Positive verification
        let is_valid =
            DeviceKeyProvider::verify(provider.public_key(), message, &signature).unwrap();
        assert!(is_valid);

        // Tampered message must fail verification
        let is_valid_tampered =
            DeviceKeyProvider::verify(provider.public_key(), b"tampered message", &signature)
                .unwrap();
        assert!(!is_valid_tampered);
    }

    #[test]
    fn test_signature_rejected_by_wrong_public_key() {
        let provider_a =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();
        let provider_b =
            DeviceKeyProvider::generate_ephemeral("com.platform.test", "windows").unwrap();

        let message = b"authenticate device handshake";
        let signature_a = provider_a.sign(message).unwrap();

        // Verification with provider_b's public key must fail
        let is_valid =
            DeviceKeyProvider::verify(provider_b.public_key(), message, &signature_a).unwrap();
        assert!(!is_valid);
    }

    #[test]
    fn test_restart_persistence_with_protected_file() {
        let unique_id = hex::encode(rand_core::OsRng.next_u64().to_le_bytes());
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
        let signature = provider_reloaded.sign(message).unwrap();
        assert!(DeviceKeyProvider::verify(&public_key_first, message, &signature).unwrap());

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_creators_use_the_same_persisted_identity() {
        let unique_id = hex::encode(rand_core::OsRng.next_u64().to_le_bytes());
        let dir = std::env::temp_dir().join(format!("id_race_{unique_id}"));
        let key_file = dir.join("device_identity.key");
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let key_file = key_file.clone();
                std::thread::spawn(move || {
                    DeviceKeyProvider::load_or_create(
                        Some(&key_file),
                        "com.platform.test",
                        "windows",
                    )
                    .unwrap()
                    .public_key()
                    .to_string()
                })
            })
            .collect();

        let public_keys: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert!(public_keys.iter().all(|key| key == &public_keys[0]));
        assert_eq!(fs::read(&key_file).unwrap().len(), 32);

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn existing_key_permissions_are_restricted_on_load() {
        use std::os::unix::fs::PermissionsExt;

        let unique_id = hex::encode(rand_core::OsRng.next_u64().to_le_bytes());
        let dir = std::env::temp_dir().join(format!("id_mode_{unique_id}"));
        fs::create_dir_all(&dir).unwrap();
        let key_file = dir.join("device_identity.key");
        DeviceKeyProvider::load_or_create(Some(&key_file), "com.platform.test", "linux").unwrap();
        fs::set_permissions(&key_file, fs::Permissions::from_mode(0o644)).unwrap();

        DeviceKeyProvider::load_or_create(Some(&key_file), "com.platform.test", "linux").unwrap();

        assert_eq!(
            fs::metadata(&key_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
