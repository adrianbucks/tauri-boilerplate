pub mod password;
pub mod hlc;

pub use hlc::{HlcTimestamp, HybridLogicalClock};
pub use password::{PasswordHashError, PasswordVerifier};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hlc_monotonic() {
        let clock = HybridLogicalClock::new("node_rust_1");
        let t1 = clock.now();
        let t2 = clock.now();

        assert_eq!(
            HybridLogicalClock::compare(&t1, &t2),
            std::cmp::Ordering::Less
        );
        assert!(t1.contains("node_rust_1"));
    }
}
