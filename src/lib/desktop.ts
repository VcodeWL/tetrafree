/* Мост к Tauri 2. В обычном браузере (dev-режим) всё деградирует мягко. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
async function win() {
  const m = await import('@tauri-apps/api/window')
  return m.getCurrentWindow()
}
export const winMinimize = async () => {
  if (isDesktop) (await win()).minimize()
}
export const winToggleMax = async () => {
  if (isDesktop) (await win()).toggleMaximize()
}
export const winClose = async () => {
  if (isDesktop) (await win()).close()
}
export async function openExternal(url: string) {
  if (isDesktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    return openUrl(url)
  }
  window.open(url, '_blank', 'noopener')
}
export const platform =
  typeof navigator !== 'undefined'
    ? /Win/.test(navigator.platform)
      ? 'win'
      : /Mac/.test(navigator.platform)
        ? 'mac'
        : 'linux'
    : 'linux'

/* ---- системные функции Windows: автозапуск, значок в трее, глобальная горячая клавиша ----
   Реализованы в src-tauri за cargo-фичей `extras` (см. README). В обычной сборке команд нет —
   sysInfo() вернёт null и переключатели в настройках не показываются. */
export interface SysInfo {
  autostart: boolean
  tray: boolean
  /** сочетание глобальной «быстрой задачи» */
  shortcut: string
}
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}
export async function sysInfo(): Promise<SysInfo | null> {
  if (!isDesktop) return null
  try {
    return await call<SysInfo>('sys_info')
  } catch {
    return null
  }
}
export const sysSetAutostart = (on: boolean) => call<void>('sys_set_autostart', { on })
export const sysSetTray = (on: boolean) => call<void>('sys_set_tray', { on })
/** Глобальная горячая клавиша нажата — окно уже показано Rust-ом; вызываем обработчик */
export async function onQuickCapture(fn: () => void): Promise<() => void> {
  if (!isDesktop) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen('quick-capture', fn)
}

/* ---- автообновление через GitHub Releases (cargo-фича `updater`) ---- */
export interface UpdateInfo {
  version: string
  notes: string | null
  date: string | null
}
/** null — обновлений нет; бросает ошибку, если сборка без автообновления или нет сети */
export const updCheck = () => call<UpdateInfo | null>('update_check')
/** Скачивает, ставит и перезапускает приложение */
export const updInstall = () => call<void>('update_install')
/** Прогресс загрузки обновления: done/total в байтах (total может быть неизвестен) */
export async function onUpdateProgress(
  fn: (done: number, total: number | null) => void,
): Promise<() => void> {
  if (!isDesktop) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<{ done: number; total: number | null }>('update-progress', (e) =>
    fn(e.payload.done, e.payload.total),
  )
}

/* ---- встроенный сервер (server.rs): состояние, лог, перезапуск ---- */
export interface SrvStatus {
  running: boolean
  exit: number | null
  log: string | null
}
export async function srvStatus(): Promise<SrvStatus | null> {
  if (!isDesktop) return null
  try {
    return await call<SrvStatus>('server_status')
  } catch {
    return null
  }
}
export async function srvLog(): Promise<string> {
  if (!isDesktop) return ''
  try {
    return await call<string>('server_log')
  } catch {
    return ''
  }
}
export const srvRestart = () => call<void>('server_restart')
