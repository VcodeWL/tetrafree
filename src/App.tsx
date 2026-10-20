import { Modal, MHead } from './components/ui/Modal'
import { vaultRecoveryState, subscribeVaultRecovery, prepareVaultRecovery } from './lib/vault'
import { startDesktopLifecycle } from './lib/desktopLifecycle'
import { osNotify } from './lib/osnotify'
import { StatusBar } from './components/StatusBar'
import { actionFor, effective } from './lib/keymap'
import { Ambient } from './components/Ambient'
import { UpdateGate } from './components/UpdateGate'
import { uiStack, codeStack } from './lib/fonts'
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { APP_VERSION, latestRelease } from './data/changelog'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { useStore } from './store'
import { TitleBar } from './components/TitleBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toasts } from './components/Toasts'
import { InviteGate } from './modals/InviteGate'
import { openPalette, startPaletteBridge } from './lib/palette'
import { BuildSummaryOverlay } from './modals/BuildSummary'
import { runPipeline } from './agent/ci'
import { isRunning, stopTurn } from './agent/engine'
import { startAutomations } from './agent/autorun'
import { isDesktop, platform, onQuickCapture, updCheck, updInstall } from './lib/desktop'
import { useBackend } from './lib/backend'
import { openInEditor } from './lib/editors'

const Auth = lazy(() => import('./screens/Auth').then((m) => ({ default: m.Auth })))
const Launcher = lazy(() => import('./screens/Launcher').then((m) => ({ default: m.Launcher })))
const Workspace = lazy(() => import('./screens/Workspace').then((m) => ({ default: m.Workspace })))
const ModalRoot = lazy(() => import('./modals/ModalRoot').then((m) => ({ default: m.ModalRoot })))
const Palette = lazy(() => import('./modals/Palette').then((m) => ({ default: m.Palette })))

function ScreenLoading() {
  return (
    <div className="route-loading" role="status">
      Загружаю рабочее пространство…
    </div>
  )
}
function DialogLoading() {
  const close = () => {
    useStore.getState().closeModal()
    useStore.getState().setPalette(false)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <Modal label="Загрузка окна" onClose={close}>
      <MHead icon="clock" title="Загрузка окна" onClose={close} />
      <p role="status">Загружаю окно…</p>
      <button className="btn sm" onClick={close}>
        Отмена
      </button>
    </Modal>
  )
}

