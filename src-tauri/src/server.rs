//! Встроенный Node-сервер: запуск, лог, состояние, перезапуск.
//! Вывод сервера пишется в ~/TetraFree/server.log — по нему видно, почему сервер не поднялся.
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct ServerChild(pub Mutex<Option<Child>>);

fn data_dir() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()?;
    Some(PathBuf::from(home).join("TetraFree"))
}

pub fn log_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("server.log"))
}

/// Windows отдаёт resource_dir с префиксом \\?\ — Node с ним ведёт себя непредсказуемо, убираем
fn clean(p: PathBuf) -> PathBuf {
    let t = p.to_string_lossy().to_string();
    PathBuf::from(t.strip_prefix(r"\\?\").unwrap_or(&t).to_string())
}

/// Запись от имени оболочки в тот же лог (ошибки запуска, которые сам Node написать не может)
pub fn note(msg: &str) {
    use std::io::Write;
    if let Some(p) = log_path() {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "[tauri] {}", msg);
        }
    }
}

/// Запускает `node server/tetra-server.mjs`: Node — sidecar рядом с приложением, иначе из PATH
pub fn spawn(app: &AppHandle) -> Result<Child, String> {
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
    let log = log_path().and_then(|p| std::fs::OpenOptions::new().create(true).append(true).open(p).ok());

    let mut cmd = Command::new(&node);
    cmd.arg(&script).env("TF_SERVE", "1").stdin(Stdio::null());
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
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: без чёрного окна консоли
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("не удалось запустить {}: {e}", node.display()))?;
    note(&format!("запущен {} {}", node.display(), script.display()));
    Ok(child)
}

/// Последние ~6 КБ лога сервера
#[tauri::command]
pub fn server_log() -> String {
    let Some(p) = log_path() else { return String::new() };
    let Ok(mut f) = std::fs::File::open(p) else { return String::new() };
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
    let mut g = st.0.lock().unwrap();
    if let Some(mut c) = g.take() {
        let _ = c.kill();
        let _ = c.wait();
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
