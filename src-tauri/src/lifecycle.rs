use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct LifecycleGate(AtomicBool);
pub struct LifecycleLease<'a>(&'a AtomicBool);
impl LifecycleGate {
    pub fn acquire(&self) -> Result<LifecycleLease<'_>, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Сервер уже перезапускается или устанавливается обновление".to_string())?;
        Ok(LifecycleLease(&self.0))
    }
}
impl Drop for LifecycleLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_and_releases_on_error() {
        let gate = LifecycleGate::default();
        let lease = gate.acquire().unwrap();
        assert!(gate.acquire().is_err());
        drop(lease);
        let fail = || -> Result<(), String> {
            let _lease = gate.acquire()?;
            Err("download failed".into())
        };
        assert!(fail().is_err());
        assert!(gate.acquire().is_ok());
    }
    #[test]
    fn concurrent_request_is_rejected() {
        let gate = std::sync::Arc::new(LifecycleGate::default());
        let _lease = gate.acquire().unwrap();
        let other = gate.clone();
        assert!(std::thread::spawn(move || other.acquire().is_err())
            .join()
            .unwrap());
    }
}
