//! Системные функции десктопа (cargo-фича `extras`): автозапуск, значок в трее, глобальная горячая клавиша.
//! Выключены по умолчанию: включаются `npm run desktop:build:extras`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::{NotificationExt, PermissionState};
static NOTIFICATIONS: AtomicBool = AtomicBool::new(false);
static LAST_NOTIFICATION: Mutex<Option<Instant>> = Mutex::new(None);

pub fn tray_enabled() -> bool {
    TRAY_ON_CLOSE.load(Ordering::Relaxed)
}
fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Доступно только главному окну".into())
    }
}
fn notification_flag(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "Нет папки настроек".to_string())?
        .join("native-notifications"))
}
fn set_flag(path: &std::path::Path, on: bool) -> Result<(), String> {
    if on {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|_| "Не удалось сохранить настройку".to_string())?;
        }
        std::fs::write(path, "1").map_err(|_| "Не удалось сохранить настройку".to_string())
    } else if path.exists() {
        std::fs::remove_file(path).map_err(|_| "Не удалось сохранить настройку".to_string())
    } else {
        Ok(())
    }
}

/// Глобальная «быстрая задача»
pub const SHORTCUT: &str = "Ctrl+Alt+N";
/// Закрытие окна прячет его в трей (настройка хранится в файле рядом с конфигом приложения)
static TRAY_ON_CLOSE: AtomicBool = AtomicBool::new(false);

fn flag_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("tray-on-close"))
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
    b.plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
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

/// Icon exists only while explicit tray preference is on.
fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id("main").is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(app, "show", "Открыть TetraFree", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("TetraFree")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => crate::desktop_checkpoint::request_close(app.clone(), false),
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
    Ok(())
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    load_flag(&handle);
    NOTIFICATIONS.store(
        notification_flag(&handle)
            .map(|p| p.exists())
            .unwrap_or(false),
        Ordering::Relaxed,
    );
    if tray_enabled() {
        create_tray(&handle)?;
    }

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

#[tauri::command]
pub fn sys_info(window: WebviewWindow, app: AppHandle) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let registered = app.global_shortcut().is_registered(SHORTCUT);
    Ok(serde_json::json!({
        "notifications": NOTIFICATIONS.load(Ordering::Relaxed),
        "notificationSupported": cfg!(windows),
        "autostart": app.autolaunch().is_enabled().unwrap_or(false),
        "tray": TRAY_ON_CLOSE.load(Ordering::Relaxed),
        "shortcut": if registered { SHORTCUT } else { "" },
    }))
}

#[tauri::command]
pub fn sys_set_autostart(window: WebviewWindow, app: AppHandle, on: bool) -> Result<(), String> {
    main_only(&window)?;
    let m = app.autolaunch();
    let r = if on { m.enable() } else { m.disable() };
    r.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sys_set_tray(window: WebviewWindow, app: AppHandle, on: bool) -> Result<(), String> {
    main_only(&window)?;
    let path = flag_path(&app).ok_or("Нет папки настроек")?;
    if on {
        create_tray(&app).map_err(|_| "Не удалось создать значок в трее".to_string())?;
    }
    if let Err(error) = set_flag(&path, on) {
        if on && !tray_enabled() {
            app.remove_tray_by_id("main");
        }
        return Err(error);
    }
    TRAY_ON_CLOSE.store(on, Ordering::Relaxed);
    if !on {
        show_main(&app);
        app.remove_tray_by_id("main");
    }
    Ok(())
}

#[tauri::command]
pub fn sys_set_notifications(
    window: WebviewWindow,
    app: AppHandle,
    on: bool,
) -> Result<(), String> {
    main_only(&window)?;
    if on {
        if !cfg!(windows) {
            return Err("Системные уведомления этой сборки доступны только в Windows".into());
        }
        if app
            .notification()
            .request_permission()
            .map_err(|_| "Не удалось проверить уведомления".to_string())?
            != PermissionState::Granted
        {
            return Err("Системные уведомления недоступны".into());
        }
    }
    set_flag(&notification_flag(&app)?, on)?;
    NOTIFICATIONS.store(on, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn desktop_notify(
    window: WebviewWindow,
    app: AppHandle,
    kind: String,
    label: Option<String>,
) -> Result<bool, String> {
    main_only(&window)?;
    let (title, body) = crate::notification_policy::payload(&kind, label.as_deref())?;
    if !cfg!(windows) || !NOTIFICATIONS.load(Ordering::Relaxed) {
        return Ok(false);
    }
    if window.is_visible().unwrap_or(true) && window.is_focused().unwrap_or(true) {
        return Ok(false);
    }
    if app
        .notification()
        .permission_state()
        .map_err(|_| "Не удалось проверить уведомления".to_string())?
        != PermissionState::Granted
    {
        return Ok(false);
    }
    let mut last = LAST_NOTIFICATION
        .lock()
        .map_err(|_| "Уведомления заняты".to_string())?;
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
        return Ok(false);
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| "Не удалось отправить уведомление Windows".to_string())?;
    *last = Some(Instant::now());
    Ok(true)
}
