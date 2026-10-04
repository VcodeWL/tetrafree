use tauri::Manager;

#[cfg(feature = "extras")]
mod extras;
#[cfg(feature = "updater")]
mod updates;
mod server;

/// Версия и платформа — фронтенд показывает их в настройках.
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

pub(crate) use server::ServerChild;

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
        updates::update_install,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(feature = "extras", not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        extras::sys_info,
        extras::sys_set_autostart,
        extras::sys_set_tray,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(not(feature = "extras"), feature = "updater"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        updates::update_check,
        updates::update_install,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(not(feature = "extras"), not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    builder
        .setup(|app| {
            #[cfg(feature = "extras")]
            extras::setup(app)?;
            // Бэкенд (проекты на диске, shell, git): встроенный node-сервер (см. server.rs).
            // Состояние регистрируем всегда — даже если запуск не удался, команды server_* работают.
            app.manage(server::ServerChild(std::sync::Mutex::new(None)));
            match server::spawn(app.handle()) {
                Ok(child) => {
                    *app.state::<server::ServerChild>().0.lock().unwrap() = Some(child);
                }
                Err(e) => server::note(&e),
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
