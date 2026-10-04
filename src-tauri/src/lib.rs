use tauri::Manager;

#[cfg(feature = "extras")]
mod extras;
#[cfg(feature = "updater")]
mod updates;

/// Версия и платформа — фронтенд показывает их в настройках.
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

pub(crate) struct ServerChild(std::sync::Mutex<Option<std::process::Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(feature = "extras")]
    let builder = extras::plugins(builder).on_window_event(extras::on_window_event);
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // Список команд зависит от включённых фич; invoke_handler вызывается один раз
    #[cfg(all(feature = "extras", feature = "updater"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        extras::sys_info,
        extras::sys_set_autostart,
        extras::sys_set_tray,
        updates::update_check,
        updates::update_install
    ]);
    #[cfg(all(feature = "extras", not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        extras::sys_info,
        extras::sys_set_autostart,
        extras::sys_set_tray
    ]);
    #[cfg(all(not(feature = "extras"), feature = "updater"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        updates::update_check,
        updates::update_install
    ]);
    #[cfg(all(not(feature = "extras"), not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![app_info]);
    builder
        .setup(|app| {
            #[cfg(feature = "extras")]
            extras::setup(app)?;
            // Бэкенд (проекты на диске, shell, git): встроенный node-сервер.
            // Node берём из sidecar рядом с приложением (его кладёт сборка), иначе — из PATH.
            // Если порт занят (например, `npm run server`) или Node нет — фронтенд работает в офлайн-режиме.
            if let Ok(dir) = app.path().resource_dir() {
                let script = dir.join("server").join("tetra-server.mjs");
                let script = if script.exists() { script } else { std::path::PathBuf::from("server/tetra-server.mjs") };
                if script.exists() {
                    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
                    let node = std::env::current_exe()
                        .ok()
                        .and_then(|e| e.parent().map(|d| d.join(node_name)))
                        .filter(|p| p.exists())
                        .unwrap_or_else(|| std::path::PathBuf::from("node"));
                    let mut cmd = std::process::Command::new(node);
                    cmd.arg(&script)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null());
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: без чёрного окна консоли
                    }
                    if let Ok(child) = cmd.spawn() {
                        app.manage(ServerChild(std::sync::Mutex::new(Some(child))));
                    }
                }
            }
            // Окно создаётся из tauri.conf.json; в debug открываем devtools
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("не удалось собрать TetraFree")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(st) = app.try_state::<ServerChild>() {
                    if let Some(mut c) = st.0.lock().unwrap().take() {
                        let _ = c.kill();
                    }
                }
            }
        });
}
