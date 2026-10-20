use tauri::Manager;

mod checkpoint;
mod desktop_checkpoint;
#[cfg(feature = "extras")]
mod extras;
mod lifecycle;
#[cfg(feature = "extras")]
mod notification_policy;
mod paths;
mod server;
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

pub(crate) use server::ServerChild;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(desktop_checkpoint::on_window_event);
    #[cfg(feature = "extras")]
    let builder = extras::plugins(builder);
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // Список команд зависит от включённых фич; invoke_handler вызывается один раз
    #[cfg(all(feature = "extras", feature = "updater"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        desktop_checkpoint::desktop_checkpoint_ready,
        desktop_checkpoint::desktop_checkpoint_ack,
        desktop_checkpoint::desktop_quit,
        desktop_checkpoint::desktop_features,
        extras::sys_info,
        extras::sys_set_autostart,
        extras::sys_set_tray,
        extras::sys_set_notifications,
        extras::desktop_notify,
        updates::update_check,
        updates::update_install,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(feature = "extras", not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        desktop_checkpoint::desktop_checkpoint_ready,
        desktop_checkpoint::desktop_checkpoint_ack,
        desktop_checkpoint::desktop_quit,
        desktop_checkpoint::desktop_features,
        extras::sys_info,
        extras::sys_set_autostart,
        extras::sys_set_tray,
        extras::sys_set_notifications,
        extras::desktop_notify,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(not(feature = "extras"), feature = "updater"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        desktop_checkpoint::desktop_checkpoint_ready,
        desktop_checkpoint::desktop_checkpoint_ack,
        desktop_checkpoint::desktop_quit,
        desktop_checkpoint::desktop_features,
        updates::update_check,
        updates::update_install,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    #[cfg(all(not(feature = "extras"), not(feature = "updater")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        app_info,
        desktop_checkpoint::desktop_checkpoint_ready,
        desktop_checkpoint::desktop_checkpoint_ack,
        desktop_checkpoint::desktop_quit,
        desktop_checkpoint::desktop_features,
        server::server_log,
        server::server_status,
        server::server_restart
    ]);
    builder
        .setup(|app| {
            app.manage(desktop_checkpoint::DesktopCheckpoint::default());
            // Бэкенд (проекты на диске, shell, git): встроенный node-сервер (см. server.rs).
            // Состояние регистрируем всегда — даже если запуск не удался, команды server_* работают.
            app.manage(server::ServerChild(
                std::sync::Mutex::new(None),
                lifecycle::LifecycleGate::default(),
            ));
            #[cfg(feature = "extras")]
            extras::setup(app)?;
            match server::spawn(app.handle()) {
                Ok(child) => {
                    *app.state::<server::ServerChild>().0.lock().unwrap() = Some(child);
                }
                Err(e) => server::note(&e),
            }
            // Окно создаётся из tauri.conf.json; в debug открываем devtools
            #[cfg(debug_assertions)]
            {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("не удалось собрать TetraFree")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !desktop_checkpoint::take_exit_permit(app) {
                    api.prevent_exit();
                    desktop_checkpoint::request_close(app.clone(), false);
                }
            }
            if let tauri::RunEvent::Exit = event {
                if let Some(st) = app.try_state::<ServerChild>() {
                    if let Some(c) = st.0.lock().unwrap().take() {
                        if let Err(e) = c.stop() {
                            server::note(&e);
                        }
                    }
                }
            }
        });
}
