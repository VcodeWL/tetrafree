/* Проверка адреса удалённого репозитория. Принимаем только https://, ssh:// и scp-форму git@host:path:
   file://, ext::, локальные пути и всё, что похоже на опцию git, отклоняем (это защита от запуска чужих команд). */
const HOST = '[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?'

export function checkRemoteUrl(raw) {
  const url = String(raw ?? '').trim()
  if (!url) return { ok: false, reason: 'Введи адрес репозитория' }
  if (url.length > 300) return { ok: false, reason: 'Адрес слишком длинный' }
  if (/[\s\u0000-\u001f\u007f"'`$\\<>|;&]/.test(url))
    return { ok: false, reason: 'В адресе недопустимые символы' }
  if (url.startsWith('-')) return { ok: false, reason: 'Адрес не может начинаться с «-»' }
  if (/^https?:\/\//i.test(url)) {
    if (/^http:\/\//i.test(url)) return { ok: false, reason: 'Нужен защищённый адрес: https://…' }
    const m = new RegExp(`^https://([^/@]*@)?(${HOST})(:\\d{1,5})?/(.+)$`, 'i').exec(url)
    if (!m) return { ok: false, reason: 'Ожидается адрес вида https://github.com/команда/проект.git' }
    if (m[1])
      return {
        ok: false,
        reason:
          'Не вставляй логин и токен в адрес — он сохранится в открытом виде. Вход выполнит менеджер учётных данных Git.',
      }
    if (/(^|\/)\.\.(\/|$)/.test(m[4])) return { ok: false, reason: 'Недопустимый путь в адресе' }
    return { ok: true, url }
  }
  if (/^ssh:\/\//i.test(url)) {
    const m = new RegExp(`^ssh://([A-Za-z0-9._-]+@)?(${HOST})(:\\d{1,5})?/(.+)$`, 'i').exec(url)
    if (!m || /(^|\/)\.\.(\/|$)/.test(m[4]))
      return { ok: false, reason: 'Ожидается ssh://git@host/команда/проект.git' }
    return { ok: true, url }
  }
  if (/^[A-Za-z0-9._-]+@/.test(url)) {
    const m = new RegExp(`^[A-Za-z0-9._-]+@(${HOST}):(?!/)(.+)$`).exec(url)
    if (!m || /(^|\/)\.\.(\/|$)/.test(m[2]))
      return { ok: false, reason: 'Ожидается git@github.com:команда/проект.git' }
    return { ok: true, url }
  }
  return { ok: false, reason: 'Ожидается https://…, ssh://… или git@host:путь' }
}

/** Адрес без логина/пароля — для показа в интерфейсе */
export function redactUrl(url) {
  return String(url).replace(/^(https?:\/\/)[^/@]*@/i, '$1')
}
