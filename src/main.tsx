import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/app.css'
import './styles/components.css'
import { App } from './App'
import { useStore, hydrateStore } from './store'
import { recoverySnapshots } from './store/persistence'
import { startSync } from './lib/sync'
import { startDocSync } from './lib/docsync'
import { initAccount, setAccountRecoveryMode } from './lib/account'
import { startCloud } from './lib/team'
import { startScheduler } from './agent/ci'
import { startAutoBackup } from './lib/autobackup'
import { startVault, prepareVaultRecovery } from './lib/vault'
import { detectBackend } from './lib/backend'

/* в dev-сборке стор доступен из консоли: __tf.getState() */
if (import.meta.env.DEV) {
  ;(window as unknown as { __tf: typeof useStore }).__tf = useStore
  void import('./lib/team').then((m) => {
    ;(window as unknown as { __team: unknown }).__team = m
  })
}

/* До окончания hydration не монтируем write-capable UI и не запускаем фоновые писатели. */
const root = ReactDOM.createRoot(document.getElementById('root')!)
let disposed = false
const RecoveryAuth = React.lazy(() => import('./screens/Auth').then((m) => ({ default: m.Auth })))
let vaultRecoveryFailed = false
function Recovery({ message }: { message: string }) {
  const [login, setLogin] = React.useState(false)
  const [exportError, setExportError] = React.useState('')
  const exportRaw = () => {
    try {
      const snapshots = { ...recoverySnapshots }
      try {
        const raw = localStorage.getItem('tetrafree')
        if (raw !== null) snapshots.localStorage = raw
      } catch {
        /* loaded IDB raw can still be exported */
      }
      if (!Object.keys(snapshots).length) {
        setExportError('Снимки пока недоступны. Дождись чтения хранилища; не очищай данные приложения.')
        return
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(snapshots, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = 'tetrafree-recovery.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setExportError(
        'Экспорт недоступен. Не очищай данные приложения; сохрани копию профиля WebView перед восстановлением.',
      )
    }
  }
  return (
    <main style={{ padding: 32, maxWidth: 800, margin: 'auto' }}>
      <h1>Не удалось безопасно открыть данные</h1>
      <p role="alert">{message}</p>
      <p>Редактирование и синхронизация не запущены. Исходные данные не очищены и не перезаписаны.</p>
      <p>
        Если данные сохранены другой версией TetraFree, установи совместимую версию. Перед восстановлением
        скачай исходные снимки; не очищай хранилище приложения.
      </p>
      <p>Файл восстановления может содержать личные данные и резервные API-ключи. Храни его безопасно.</p>
      <button onClick={exportRaw}>Скачать доступные исходные снимки</button>{' '}
      <button onClick={() => location.reload()}>Повторить загрузку</button>
      {vaultRecoveryFailed && (
        <button
          onClick={() => {
            useStore.setState({ screen: 'auth' })
            setLogin(true)
          }}
        >
          Подтвердить аккаунт
        </button>
      )}
      {login && (
        <React.Suspense fallback={<p role="status">Загружаю вход…</p>}>
          <RecoveryAuth />
        </React.Suspense>
      )}
      {login && <p>После входа нажми «Повторить загрузку». Фоновые записи пока не запущены.</p>}
      {exportError && <p role="status">{exportError}</p>}
    </main>
  )
}
const t = setTimeout(() => {
  if (disposed) return
  root.render(
    <Recovery message="Чтение хранилища занимает больше 10 секунд. Продолжаем ждать; работа с пустым состоянием запрещена." />,
  )
}, 10000)
void hydrateStore()
  .then(async () => {
    if (disposed) return
    await detectBackend()
    try {
      await prepareVaultRecovery()
    } catch (error) {
      vaultRecoveryFailed = true
      setAccountRecoveryMode(true)
      throw error
    }
    if (disposed) return
    clearTimeout(t)
    startSync()
    startDocSync()
    initAccount()
    startCloud()
    startScheduler()
    startAutoBackup()
    startVault()
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
  .catch((error: unknown) => {
    if (disposed) return
    clearTimeout(t)
    root.render(
      <Recovery
        message={
          error instanceof Error
            ? error.message
            : 'Ошибка чтения состояния. Сохрани исходные снимки для восстановления.'
        }
      />,
    )
  })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true
    clearTimeout(t)
    root.unmount()
  })
}
