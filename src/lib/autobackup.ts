/* Автокопия: раз в сутки (и по кнопке) кладём резервную копию в ~/TetraFree/backups через локальный сервер. */
import { useStore, toast } from '../store'
import { backendOnline, bBackup } from './backend'
import { buildBackup } from './backup'

const KEY = 'tf.lastAutoBackup'
export const DAY = 24 * 3600e3
export const lastAutoBackup = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}
/** пора ли делать копию */
export const isDue = (last: number, now = Date.now(), every = DAY) => now - last >= every

export async function backupNow(quiet = false) {
  if (!backendOnline()) throw new Error('Нужен локальный сервер TetraFree')
  const r = await bBackup(buildBackup())
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  if (!quiet) toast({ title: 'Копия сохранена на диск', desc: r.dir, icon: 'down', tone: 'ok' })
  return r
}

let started = false
export function startAutoBackup() {
  if (started) return
  started = true
  const check = () => {
    const s = useStore.getState()
    if (!s.authed || s.settings.autoBackup === false || !backendOnline() || !s.projects.length) return
    if (isDue(lastAutoBackup()))
      void backupNow(true).catch(() => {
        /* повторим при следующей проверке */
      })
  }
  setTimeout(check, 25_000)
  setInterval(check, 30 * 60e3)
}
