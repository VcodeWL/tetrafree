import { ProjectIcon } from './ui/ProjectIcon'
import { AutomationControls } from '../agent/AutomationControls'
import { openPalette } from '../lib/palette'
import { useStore, useProject } from '../store'
import { isDesktop, winClose, winMinimize, winToggleMax } from '../lib/desktop'
import { Logo } from './ui/primitives'
import { Icon } from './ui/Icon'
import { modKey, ago } from '../lib/util'
import { captureSyncHealth, syncHealthLabel, useSyncStatus } from '../lib/syncStatus'
import { useAccount } from '../lib/account'
import { usePeers } from '../lib/team'
import { useNotifs } from '../lib/notifs'
import { useEffect, useRef, useState } from 'react'

/* Колокольчик: история уведомлений */
function Bell() {
  const items = useNotifs((n) => n.items)
  const readAll = useNotifs((n) => n.readAll)
  const clear = useNotifs((n) => n.clear)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const unread = items.filter((i) => !i.read).length
  useEffect(() => {
    if (!open) return
    readAll()
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open, readAll, items.length])
  return (
    <div className="bell" ref={box}>
      <button
        className={'tb-ic' + (open ? ' on' : '')}
        onClick={() => setOpen(!open)}
        title="Уведомления"
        aria-expanded={open}
      >
        <Icon name="bell" size={15} />
        {unread > 0 && <i className="bell-dot">{unread > 9 ? '9+' : unread}</i>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Уведомления">
          <div className="bell-h">
            <b>Уведомления</b>
            {items.length > 0 && (
              <button className="linkbtn" onClick={clear}>
                Очистить
              </button>
            )}
          </div>
          {!items.length ? (
            <div className="bell-empty">Пока тихо. Здесь будет история всплывающих сообщений.</div>
          ) : (
            <div className="bell-list">
              {items.map((n) => (
                <div key={n.id} className={'bell-i ' + (n.tone || '')}>
                  <span className="bi">
                    <Icon name={n.icon || (n.tone === 'err' ? 'warn' : 'check')} size={14} />
                  </span>
                  <div>
                    <b>{n.title}</b>
                    {n.desc && <span>{n.desc}</span>}
                  </div>
                  <time>{ago(n.at)}</time>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* Что сейчас происходит с данными: диск, облако, связь с сервером. Один взгляд — и понятно, всё ли сохранено и видят ли коллеги */
function SyncPill() {
  const p = useProject()
  useSyncStatus((s) => s.revision)
  const user = useAccount((a) => a.user)
  const cs = usePeers((x) => (p ? x.sync[p.id] : undefined))
  const live = usePeers((x) => (p ? !!x.live[p.id] : false))
  const health = captureSyncHealth(p?.id)
  const disk = syncHealthLabel(health)
  if (!user || !p) return null
  let label = disk.text,
    tip = disk.detail,
    cls = disk.c,
    spin = disk.c === 'sync'
  if (p.cloud) {
    spin = !!cs?.syncing
    cls = cs?.error ? 'err' : live ? 'live' : 'poll'
    label = cs?.error
      ? 'Облако: нужна проверка'
      : spin
        ? 'Обмениваюсь с облаком…'
        : live
          ? 'Облачное соединение открыто'
          : 'Облако: периодическая сверка'
    tip =
      'Подключение не подтверждает доставку всех правок.' +
      (cs?.at ? ' Последний обмен ' + ago(cs.at) + '.' : '') +
      ' ' +
      disk.detail
  }
  return (
    <button
      className={'syncpill ' + cls}
      title={tip}
      aria-live="polite"
      onClick={() =>
        useStore.getState().openModal({ type: 'settings', section: p.cloud ? 'members' : 'backend' })
      }
    >
      {spin ? <i className="bspin" /> : <i className="sd" />}
      {label}
    </button>
  )
}

/* Кастомный заголовок окна (Tauri: decorations:false, data-tauri-drag-region) */
export function TitleBar() {
  const screen = useStore((s) => s.screen)
  const p = useProject()
  const dock = useStore((s) => s.dock)
  const setDock = useStore((s) => s.setDock)
  const sideHidden = useStore((s) => s.sideHidden)
  const setSideHidden = useStore((s) => s.setSideHidden)
  const ws = screen === 'workspace' && p
  return (
    <header
      className={'titlebar' + (isDesktop ? ' native' : '')}
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) winToggleMax()
      }}
    >
      <div className="tb-l" data-tauri-drag-region>
        <Logo size={16} glow={false} />
        <span className="tb-app" data-tauri-drag-region>
          TetraFree
        </span>
        {ws && (
          <>
            <span className="tb-sep">/</span>
            <button
              className="tb-crumb"
              onClick={() => useStore.getState().toLauncher()}
              title={`Сменить проект (${modKey}+O)`}
            >
              <ProjectIcon name={p.icon} size={18} />
              {p.name}
              <Icon name="chevd" size={12} />
            </button>
          </>
        )}
      </div>
      <div className="tb-c" data-tauri-drag-region>
        {ws && (
          <button className="tb-search" aria-label="Поиск и команды" onClick={() => openPalette()}>
            <Icon name="search" size={13} />
            <span className="tb-search-label">Поиск и команды</span>
            <span className="k">{modKey} K</span>
          </button>
        )}
      </div>
      <div className="tb-r">
        {ws && <SyncPill />}
        {ws && <AutomationControls />}
        {screen !== 'auth' && (
          <button
            className="tb-ic"
            aria-label="Центр фоновых операций"
            title="Фоновые операции: работа, очередь, ошибки и история"
            onClick={() => useStore.getState().openModal({ type: 'operations' })}
          >
            <Icon name="layers" size={15} />
          </button>
        )}
        {screen !== 'auth' && (
          <button
            className="tb-ic"
            title="Центр восстановления"
            onClick={() => useStore.getState().openModal({ type: 'recovery' })}
          >
            <Icon name="clock" size={15} />
          </button>
        )}
        {screen !== 'auth' && <Bell />}
        {ws && (
          <>
            <button
              className={'tb-ic' + (!sideHidden ? ' on' : '')}
              onClick={() => setSideHidden(!sideHidden)}
              title={`Боковая панель (${modKey}+B)`}
            >
              <Icon name="sidebar" size={15} />
            </button>
            <button
              className={'tb-ic' + (dock ? ' on' : '')}
              onClick={() => setDock(!dock)}
              title={`Терминал (${modKey}+J)`}
            >
              <Icon name="terminal" size={15} />
            </button>
          </>
        )}
        {isDesktop && (
          <div className="wctl">
            <button onClick={winMinimize} aria-label="Свернуть">
              <Icon name="minus" size={14} />
            </button>
            <button onClick={winToggleMax} aria-label="Развернуть">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
              </svg>
            </button>
            <button className="close" onClick={winClose} aria-label="Закрыть">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
