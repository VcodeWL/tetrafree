/* Состояние встроенного сервера десктопной версии: жив ли процесс, код выхода, лог, перезапуск.
   В браузере (dev) блока нет — сервер там запускается командой. */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from './ui/Icon'
import { useBackend, detectBackend } from '../lib/backend'
import { isDesktop, srvLog, srvRestart, srvStatus, type SrvStatus } from '../lib/desktop'

export function ServerHelp({ always = false }: { always?: boolean }) {
  const online = useBackend((s) => s.status === 'online')
  const [st, setSt] = useState<SrvStatus | null>(null)
  const [log, setLog] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    setSt(await srvStatus())
  }, [])
  useEffect(() => {
    if (isDesktop) void refresh()
  }, [refresh, online])

  if (!isDesktop || (!always && online)) return null

  const restart = async () => {
    setBusy(true)
    setMsg('')
    try {
      await srvRestart()
      await new Promise((r) => window.setTimeout(r, 1500))
      await detectBackend()
      setLog(null)
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e))
    }
    await refresh()
    setBusy(false)
  }
  const showLog = async () => setLog(await srvLog())
  const copyLog = async () => {
    const t = log ?? (await srvLog())
    try {
      await navigator.clipboard.writeText(t)
      setMsg('Лог скопирован')
    } catch {
      setMsg('Не удалось скопировать — открой файл по пути выше')
    }
  }
  const state = !st
    ? 'состояние неизвестно'
    : st.running
      ? 'процесс запущен'
      : st.exit !== null
        ? `процесс завершился, код ${st.exit}`
        : 'процесс не запущен'

  return (
    <div className="srv-help">
      <div className="srv-row">
        <span className={'srv-dot ' + (online ? 'ok' : 'bad')} aria-hidden />
        <span>
          Встроенный сервер: {online ? 'отвечает' : 'не отвечает'} · {state}
        </span>
      </div>
      <div className="srv-btns">
        <button className="btn sm" disabled={busy} onClick={() => void restart()}>
          <Icon name="refresh" size={13} />
          {busy ? 'Перезапускаю…' : 'Перезапустить сервер'}
        </button>
        <button className="btn sm" onClick={() => void showLog()}>
          Показать лог
        </button>
        <button className="btn sm" onClick={() => void copyLog()}>
          Скопировать лог
        </button>
      </div>
      {msg && (
        <div className="srv-msg" role="status">
          {msg}
        </div>
      )}
      {log !== null && <pre className="srv-log">{log.trim() || 'Лог пуст.'}</pre>}
    </div>
  )
}