export function App() {
  const vaultRecovery = useSyncExternalStore(subscribeVaultRecovery, vaultRecoveryState, vaultRecoveryState)
  const screen = useStore((s) => s.screen)
  const modal = useStore((s) => s.modal)
  const palette = useStore((s) => s.palette)
  useEffect(() => startPaletteBridge(), [])
  useEffect(() => startDesktopLifecycle(), [])
  useEffect(() => {
    const on = (event: Event) => {
      const outcome = (event as CustomEvent<{ outcome?: string }>).detail?.outcome
      if (!['succeeded', 'failed', 'cancelled', 'interrupted', 'blocked'].includes(outcome || '')) return
      osNotify(
        outcome === 'failed' || outcome === 'blocked'
          ? 'Автоматизация не выполнена'
          : 'Автоматизация завершена',
        'Подробности доступны в приложении.',
      )
    }
    window.addEventListener('tetrafree:automation-notification', on)
    return () => window.removeEventListener('tetrafree:automation-notification', on)
  }, [])
  const settings = useStore((s) => s.settings)

  useEffect(() => {
    startAutomations()
  }, [])

  /* узкое окно (<1100 px): сайдбар прячется сам при сужении, возвращается при расширении — если его не трогали руками */
  useEffect(() => {
    const mq = window.matchMedia('(max-width:1099px)')
    let auto = false
    const apply = (narrow: boolean) => {
      const st = useStore.getState()
      if (narrow && !st.sideHidden) {
        auto = true
        st.setSideHidden(true)
      } else if (!narrow && auto) {
        auto = false
        st.setSideHidden(false)
      }
    }
    const on = (e: MediaQueryListEvent) => apply(e.matches)
    apply(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  /* после обновления приложения — один раз сообщаем, что изменилось */
  useEffect(() => {
    if (screen === 'auth') return
    const st = useStore.getState()
    const seen = st.settings.seenVersion
    if (seen === APP_VERSION) return
    st.setSetting('seenVersion', APP_VERSION)
    if (!seen) return // первая установка — рассказывать не о чем
    const r = latestRelease()
    st.toast({
      title: `Обновление ${r.v} — «${r.name}»`,
      desc: r.lead,
      icon: 'sparkle',
      action: {
        label: 'Что нового',
        run: () => useStore.getState().openModal({ type: 'settings', section: 'about' }),
      },
    })
  }, [screen])

  /* заголовок окна: проект — чтобы в списке окон и истории было понятно, где ты */
  const projName = useStore((s) =>
    s.screen === 'workspace' ? s.projects.find((p) => p.id === s.projectId)?.name : undefined,
  )
  useEffect(() => {
    document.title = projName ? `${projName} — TetraFree` : 'TetraFree'
  }, [projName])

  /* настройки оформления → классы на <html> */
  useEffect(() => {
    const c = document.documentElement.classList
    c.toggle('no-accents', !settings.accents)
    c.toggle('no-ambient', !settings.ambient)
    c.toggle('reduced', settings.reducedMotion)
    c.toggle('dense', settings.density === 'compact')
    c.toggle('look-grad', settings.look !== 'calm')
    document.documentElement.style.setProperty('--code-fs', (settings.codeSize || 12.5) + 'px')
    document.documentElement.style.setProperty('--sans', uiStack(settings.uiFont))
    document.documentElement.style.setProperty('--mono', codeStack(settings.codeFont))
    c.toggle('desktop', isDesktop)
    c.add('os-' + platform)
  }, [settings])

  /* доступность: кнопки-иконки с title получают aria-label (читалки экрана не читают title у button) */
  useEffect(() => {
    const fix = (root: ParentNode) =>
      root.querySelectorAll<HTMLElement>('button[title]:not([aria-label])').forEach((b) => {
        if (!b.textContent?.trim()) b.setAttribute('aria-label', b.title)
      })
    fix(document)
    let t = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(t)
      t = requestAnimationFrame(() => fix(document))
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(t)
    }
  }, [])

  /* тема: тёмная / светлая / как в системе */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const t = settings.theme || 'dark'
      document.documentElement.classList.toggle('light', t === 'light' || (t === 'system' && mq.matches))
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const ws = st.screen === 'workspace' && !!st.projectId
      if (!st.authed) return
      if (
        e.key === 'Escape' &&
        !st.modal &&
        !st.palette &&
        !document.querySelector('.dd') &&
        st.center.kind === 'chat' &&
        isRunning(st.center.id)
      ) {
        stopTurn(st.center.id)
        return
      }
      if (document.querySelector('.hk-edit.rec')) return /* идёт запись нового сочетания */
      if (!mod && !e.altKey) return
      const tgt = e.target as HTMLElement | null
      /* в настоящем терминале Ctrl+буква принадлежит shell (Ctrl+P/B/K/O…), в редакторе Ctrl+/ — комментарий */
      if (
        e.ctrlKey &&
        !e.metaKey &&
        e.code !== 'Backquote' &&
        !e.shiftKey &&
        tgt?.closest?.('.dock-term') &&
        useBackend.getState().info?.pty
      )
        return
      const act = (fn: () => void) => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }
      const a = actionFor(e, effective(st.settings.keys))
      /* в редакторе Ctrl+/ — комментарий строк */
      if (e.code === 'Slash' && tgt?.closest?.('.ed-ta')) return
      if (!a) {
        if (!ws && k === 'n' && e.shiftKey) act(() => st.openModal({ type: 'newProject' }))
        return
      }
      if (a.ws && !ws) {
        if (k === 'n' && e.shiftKey) act(() => st.openModal({ type: 'newProject' }))
        return
      }
      switch (a.id) {
        case 'palette':
          return act(() => (st.palette ? st.setPalette(false) : openPalette('')))
        case 'settings':
          return act(() => st.openModal({ type: 'settings' }))
        case 'shortcuts':
          return act(() => st.openModal({ type: 'shortcuts' }))
        case 'search':
          return act(() => openPalette('?'))
        case 'files':
          return act(() => openPalette('/'))
        case 'goto':
          return act(() => openPalette(':'))
        case 'today':
          return act(() => st.openModal({ type: 'today' }))
        case 'replace':
          return act(() => st.openModal({ type: 'replace' }))
        case 'git':
          return act(() => st.setRight({ rightOpen: true, rightTab: 'git' }))
        case 'project':
          return act(() => st.toLauncher())
        case 'side':
          if (tgt?.closest?.('textarea,[contenteditable]') && !e.shiftKey && !e.altKey) return
          return act(() => st.setSideHidden(!st.sideHidden))
        case 'dock':
        case 'term':
          return act(() => {
            if (st.mode === 'design') st.setMode('dev')
            st.setDock(!st.dock)
          })
        case 'newchat':
          return act(() => st.openModal({ type: 'newChat' }))
        case 'newtask':
          return act(() => st.openModal({ type: 'task' }))
        case 'pipeline':
          return act(() => {
            runPipeline('release')
            st.openModal({ type: 'deploy' })
          })
        case 'editor':
          return act(() => {
            const f = st.activeFile
            const pr = st.projects.find((x) => x.id === st.projectId)
            if (pr) void openInEditor(pr.id, f && pr.files[f] !== undefined ? { file: f } : {})
          })
        case 'design':
          return act(() => st.setMode(st.mode === 'design' ? 'dev' : 'design'))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /* сеть: предупреждаем, если модель подключена по API, а соединения нет */
  useEffect(() => {
    const off = () =>
      useStore.getState().toast({
        title: 'Нет подключения к сети',
        desc: 'Агенты с API-ключом ответят, когда связь вернётся. Локальные файлы и заметки доступны офлайн.',
        tone: 'warn',
        icon: 'warn',
      })
    const on = () => useStore.getState().toast({ title: 'Сеть снова доступна', icon: 'check', tone: 'ok' })
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    /* не даём случайно закрыть окно посреди работы агента */
    const bu = (e: BeforeUnloadEvent) => {
      const p = useStore.getState().projects.find((x) => x.id === useStore.getState().projectId)
      if (p?.chats.some((c) => isRunning(c.id))) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', bu)
    return () => {
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
      window.removeEventListener('beforeunload', bu)
    }
  }, [])

  /* в десктопе запрещаем системное контекстное меню и масштаб колесом — как в нативном приложении */
  useEffect(() => {
    if (!isDesktop) return
    const cm = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('input,textarea,pre,.code-body')) e.preventDefault()
    }
    window.addEventListener('contextmenu', cm)
    return () => window.removeEventListener('contextmenu', cm)
  }, [])

  /* пока приложение открыто: раз в 30 минут ищем новую версию и предлагаем поставить (при запуске ставит UpdateGate) */
  useEffect(() => {
    if (!isDesktop) return
    let shown = ''
    const tick = () =>
      void updCheck()
        .then((u) => {
          if (!u || u.version === shown) return
          shown = u.version
          useStore.getState().toast({
            title: `Доступна версия ${u.version}`,
            desc: 'Установка перезапустит приложение',
            icon: 'down',
            tone: 'ok',
            action: { label: 'Установить', run: () => void updInstall().catch(() => {}) },
          })
        })
        .catch(() => {})
    const first = window.setTimeout(tick, 60_000)
    const t = window.setInterval(tick, 30 * 60_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(t)
    }
  }, [])

  /* глобальная горячая клавиша (десктоп, фича extras): показать окно и открыть «Новая задача» */
  useEffect(() => {
    let off = () => {}
    let dead = false
    void onQuickCapture(() => {
      const st = useStore.getState()
      if (!st.authed) return
      if (!st.projectId && st.lastProject) st.openProject(st.lastProject)
      if (useStore.getState().projectId) st.openModal({ type: 'task' })
    }).then((f) => (dead ? f() : (off = f)))
    return () => {
      dead = true
      off()
    }
  }, [])

  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? 'always' : 'never'}>
      <Ambient still={settings.reducedMotion} />
      <UpdateGate />
      <div className="grain" />
      <div className="app">
        <TitleBar />
        <div className="app-body">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={screen}
              className="screen"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <ErrorBoundary>
                <Suspense fallback={<ScreenLoading />}>
                  {screen === 'auth' ? (
                    <Auth />
                  ) : vaultRecovery.blocked ? (
                    <main className="route-loading">
                      <h2>Нужно подтвердить хранилище ключей</h2>
                      <p role="alert">
                        {vaultRecovery.error || 'Удалённые ключи не будут использованы до проверки аккаунта.'}
                      </p>
                      <button
                        className="btn"
                        disabled={vaultRecovery.checking}
                        onClick={() => {
                          void prepareVaultRecovery().catch(() => {})
                        }}
                      >
                        Повторить проверку
                      </button>
                      <button className="btn" onClick={() => useStore.setState({ screen: 'auth' })}>
                        Подтвердить аккаунт
                      </button>
                    </main>
                  ) : screen === 'launcher' ? (
                    <Launcher />
                  ) : (
                    <Workspace />
                  )}
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </div>
        <StatusBar />
      </div>
      <ErrorBoundary>
        {modal && (
          <Suspense fallback={<DialogLoading />}>
            <ModalRoot />
          </Suspense>
        )}
      </ErrorBoundary>
      <ErrorBoundary>
        <InviteGate />
      </ErrorBoundary>
      {palette && (
        <ErrorBoundary>
          <Suspense fallback={<DialogLoading />}>
            <Palette />
          </Suspense>
        </ErrorBoundary>
      )}
      <BuildSummaryOverlay />
      <Toasts />
    </MotionConfig>
  )
}
