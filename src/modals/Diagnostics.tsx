import { useEffect, useRef, useState } from 'react'
import { Modal, MHead } from '../components/ui/Modal'
import { diagnosticsJSON } from '../lib/diagnostics'
import { download } from '../lib/util'

/** The integration owns collection; only the allowlist builder may cross the export boundary. */
export function DiagnosticsModal({ collect }: { collect: () => unknown }) {
  const capture = () => {
    try {
      return { json: diagnosticsJSON(collect()), failed: false }
    } catch {
      return { json: '', failed: true }
    }
  }
  const [snapshot, setSnapshot] = useState(capture)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const lifecycle = useRef({ mounted: false, operation: 0 })
  const copying = useRef(false)
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    return () => {
      state.mounted = false
      state.operation++
    }
  }, [])
  const copy = async () => {
    if (snapshot.failed || copying.current) return
    copying.current = true
    setBusy(true)
    setNotice('')
    const state = lifecycle.current
    const id = ++state.operation
    try {
      // No legacy execCommand fallback: it may report success without actually copying.
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(snapshot.json)
      if (state.mounted && state.operation === id) setNotice('Диагностика скопирована.')
    } catch {
      if (state.mounted && state.operation === id) setNotice('Не удалось скопировать. Скачай JSON.')
    } finally {
      copying.current = false
      if (state.mounted && state.operation === id) setBusy(false)
    }
  }
  const save = () => {
    if (snapshot.failed || copying.current) return
    try {
      download('tetrafree-diagnostics.json', snapshot.json, 'application/json')
      setNotice('JSON подготовлен к скачиванию.')
    } catch {
      setNotice('Не удалось подготовить JSON. Попробуй скопировать его.')
    }
  }
  return (
    <Modal label="Локальная диагностика" wide>
      <MHead icon="info" title="Локальная диагностика" />
      <p>
        Только ограниченные технические метаданные. Ключи, имена, пути и содержимое не включаются. Ничего не
        отправляется в сеть.
      </p>
      <p>
        Это снимок наблюдений, не проверка исправности. «not_checked» означает, что проверка не выполнялась
        или результат неизвестен. Счётчики ограничены указанными limits.
      </p>
      {snapshot.failed ? (
        <p role="alert">Не удалось собрать снимок. Экспорт отключён; исходные данные не изменены.</p>
      ) : (
        <textarea
          className="mono diagnostics-json"
          aria-label="JSON диагностики"
          readOnly
          rows={20}
          value={snapshot.json}
        />
      )}
      <div className="set-actions">
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => {
            if (copying.current) return
            setSnapshot(capture())
            setNotice('')
          }}
        >
          Обновить снимок
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={busy || snapshot.failed}
          onClick={() => void copy()}
        >
          Копировать JSON
        </button>
        <button type="button" className="btn sm" disabled={busy || snapshot.failed} onClick={save}>
          Скачать JSON
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </Modal>
  )
}
