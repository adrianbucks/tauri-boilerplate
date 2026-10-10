use std::cmp::Ordering;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlcTimestamp {
    pub physical_time: u64,
    pub counter: u32,
    pub node_id: String,
}

pub struct HybridLogicalClock {
    node_id: String,
    state: Mutex<ClockState>,
}

struct ClockState {
    physical_time: u64,
    counter: u32,
}

impl HybridLogicalClock {
    pub fn new(node_id: impl Into<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            node_id: node_id.into(),
            state: Mutex::new(ClockState {
                physical_time: now,
                counter: 0,
            }),
        }
    }

    pub fn now(&self) -> String {
        let physical = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (p, c) = if physical > state.physical_time {
            (physical, 0)
        } else {
            increment(state.physical_time, state.counter)
        };
        state.physical_time = p;
        state.counter = c;

        format!("{:012x}_{:04x}_{}", p, c, self.node_id)
    }

    pub fn update(&self, remote_hlc: &str) -> String {
        let remote = Self::parse(remote_hlc).unwrap_or(HlcTimestamp {
            physical_time: 0,
            counter: 0,
            node_id: "unknown".into(),
        });

        let physical = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (p, c) = if physical > state.physical_time && physical > remote.physical_time {
            (physical, 0)
        } else if state.physical_time == remote.physical_time {
            increment(
                state.physical_time,
                std::cmp::max(state.counter, remote.counter),
            )
        } else if state.physical_time > remote.physical_time {
            increment(state.physical_time, state.counter)
        } else {
            increment(remote.physical_time, remote.counter)
        };
        state.physical_time = p;
        state.counter = c;

        format!("{:012x}_{:04x}_{}", p, c, self.node_id)
    }

    pub fn parse(timestamp_str: &str) -> Option<HlcTimestamp> {
        let parts: Vec<&str> = timestamp_str.split('_').collect();
        if parts.len() < 3 {
            return None;
        }

        let physical_time = u64::from_str_radix(parts[0], 16).ok()?;
        let counter = u32::from_str_radix(parts[1], 16).ok()?;
        let node_id = parts[2..].join("_");

        Some(HlcTimestamp {
            physical_time,
            counter,
            node_id,
        })
    }

    pub fn compare(a: &str, b: &str) -> Ordering {
        let parsed_a = Self::parse(a).unwrap_or(HlcTimestamp {
            physical_time: 0,
            counter: 0,
            node_id: String::new(),
        });
        let parsed_b = Self::parse(b).unwrap_or(HlcTimestamp {
            physical_time: 0,
            counter: 0,
            node_id: String::new(),
        });

        match parsed_a.physical_time.cmp(&parsed_b.physical_time) {
            Ordering::Equal => match parsed_a.counter.cmp(&parsed_b.counter) {
                Ordering::Equal => parsed_a.node_id.cmp(&parsed_b.node_id),
                other => other,
            },
            other => other,
        }
    }
}

fn increment(physical_time: u64, counter: u32) -> (u64, u32) {
    match counter.checked_add(1) {
        Some(next_counter) => (physical_time, next_counter),
        None => (physical_time.saturating_add(1), 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    #[test]
    fn concurrent_now_calls_never_emit_duplicate_timestamps() {
        let clock = Arc::new(HybridLogicalClock::new("parallel-node"));
        let timestamps = Arc::new(Mutex::new(Vec::new()));

        std::thread::scope(|scope| {
            for _ in 0..8 {
                let clock = Arc::clone(&clock);
                let timestamps = Arc::clone(&timestamps);
                scope.spawn(move || {
                    for _ in 0..500 {
                        timestamps
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .push(clock.now());
                    }
                });
            }
        });

        let timestamps = timestamps
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let unique: HashSet<_> = timestamps.iter().collect();
        assert_eq!(unique.len(), timestamps.len());
    }

    #[test]
    fn counter_overflow_advances_physical_time() {
        assert_eq!(increment(42, u32::MAX), (43, 0));
    }
}
