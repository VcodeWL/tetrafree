import { useEffect, useRef, useState } from 'react'
import { Resizer } from '../components/ui/Resizer'
import { useLayout, DOCK, dockMax } from '../lib/layout'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { PROMPT, COMPLETIONS } from '../lib/shell'
import { Icon } from '../components/ui/Icon'
import { backendOnline, serverOnline, bExec, useBackend } from '../lib/backend'
import { attachPty, killPty, type PtyHandle } from '../lib/pty'
import {
  MAX_TABS,
  addTab,
  closeTab,
  pickTab,
  sessionKey,
  tabsOf,
  updateTabs,
  useTermTabs,
} from '../lib/termtabs'
import { reconcile } from '../lib/sync'
import { takePending, takePendingPeek } from '../lib/termrun'

/* Встроенный терминал (xterm.js): настоящий PTY сервера в папке проекта; без PTY — построчный shell; без сервера — сообщение. */
function TermPane({ pid, tabId, active }: { pid: string; tabId: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const setDock = useStore((s) => s.setDock)
  const key = sessionKey(pid, tabId)
  const activeRef = useRef(active)
  activeRef.current = active
  const api = useRef<{ fit: () => void; focus: () => void } | null>(null)
  const ptyReady = useRef(false)
  const [wait, setWait] = useState(false)
  const isPty = useBackend((b) => b.status === 'online' && !!b.info?.pty && !!b.info.local)
  useEffect(() => {
    if (!host.current) return
    const proj = () => useStore.getState().projects.find((x) => x.id === pid)!
    const term = new XTerm({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'Consolas, monospace',
      fontSize: Math.min(22, Math.max(9, +(localStorage.getItem('tf.termSize') || 12.5))),
      lineHeight: 1.35,
      cursorBlink: true,
      allowTransparency: true,
      theme: {
        background: '#0b0b0e',
        foreground: '#c8c8d1',
        cursor: '#b9a6ff',
        selectionBackground: 'rgba(183,143,255,.3)',
        black: '#16161b',
        brightBlack: '#5e5e69',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    api.current = {
      fit: () => {
        try {
          fit.fit()
        } catch {
          /* скрыт */
        }
      },
      focus: () => term.focus(),
    }
    /* команды извне (скрипты package.json из Ctrl+K) */
    ptyReady.current = !isPty
    let tries = 0
    const take = () => {
      if (!activeRef.current || !takePendingPeek()) return
      if (!ptyReady.current) {
        if (tries++ < 40) setTimeout(take, 150)
        return
      }
      const c = takePending()
      if (c) term.input(c + '\r', true)
    }
    window.addEventListener('tf:termrun', take)
    const t0 = setTimeout(take, 400)
    const origDispose = term.dispose.bind(term)
    term.dispose = () => {
      window.removeEventListener('tf:termrun', take)
      clearTimeout(t0)
      origDispose()
    }
    /* Ctrl +/−/0 — размер шрифта терминала (запоминается) */
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey) return true
      const k = e.key,
        cur = term.options.fontSize || 12.5
      const next =
        k === '=' || k === '+' ? cur + 1 : k === '-' || k === '_' ? cur - 1 : k === '0' ? 12.5 : null
      if (next === null) return true
      const v = Math.min(22, Math.max(9, next))
      term.options.fontSize = v
      localStorage.setItem('tf.termSize', String(v))
      try {
        fit.fit()
      } catch {
        /* терминал скрыт */
      }
      return false
    })
    if (backendOnline() && useBackend.getState().info?.pty) {
      /* настоящий PTY: всё (редактирование строки, история, Tab, vim, ssh, пароли) делает сам shell */
      let h: PtyHandle | null = null,
        gone = false,
        tm = 0,
        exited = false
      const sync = () => {
        clearTimeout(tm)
        tm = window.setTimeout(() => void reconcile(pid, { quiet: true }), 1200)
      }
      const safeFit = () => {
        try {
          fit.fit()
        } catch {
          /* скрыт */
        }
      }
      safeFit()
      setWait(true)
      void attachPty(
        { id: pid, name: proj().name, path: proj().path, key },
        { cols: term.cols || 80, rows: term.rows || 24 },
        (d) => {
          setWait(false)
          term.write(d)
          sync()
        },
        (c) => {
          setWait(false)
          exited = true
          term.write(`\r\n\x1b[2m[процесс завершён, код ${c}] — нажми Enter, чтобы открыть новый\x1b[0m\r\n`)
        },
      )
        .then((hh) => {
          if (gone) {
            hh.detach()
            return
          }
          h = hh
          ptyReady.current = true
          hh.resize(term.cols, term.rows)
        })
        .catch((e) => {
          setWait(false)
          term.writeln(`\x1b[38;2;255;154;154mНе удалось открыть терминал: ${(e as Error).message}\x1b[0m`)
        })
      term.onData((d) => {
        if (exited && d === '\r') {
          exited = false
          term.reset()
          h?.detach()
          h = null
          void attachPty(
            { id: pid, name: proj().name, path: proj().path, key },
            { cols: term.cols, rows: term.rows },
            (x) => {
              term.write(x)
              sync()
            },
            () => {
              exited = true
              term.write('\r\n\x1b[2m[завершено] Enter — новый сеанс\x1b[0m\r\n')
            },
          ).then((hh) => {
            if (gone) hh.detach()
            else h = hh
          })
          return
        }
        h?.write(d)
      })
      term.onResize(({ cols, rows }) => h?.resize(cols, rows))
      const ro2 = new ResizeObserver(safeFit)
      ro2.observe(host.current)
      setTimeout(() => {
        safeFit()
        term.focus()
      }, 30)
      return () => {
        gone = true
        setWait(false)
        clearTimeout(tm)
        ro2.disconnect()
        h?.detach()
        api.current = null
        term.dispose()
      }
    }
    let cwd = '',
      line = '',
      hist: string[] = [],
      hi = -1
    let running: AbortController | null = null
    const prompt = () => term.write(PROMPT(proj(), cwd))
    term.writeln(
      backendOnline()
        ? '\x1b[38;2;143;230;192mShell\x1b[0m в папке проекта на диске. Интерактивный ввод (stdin) в этом режиме не поддерживается — для долгих команд используй Ctrl+C.'
        : serverOnline()
          ? '\x1b[38;2;255;154;154mТерминал доступен после входа в аккаунт\x1b[0m — сервер работает, но в локальном режиме без аккаунта он не пускает к диску и shell.'
          : '\x1b[38;2;255;154;154mСервер TetraFree не запущен\x1b[0m — терминалу нужен бэкенд (десктопная сборка запускает его сама, в браузере: npm run server).',
    )
    prompt()
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* скрыт */
      }
    })
    ro.observe(host.current)
    setTimeout(() => {
      try {
        fit.fit()
      } catch {
        /* noop */
      }
      term.focus()
    }, 30)
    const redraw = () => {
      term.write('\x1b[2K\r')
      prompt()
      term.write(line)
    }
    term.onData((d) => {
      if (running) {
        if (d === '\x03') running.abort()
        return
      }
      if (d === '\r') {
        term.write('\r\n')
        const cmd = line.trim()
        line = ''
        hi = -1
        if (cmd) {
          hist = [cmd, ...hist.filter((h) => h !== cmd)].slice(0, 50)
        }
        if (cmd === 'history')
          hist
            .slice()
            .reverse()
            .forEach((h, i) => term.writeln(`  ${i + 1}  ${h}`))
        else if (cmd === 'exit') {
          setDock(false)
          return
        } else if (cmd === 'clear') term.clear()
        else if (cmd && !backendOnline())
          term.writeln('\x1b[38;2;255;154;154mСервер не запущен — команду выполнить нельзя.\x1b[0m')
        else if (cmd) {
          const ctl = new AbortController()
          running = ctl
          void (async () => {
            try {
              await reconcile(pid, { quiet: true })
              const r = await bExec(proj(), cmd, {
                cwd,
                signal: ctl.signal,
                onOut: (d) => term.write(d.replace(/\r?\n/g, '\r\n')),
              })
              cwd = r.cwd
              if (r.code) term.write(`\x1b[38;2;255;154;154mкод выхода ${r.code}\x1b[0m\r\n`)
            } catch (e) {
              term.write(
                `\x1b[38;2;255;154;154m${ctl.signal.aborted ? '^C' : 'Ошибка: ' + (e as Error).message}\x1b[0m\r\n`,
              )
            } finally {
              running = null
              prompt()
              void reconcile(pid, { quiet: true })
            }
          })()
          return
        }
        prompt()
      } else if (d === '\x7f') {
        if (line) {
          line = line.slice(0, -1)
          term.write('\b \b')
        }
      } else if (d === '\x03') {
        term.write('^C\r\n')
        line = ''
        prompt()
      } else if (d === '\x0c') {
        term.clear()
        redraw()
      } else if (d === '\x1b[A') {
        if (hist.length) {
          hi = Math.min(hist.length - 1, hi + 1)
          line = hist[hi]
          redraw()
        }
      } else if (d === '\x1b[B') {
        hi = Math.max(-1, hi - 1)
        line = hi < 0 ? '' : hist[hi]
        redraw()
      } else if (d === '\t') {
        const words = line.split(' ')
        const last = words[words.length - 1]
        const pool =
          words.length > 1
            ? Object.keys(proj().files).map((f) =>
                cwd && f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f,
              )
            : COMPLETIONS
        const m = pool.filter((c) => c.startsWith(last))
        if (m.length === 1) {
          line =
            [...words.slice(0, -1), m[0]].join(' ') + (words.length === 1 && !m[0].includes(' ') ? ' ' : '')
          redraw()
        } else if (m.length > 1) {
          term.write('\r\n' + m.slice(0, 30).join('  ') + '\r\n')
          prompt()
          term.write(line)
        }
      } else if (d >= ' ' || d.length > 1) {
        if (!d.startsWith('\x1b')) {
          line += d
          term.write(d)
        }
      }
    })
    return () => {
      ro.disconnect()
      api.current = null
      term.dispose()
    }
  }, [pid, tabId, key, setDock, isPty])
  /* вкладка стала видимой: подогнать размер под панель и вернуть фокус */
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      api.current?.fit()
      api.current?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [active])
  return (
    <div className="dock-pane" style={active ? undefined : { display: 'none' }}>
      {wait && (
        <div className="term-wait" role="status">
          <i className="bspin light" />
          Запускаю shell…
        </div>
      )}
      <div
        className="dock-term"
        ref={host}
        onClick={(e) => (e.currentTarget.querySelector('textarea') as HTMLTextAreaElement | null)?.focus()}
      />
    </div>
  )
}

