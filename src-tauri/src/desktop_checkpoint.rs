use crate::checkpoint::{CheckpointGate, ExitPermit, Outcome};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[derive(Default)]
pub struct DesktopCheckpoint {
    pub gate: Arc<CheckpointGate>,
    pub exit_permit: ExitPermit,
    warning_open: AtomicBool,
}
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Команда доступна только главному окну".into())
    }
}
#[tauri::command]
pub fn desktop_checkpoint_ready(
    window: WebviewWindow,
    app: AppHandle,
    ready: bool,
) -> Result<(), String> {
    main_window(&window)?;
    app.state::<DesktopCheckpoint>().gate.ready(ready);
    Ok(())
}
#[tauri::command]
pub fn desktop_checkpoint_ack(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
    saved: bool,
) -> Result<bool, String> {
    main_window(&window)?;
    if token.len() != 64 {
        return Ok(false);
    }
    Ok(app.state::<DesktopCheckpoint>().gate.ack(&token, saved))
}
pub fn warning(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", "desktop-checkpoint-failed", ());
    crate::server::note("checkpoint не подтверждён; закрытие/обновление отменено");
    // A crashed/unready frontend cannot render a toast. Use a real native
    // warning as well; at most one dialog is outstanding, without blocking UI.
    if !app
        .state::<DesktopCheckpoint>()
        .warning_open
        .swap(true, Ordering::AcqRel)
    {
        let handle = app.clone();
        app.dialog().message("Сохранение не подтверждено. Приложение оставлено открытым. Повтори попытку, освободи место или экспортируй данные.")
            .title("TetraFree — сохранение не подтверждено")
            .kind(MessageDialogKind::Warning)
            .show(move |_| { handle.state::<DesktopCheckpoint>().warning_open.store(false, Ordering::Release); });
    }
}
pub async fn save(app: &AppHandle, reason: &str) -> Result<(), String> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "Не удалось создать запрос сохранения".to_string())?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let gate = app.state::<DesktopCheckpoint>().gate.clone();
    gate.begin(&token, Duration::from_secs(8))
        .map_err(str::to_owned)?;
    if app
        .emit_to(
            "main",
            "desktop-checkpoint",
            serde_json::json!({ "token": token, "reason": reason, "timeoutMs": 8000 }),
        )
        .is_err()
    {
        gate.cancel(&token);
        return Err("Не удалось запросить сохранение окна".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || gate.wait(&token))
        .await
        .map_err(|_| "Ожидание сохранения прервано".to_string())?;
    match result {
        Outcome::Saved => Ok(()),
        _ => Err("Сохранение не подтверждено; приложение оставлено открытым".into()),
    }
}
pub fn allow_exit(app: &AppHandle) {
    app.state::<DesktopCheckpoint>()
        .exit_permit
        .grant(Duration::from_secs(2));
}
pub fn take_exit_permit(app: &AppHandle) -> bool {
    app.state::<DesktopCheckpoint>().exit_permit.take()
}

pub fn request_close(app: AppHandle, hide: bool) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::ServerChild>();
        let Ok(_lease) = state.1.acquire() else {
            warning(&app);
            return;
        };
        if save(&app, if hide { "hide" } else { "quit" })
            .await
            .is_err()
        {
            warning(&app);
            return;
        }
        #[cfg(feature = "extras")]
        let hide = hide && crate::extras::tray_enabled();
        if hide {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        } else {
            allow_exit(&app);
            app.exit(0);
        }
    });
}
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        api.prevent_close();
        #[cfg(feature = "extras")]
        let hide = crate::extras::tray_enabled();
        #[cfg(not(feature = "extras"))]
        let hide = false;
        request_close(window.app_handle().clone(), hide);
    }
}
#[tauri::command]
pub fn desktop_quit(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    main_window(&window)?;
    request_close(app, false);
    Ok(())
}
#[tauri::command]
pub fn desktop_features(window: WebviewWindow) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    Ok(
        serde_json::json!({ "checkpoint": true, "extras": cfg!(feature="extras"), "notifications": cfg!(all(windows, feature="extras")) }),
    )
}
