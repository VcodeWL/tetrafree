//! Bounded main-webview checkpoint handshake. No OS, GUI or persistence mocks.
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// A successful checkpoint grants one short-lived native exit event only.
#[derive(Default)]
pub struct ExitPermit(Mutex<Option<Instant>>);
impl ExitPermit {
    pub fn grant(&self, ttl: Duration) {
        *self.0.lock().unwrap() = Some(Instant::now() + ttl);
    }
    pub fn take(&self) -> bool {
        self.0
            .lock()
            .unwrap()
            .take()
            .is_some_and(|deadline| Instant::now() < deadline)
    }
}

struct Pending {
    token: String,
    deadline: Instant,
    saved: Option<bool>,
}
#[derive(Default)]
struct State {
    ready: bool,
    pending: Option<Pending>,
}
#[derive(Default)]
pub struct CheckpointGate {
    state: Mutex<State>,
    wake: Condvar,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Saved,
    Failed,
    TimedOut,
}
impl CheckpointGate {
    pub fn ready(&self, ready: bool) {
        self.state.lock().unwrap().ready = ready;
    }
    pub fn begin(&self, token: &str, timeout: Duration) -> Result<(), &'static str> {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Некорректный токен сохранения");
        }
        let mut state = self.state.lock().unwrap();
        if !state.ready {
            return Err("Окно ещё не готово подтвердить сохранение");
        }
        if state.pending.is_some() {
            return Err("Сохранение перед закрытием уже выполняется");
        }
        state.pending = Some(Pending {
            token: token.into(),
            deadline: Instant::now() + timeout,
            saved: None,
        });
        Ok(())
    }
    pub fn ack(&self, token: &str, saved: bool) -> bool {
        let mut state = self.state.lock().unwrap();
        let Some(p) = state.pending.as_mut() else {
            return false;
        };
        if p.token != token || p.saved.is_some() || Instant::now() >= p.deadline {
            return false;
        }
        p.saved = Some(saved);
        self.wake.notify_all();
        true
    }
    pub fn cancel(&self, token: &str) {
        let mut state = self.state.lock().unwrap();
        if state.pending.as_ref().is_some_and(|p| p.token == token) {
            state.pending = None;
            self.wake.notify_all();
        }
    }
    pub fn wait(&self, token: &str) -> Outcome {
        let mut state = self.state.lock().unwrap();
        loop {
            let Some(p) = state.pending.as_ref() else {
                return Outcome::Failed;
            };
            if p.token != token {
                return Outcome::Failed;
            }
            if let Some(saved) = p.saved {
                state.pending = None;
                return if saved {
                    Outcome::Saved
                } else {
                    Outcome::Failed
                };
            }
            let now = Instant::now();
            if now >= p.deadline {
                state.pending = None;
                return Outcome::TimedOut;
            }
            let remaining = p.deadline - now;
            state = self.wake.wait_timeout(state, remaining).unwrap().0;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    #[test]
    fn not_ready_and_busy_fail_closed() {
        let gate = CheckpointGate::default();
        assert!(gate.begin(TOKEN, Duration::from_secs(1)).is_err());
        gate.ready(true);
        gate.begin(TOKEN, Duration::from_secs(1)).unwrap();
        assert!(gate.begin(TOKEN, Duration::from_secs(1)).is_err());
        assert!(!gate.ack("wrong", true));
        assert!(gate.ack(TOKEN, false));
        assert_eq!(gate.wait(TOKEN), Outcome::Failed);
    }
    #[test]
    fn only_matching_single_ack_accepts() {
        let gate = CheckpointGate::default();
        gate.ready(true);
        gate.begin(TOKEN, Duration::from_secs(1)).unwrap();
        assert!(gate.ack(TOKEN, true));
        assert!(!gate.ack(TOKEN, false));
        assert_eq!(gate.wait(TOKEN), Outcome::Saved);
        assert!(!gate.ack(TOKEN, true));
    }
    #[test]
    fn deadline_rejects_late_ack_and_allows_retry() {
        let gate = CheckpointGate::default();
        gate.ready(true);
        gate.begin(TOKEN, Duration::ZERO).unwrap();
        assert!(!gate.ack(TOKEN, true));
        assert_eq!(gate.wait(TOKEN), Outcome::TimedOut);
        gate.begin(TOKEN, Duration::from_secs(1)).unwrap();
        gate.cancel(TOKEN);
        assert_eq!(gate.wait(TOKEN), Outcome::Failed);
    }
    #[test]
    fn waiter_unblocks_on_valid_ack() {
        let gate = std::sync::Arc::new(CheckpointGate::default());
        gate.ready(true);
        gate.begin(TOKEN, Duration::from_secs(1)).unwrap();
        let worker = gate.clone();
        let thread = std::thread::spawn(move || worker.wait(TOKEN));
        gate.ack(TOKEN, true);
        assert_eq!(thread.join().unwrap(), Outcome::Saved);
    }
    #[test]
    fn old_token_cannot_ack_new_request_and_cancel_is_scoped() {
        let gate = CheckpointGate::default();
        gate.ready(true);
        gate.begin(TOKEN, Duration::ZERO).unwrap();
        assert_eq!(gate.wait(TOKEN), Outcome::TimedOut);
        let next = "b".repeat(64);
        gate.begin(&next, Duration::from_secs(1)).unwrap();
        gate.cancel(TOKEN);
        assert!(!gate.ack(TOKEN, true));
        assert!(gate.ack(&next, true));
        assert_eq!(gate.wait(&next), Outcome::Saved);
    }
    #[test]
    fn missing_ack_really_waits_only_until_deadline() {
        let gate = CheckpointGate::default();
        gate.ready(true);
        gate.begin(TOKEN, Duration::from_millis(5)).unwrap();
        assert_eq!(gate.wait(TOKEN), Outcome::TimedOut);
        assert!(!gate.ack(TOKEN, true));
    }
    #[test]
    fn native_exit_permit_is_one_shot_and_expires() {
        let permit = ExitPermit::default();
        assert!(!permit.take());
        permit.grant(Duration::from_secs(1));
        assert!(permit.take());
        assert!(!permit.take());
        permit.grant(Duration::ZERO);
        assert!(!permit.take());
    }
}
