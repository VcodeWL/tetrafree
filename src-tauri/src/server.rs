//! Встроенный Node-сервер: запуск, лог, состояние, перезапуск.
//! Вывод сервера пишется в ~/TetraFree/server.log — по нему видно, почему сервер не поднялся.
use crate::lifecycle::LifecycleGate;
use crate::paths::clean;
use std::io::Write;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(windows)]
#[path = "job.rs"]
mod job;
use tauri::{AppHandle, Manager};

pub struct ServerChild(pub Mutex<Option<ManagedChild>>, pub LifecycleGate);

pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: job::Job,
}
impl ManagedChild {
    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }
    pub fn stop(mut self) -> Result<(), String> {
        if let Some(mut input) = self.child.stdin.take() {
            let _ = input.write_all(b"{\"type\":\"tetra-shutdown\"}\n");
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Err(e) => {
                    note(&format!("ожидание shutdown: {e}"));
                    break;
                }
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        // Even a gracefully exited root may have left descendants behind.
        #[cfg(windows)]
        let forced = self.job.terminate();
        #[cfg(not(windows))]
        let forced = self.child.kill().map_err(|e| e.to_string());
        if let Err(e) = forced {
            note(&format!("остановка дерева: {e}"));
        }
        self.child
            .wait()
            .map(|_| ())
            .map_err(|e| format!("shutdown wait: {e}"))
    }
}
impl Drop for ManagedChild {
    fn drop(&mut self) {
        #[cfg(windows)]
        let _ = self.job.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn data_dir() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(PathBuf::from(home).join("TetraFree"))
}

pub fn log_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("server.log"))
}

/// Запись от имени оболочки в тот же лог (ошибки запуска, которые сам Node написать не может)
pub fn note(msg: &str) {
    use std::io::Write;
    if let Some(p) = log_path() {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
        {
            let _ = writeln!(f, "[tauri] {}", msg);
        }
    }
}

/// Запускает `node server/tetra-server.mjs`: Node — sidecar рядом с приложением, иначе из PATH
pub fn spawn(app: &AppHandle) -> Result<ManagedChild, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("нет папки ресурсов: {e}"))?;
    let mut script = clean(dir.join("server").join("tetra-server.mjs"));
    if !script.exists() {
        script = PathBuf::from("server/tetra-server.mjs");
    }
    if !script.exists() {
        return Err(format!("не найден файл сервера: {}", script.display()));
    }
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let sidecar = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join(node_name)))
        .filter(|p| p.exists());
    let node = sidecar.unwrap_or_else(|| PathBuf::from("node"));

    // лог начинается с чистого листа; сервер дописывает в конец (append), чтобы записи оболочки не затирались
    if let Some(p) = log_path() {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::File::create(&p);
    }
    let log = log_path().and_then(|p| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .ok()
    });

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .env("TF_SERVE", "1")
        .env("TF_VERSION", env!("CARGO_PKG_VERSION"))
        .stdin(Stdio::piped());
    match log.and_then(|f| f.try_clone().ok().map(|g| (f, g))) {
        Some((o, e)) => {
            cmd.stdout(o).stderr(e);
        }
        None => {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0004); // CREATE_NO_WINDOW | CREATE_SUSPENDED: job до первого выполнения
    }
    #[allow(unused_mut)]
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("не удалось запустить {}: {e}", node.display()))?;
    #[cfg(windows)]
    let job = match job::Job::assign(&child).and_then(|job| {
        job::resume(&child)?;
        Ok(job)
    }) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("не удалось владеть деревом сервера: {e}"));
        }
    };
    note(&format!("запущен {} {}", node.display(), script.display()));
    Ok(ManagedChild {
        child,
        #[cfg(windows)]
        job,
    })
}

/// Последние ~6 КБ лога сервера
#[tauri::command]
pub fn server_log() -> String {
    let Some(p) = log_path() else {
        return String::new();
    };
    let Ok(mut f) = std::fs::File::open(p) else {
        return String::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if f.seek(SeekFrom::Start(len.saturating_sub(6000))).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).to_string()
}

/// Жив ли процесс сервера: { running, exit, log }
#[tauri::command]
pub fn server_status(app: AppHandle) -> serde_json::Value {
    let st = app.state::<ServerChild>();
    let mut g = st.0.lock().unwrap();
    let (running, exit) = match g.as_mut() {
        Some(c) => match c.try_wait() {
            Ok(None) => (true, None),
            Ok(Some(s)) => (false, s.code()),
            Err(_) => (false, None),
        },
        None => (false, None),
    };
    serde_json::json!({
        "running": running,
        "exit": exit,
        "log": log_path().map(|p| p.to_string_lossy().to_string()),
    })
}

/// Останавливает старый процесс (если есть) и запускает сервер заново
#[tauri::command]
pub fn server_restart(app: AppHandle) -> Result<(), String> {
    let st = app.state::<ServerChild>();
    let _lease = st.1.acquire()?;
    let mut g =
        st.0.lock()
            .map_err(|_| "Ошибка состояния сервера".to_string())?;
    if let Some(c) = g.take() {
        c.stop()?;
    }
    match spawn(&app) {
        Ok(c) => {
            *g = Some(c);
            Ok(())
        }
        Err(e) => {
            note(&e);
            Err(e)
        }
    }
}