export function Dock() {
  const pid = useStore((s) => s.projectId)
  const p = useStore((s) => s.projects.find((x) => x.id === s.projectId))
  const setDock = useStore((s) => s.setDock)
  const online = useBackend((b) => b.status === 'online')
  const root = useBackend((b) => b.info?.root)
  const isPty = useBackend((b) => b.status === 'online' && !!b.info?.pty && !!b.info.local)
  const ts = useTermTabs((s) => (pid ? tabsOf(s.by, pid) : null))
  if (!pid || !ts) return null
  const close = (id: string) => {
    killPty(sessionKey(pid, id))
    const next = closeTab(ts, id)
    if (next) updateTabs(pid, () => next)
    else {
      updateTabs(pid, () => null)
      setDock(false)
    }
  }
  return (
    <div className="dock">
      <DockResizer />
      <div className="dock-bar">
        <span className="dock-t">
          <Icon name="terminal" size={13} />
        </span>
        <div className="dtabs">
          <div className="dtabs-list" role="tablist" aria-label="Вкладки терминала">
            {ts.tabs.map((t) => (
              <div
                key={t.id}
                role="tab"
                tabIndex={0}
                aria-selected={t.id === ts.active}
                className={'dtab' + (t.id === ts.active ? ' on' : '')}
                onClick={() => updateTabs(pid, (s) => pickTab(s, t.id))}
                onAuxClick={(e) => e.button === 1 && close(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') updateTabs(pid, (s) => pickTab(s, t.id))
                }}
              >
                Терминал {t.n}
                <button
                  className="dtab-x"
                  aria-label={`Закрыть терминал ${t.n}`}
                  title="Закрыть вкладку"
                  onClick={(e) => {
                    e.stopPropagation()
                    close(t.id)
                  }}
                >
                  <Icon name="x" size={10} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="iconbtn sm"
            title="Новая вкладка терминала"
            aria-label="Новая вкладка терминала"
            disabled={ts.tabs.length >= MAX_TABS}
            onClick={() => updateTabs(pid, addTab)}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <span
          className={'chip sm' + (online ? ' live' : '')}
          title={
            online
              ? 'Команды выполняются на этой машине'
              : 'Сервер TetraFree не найден — команды не выполняются'
          }
        >
          {isPty ? 'PTY · интерактивный' : online ? 'реальный shell' : 'нет сервера'}
        </span>
        <span className="t4 mono dock-p">
          {online && root ? root + '/' + p?.name : '/workspace/' + p?.name}
        </span>
        <span className="grow" />
        <button className="iconbtn sm" onClick={() => setDock(false)} aria-label="Скрыть терминал">
          <Icon name="chevd" size={14} />
        </button>
      </div>
      {ts.tabs.map((t) => (
        <TermPane key={pid + t.id} pid={pid} tabId={t.id} active={t.id === ts.active} />
      ))}
    </div>
  )
}

function DockResizer() {
  const h = useLayout((l) => l.dockH)
  const max = dockMax(window.innerHeight)
  return (
    <Resizer
      axis="y"
      dir={-1}
      className="dock-rsz"
      label="Высота нижней панели"
      value={h}
      min={DOCK.min}
      max={max}
      onChange={(v) => useLayout.getState().setDock(v, window.innerHeight)}
      onReset={() => useLayout.getState().setDock(DOCK.def, window.innerHeight)}
    />
  )
}
