import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/app.css'
import './styles/components.css'
import { App } from './App'
import { useStore } from './store'
import { startSync } from './lib/sync'
import { startDocSync } from './lib/docsync'
import { initAccount } from './lib/account'
import { startCloud } from './lib/team'
import { startScheduler } from './agent/ci'
import { startAutoBackup } from './lib/autobackup'
import { startVault } from './lib/vault'

/* в dev-сборке стор доступен из консоли: __tf.getState() */
if (import.meta.env.DEV) {
  ;(window as unknown as { __tf: typeof useStore }).__tf = useStore
  void import('./lib/team').then((m) => {
    ;(window as unknown as { __team: unknown }).__team = m
  })
}

/* Состояние читается из IndexedDB асинхронно: всё, что обращается к стору, стартует после загрузки (но не ждём дольше 10 с) */
const hydrated = new Promise<void>((resolve) => {
  if (useStore.persist.hasHydrated()) return resolve()
  const t = setTimeout(resolve, 10000)
  useStore.persist.onFinishHydration(() => {
    clearTimeout(t)
    resolve()
  })
})

void hydrated.then(() => {
  startSync()
  startDocSync()
  initAccount()
  startCloud()
  startScheduler()
  startAutoBackup()
  startVault()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
