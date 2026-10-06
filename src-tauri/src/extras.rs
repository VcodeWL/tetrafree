//! Системные функции десктопа (cargo-фича `extras`): автозапуск, значок в трее, глобальная горячая клавиша.
//! Выключены по умолчанию: включаются `npm run desktop:build:extras`.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Window, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Глобальная «быстрая задача»
pub const SHORTCUT: &str = "Ctrl+Alt+N";
/// Закрытие окна прячет его в трей (настройка хранится в файле рядом с конфигом приложения)
static TRAY_ON_CLOSE: AtomicBool = AtomicBool::new(false);

fn flag_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("tray-on-close"))
}
fn load_flag(app: &AppHandle) {
    let on = flag_path(app).map(|p| p.exists()).unwrap_or(false);
    TRAY_ON_CLOSE.store(on, Ordering::Relaxed);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Плагины: автозапуск (с флагом --minimized) и глобальные клавиши
pub fn plugins(b: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    b.plugin(tauri_plugin_autostart::init(
        MacosLauncher::LaunchAgent,
        Some(vec!["--minimized"]),
    ))
    .plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    show_main(app);
                    let _ = app.emit("quick-capture", ());
                }
            })
            .build(),
    )
}

/// Значок в трее, регистрация клавиши, скрытый старт при автозапуске
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    load_flag(&handle);

    let show = MenuItem::with_id(app, "show", "Открыть TetraFree", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("TetraFree")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    // Клавиша может быть занята другой программой — это не повод падать при старте
    let _ = app.global_shortcut().register(SHORTCUT);

    // Запуск из автозагрузки: прячемся в трей, но только если пользователь включил трей (иначе окно не достать)
    if std::env::args().any(|a| a == "--minimized") && TRAY_ON_CLOSE.load(Ordering::Relaxed) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && TRAY_ON_CLOSE.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub fn sys_info(app: AppHandle) -> serde_json::Value {
    let registered = app.global_shortcut().is_registered(SHORTCUT);
    serde_json::json!({
        "autostart": app.autolaunch().is_enabled().unwrap_or(false),
        "tray": TRAY_ON_CLOSE.load(Ordering::Relaxed),
        "shortcut": if registered { SHORTCUT } else { "" },
    })
}

#[tauri::command]
pub fn sys_set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    let m = app.autolaunch();
    let r = if on { m.enable() } else { m.disable() };
    r.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sys_set_tray(app: AppHandle, on: bool) -> Result<(), String> {
    let p = flag_path(&app).ok_or("нет папки конфигурации")?;
    if on {
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, "1").map_err(|e| e.to_string())?;
    } else if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    TRAY_ON_CLOSE.store(on, Ordering::Relaxed);
    Ok(())
}
