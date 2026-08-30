use std::cmp::Ordering;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering as AtomicOrdering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlcTimestamp {
    pub physical_time: u64,
    pub counter: u32,
    pub node_id: String,
}

pub struct HybridLogicalClock {
    node_id: String,
    latest_time: AtomicU64,
    counter: AtomicU32,
}

impl HybridLogicalClock {
    pub fn new(node_id: impl Into<String>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            node_id: node_id.into(),
            latest_time: AtomicU64::new(now),
            counter: AtomicU32::new(0),
        }
    }

    pub fn now(&self) -> String {
        let physical = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let latest = self.latest_time.load(AtomicOrdering::SeqCst);
        let (p, c) = if physical > latest {
            self.latest_time.store(physical, AtomicOrdering::SeqCst);
            self.counter.store(0, AtomicOrdering::SeqCst);
            (physical, 0)
        } else {
            let c = self.counter.fetch_add(1, AtomicOrdering::SeqCst) + 1;
            (latest, c)
        };

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

        let latest = self.latest_time.load(AtomicOrdering::SeqCst);

        let (p, c) = if physical > latest && physical > remote.physical_time {
            self.latest_time.store(physical, AtomicOrdering::SeqCst);
            self.counter.store(0, AtomicOrdering::SeqCst);
            (physical, 0)
        } else if latest == remote.physical_time {
            let new_c = std::cmp::max(self.counter.load(AtomicOrdering::SeqCst), remote.counter) + 1;
            self.counter.store(new_c, AtomicOrdering::SeqCst);
            (latest, new_c)
        } else if remote.physical_time > latest {
            self.latest_time.store(remote.physical_time, AtomicOrdering::SeqCst);
            let new_c = remote.counter + 1;
            self.counter.store(new_c, AtomicOrdering::SeqCst);
            (remote.physical_time, new_c)
        } else {
            let new_c = self.counter.fetch_add(1, AtomicOrdering::SeqCst) + 1;
            (latest, new_c)
        };

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
