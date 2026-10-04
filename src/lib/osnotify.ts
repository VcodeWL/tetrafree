/* Системные уведомления Windows: только когда окно не в фокусе — иначе хватает тостов внутри приложения. */
import { useStore } from '../store'

export const supported = () => typeof Notification !== 'undefined'
export const unfocused = () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus())

/** Включение: запрашиваем разрешение. Возвращает итоговый статус. */
export async function enableOsNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

export function osNotify(title: string, body: string, onClick?: () => void) {
  if (!supported() || Notification.permission !== 'granted') return
  if (!useStore.getState().settings.osNotify || !unfocused()) return
  try {
    const n = new Notification(title, { body, silent: false, tag: 'tf-' + title })
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
    setTimeout(() => n.close(), 12_000)
  } catch {
    /* ignore */
  }
}
