/// No remote URLs/icons/actions or arbitrary notification bodies are accepted.
pub fn payload(kind: &str, label: Option<&str>) -> Result<(&'static str, String), String> {
    let title = match kind {
        "agent-done" => "TetraFree — агент завершил работу",
        "automation-error" => "TetraFree — проверь автоматизацию",
        _ => return Err("Неизвестный вид уведомления".into()),
    };
    let label = label.unwrap_or("").trim();
    if label.chars().count() > 64 || label.chars().any(|c| c.is_control()) {
        return Err("Подпись уведомления слишком длинная или некорректная".into());
    }
    let body = if label.is_empty() {
        "Открой TetraFree, чтобы посмотреть результат.".to_string()
    } else {
        format!("{label}. Открой TetraFree, чтобы посмотреть результат.")
    };
    Ok((title, body))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_payload() {
        assert!(payload("unknown", None).is_err());
        assert!(payload("agent-done", Some(&"я".repeat(65))).is_err());
        assert!(payload("automation-error", Some("a\nb")).is_err());
        let (_, body) = payload("agent-done", Some(" Проект ")).unwrap();
        assert!(body.starts_with("Проект."));
        assert!(payload("agent-done", None).is_ok());
    }
}
