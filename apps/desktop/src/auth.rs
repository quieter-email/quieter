use keyring::Entry;
use std::time::{Duration, Instant};

const CREDENTIAL_SERVICE: &str = "email.quieter.desktop";
const MAX_AUTHORIZATION_DURATION: Duration = Duration::from_secs(5 * 60);

pub struct DeviceAuthorization {
    deadline: Instant,
    interval: Duration,
}

impl DeviceAuthorization {
    pub fn new(started_at: Instant, expires_in: u64, interval: u64) -> Self {
        Self {
            deadline: started_at + Duration::from_secs(expires_in).min(MAX_AUTHORIZATION_DURATION),
            interval: Duration::from_secs(interval.max(1)),
        }
    }

    pub fn deadline(&self) -> Instant {
        self.deadline
    }

    pub fn remaining(&self) -> Option<Duration> {
        self.remaining_at(Instant::now())
    }

    pub fn next_wait(&self) -> Option<Duration> {
        self.next_wait_at(Instant::now())
    }

    pub fn slow_down(&mut self) {
        self.interval = self.interval.saturating_add(Duration::from_secs(5));
    }

    pub fn transient_failure(&mut self) {
        self.interval = self
            .interval
            .saturating_mul(2)
            .min(Duration::from_secs(30))
            .max(self.interval);
    }

    fn remaining_at(&self, now: Instant) -> Option<Duration> {
        self.deadline
            .checked_duration_since(now)
            .filter(|time| !time.is_zero())
    }

    fn next_wait_at(&self, now: Instant) -> Option<Duration> {
        self.remaining_at(now)
            .map(|remaining| self.interval.min(remaining))
    }
}

pub struct TokenStore;

impl TokenStore {
    pub fn load(base_url: &str) -> Option<String> {
        Entry::new(CREDENTIAL_SERVICE, base_url)
            .ok()
            .and_then(|credential| credential.get_secret().ok())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|token| !token.is_empty())
    }

    pub fn save(base_url: &str, token: &str) -> anyhow::Result<()> {
        Entry::new(CREDENTIAL_SERVICE, base_url)?.set_secret(token.as_bytes())?;
        Ok(())
    }

    pub fn clear(base_url: &str) -> anyhow::Result<()> {
        let credential = Entry::new(CREDENTIAL_SERVICE, base_url)?;
        if let Err(error) = credential.delete_credential()
            && !matches!(error, keyring::Error::NoEntry)
        {
            return Err(error.into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_deadline_cannot_outlive_the_initial_attempt() {
        let started_at = Instant::now();
        let authorization = DeviceAuthorization::new(started_at, 60 * 60, 5);

        assert!(authorization.remaining_at(started_at).is_some());
        assert!(
            authorization
                .remaining_at(started_at + Duration::from_secs(299))
                .is_some()
        );
        assert!(
            authorization
                .remaining_at(started_at + Duration::from_secs(300))
                .is_none()
        );
        assert!(
            authorization
                .remaining_at(started_at + Duration::from_secs(301))
                .is_none()
        );
    }

    #[test]
    fn polling_wait_stays_within_remaining_lifetime_and_does_not_speed_up() {
        let started_at = Instant::now();
        let mut authorization = DeviceAuthorization::new(started_at, 120, 20);

        authorization.slow_down();
        authorization.transient_failure();
        assert!(authorization.interval >= Duration::from_secs(25));
        assert!(authorization.interval <= Duration::from_secs(30));
        assert_eq!(
            authorization.next_wait_at(started_at + Duration::from_secs(119)),
            Some(Duration::from_secs(1))
        );
        assert_eq!(
            authorization.next_wait_at(started_at + Duration::from_secs(120)),
            None
        );
    }
}
