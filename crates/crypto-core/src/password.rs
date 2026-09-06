use argon2::password_hash::{PasswordHasher, PasswordVerifier as _};
use argon2::password_hash::phc::PasswordHash;
use argon2::{Algorithm, Argon2, Params, Version};
use thiserror::Error;

const MEMORY_COST_KIB: u32 = 19_456;
const TIME_COST: u32 = 2;
const PARALLELISM: u32 = 1;
const MAX_PASSWORD_BYTES: usize = 1_024;

#[derive(Debug, Error)]
pub enum PasswordHashError {
    #[error("password is empty")]
    EmptyPassword,
    #[error("password exceeds the maximum supported length")]
    PasswordTooLong,
    #[error("password hashing configuration is invalid")]
    InvalidParameters,
    #[error("password hashing failed")]
    HashingFailed,
    #[error("stored password verifier is malformed")]
    MalformedVerifier,
}

pub struct PasswordVerifier {
    argon2: Argon2<'static>,
}

impl PasswordVerifier {
    pub fn new() -> Result<Self, PasswordHashError> {
        let params = Params::new(
            MEMORY_COST_KIB,
            TIME_COST,
            PARALLELISM,
            None,
        )
        .map_err(|_| PasswordHashError::InvalidParameters)?;

        Ok(Self {
            argon2: Argon2::new(Algorithm::Argon2id, Version::V0x13, params),
        })
    }

    pub fn hash(&self, password: &str) -> Result<String, PasswordHashError> {
        validate_password(password)?;
        self.argon2
            .hash_password(password.as_bytes())
            .map(|hash| hash.to_string())
            .map_err(|_| PasswordHashError::HashingFailed)
    }

    pub fn verify(
        &self,
        password: &str,
        stored_verifier: &str,
    ) -> Result<bool, PasswordHashError> {
        validate_password(password)?;
        let parsed = PasswordHash::new(stored_verifier)
            .map_err(|_| PasswordHashError::MalformedVerifier)?;
        Ok(self
            .argon2
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }
}

fn validate_password(password: &str) -> Result<(), PasswordHashError> {
    if password.is_empty() {
        return Err(PasswordHashError::EmptyPassword);
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(PasswordHashError::PasswordTooLong);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_verifies_passwords_using_argon2id() {
        let verifier = PasswordVerifier::new().expect("parameters should be valid");
        let hash = verifier.hash("correct horse battery staple").unwrap();

        assert!(hash.starts_with("$argon2id$"));
        assert!(verifier
            .verify("correct horse battery staple", &hash)
            .unwrap());
        assert!(!verifier.verify("wrong password", &hash).unwrap());
    }

    #[test]
    fn generates_unique_salts_for_equal_passwords() {
        let verifier = PasswordVerifier::new().expect("parameters should be valid");

        let first = verifier.hash("same password").unwrap();
        let second = verifier.hash("same password").unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn rejects_empty_long_and_malformed_credentials() {
        let verifier = PasswordVerifier::new().expect("parameters should be valid");

        assert!(matches!(
            verifier.hash(""),
            Err(PasswordHashError::EmptyPassword)
        ));
        assert!(matches!(
            verifier.hash(&"x".repeat(MAX_PASSWORD_BYTES + 1)),
            Err(PasswordHashError::PasswordTooLong)
        ));
        assert!(matches!(
            verifier.verify("password", "not-a-phc-record"),
            Err(PasswordHashError::MalformedVerifier)
        ));
    }
}