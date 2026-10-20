//! Автообновление через GitHub Releases (cargo-фича `updater`).
//! Подпись и адрес `latest.json` задаются в tauri.updater.conf.json; в CI их подставляет .github/workflows/release.yml.
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// Есть ли новая версия: null или { version, notes, date }
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(serde_json::json!({
            "version": u.version,
            "notes": u.body,
            "date": u.date.map(|d| d.to_string()),
        })),
        None => Ok(serde_json::Value::Null),
    }
}

/// Скачать, остановить встроенный сервер (иначе он останется висеть и займёт порт), установить и перезапустить
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::ServerChild>();
    let _lease = state.1.acquire()?;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Новых версий нет")?;
    let mut done: u64 = 0;
    let progress = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit(
                    "update-progress",
                    serde_json::json!({ "done": done, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut backend = state
        .0
        .lock()
        .map_err(|_| "Ошибка состояния сервера".to_string())?;
    if let Some(child) = backend.take() {
        child.stop()?;
    }
    if let Err(install_error) = update.install(bytes) {
        let error = match crate::server::spawn(&app) {
            Ok(child) => { *backend = Some(child); format!("Обновление не установлено: {install_error}. Сервер восстановлен.") }
            Err(recovery) => format!("Обновление не установлено: {install_error}. Сервер восстановить не удалось: {recovery}"),
        };
        crate::server::note(&error);
        return Err(error);
    }
    drop(backend);
    app.restart()
}
