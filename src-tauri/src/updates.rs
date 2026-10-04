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
                let _ = progress.emit("update-progress", serde_json::json!({ "done": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    if let Some(st) = app.try_state::<crate::ServerChild>() {
        if let Some(mut c) = st.0.lock().unwrap().take() {
            let _ = c.kill();
        }
    }
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}
