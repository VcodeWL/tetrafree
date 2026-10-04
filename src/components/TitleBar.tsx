import { useStore, useProject } from '../store'
import { isDesktop, winClose, winMinimize, winToggleMax } from '../lib/desktop'
import { Logo } from './ui/primitives'
import { Icon } from './ui/Icon'
import { modKey, ago } from '../lib/util'
import { useBackend } from '../lib/backend'
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
  const b = useBackend()
  const user = useAccount((a) => a.user)
  const cs = usePeers((x) => (p ? x.sync[p.id] : undefined))
  const live = usePeers((x) => (p ? !!x.live[p.id] : false))
  if (!user) return null
  let cls = '',
    label = '',
    tip = '',
    spin = false
  if (b.status === 'checking') {
    label = 'Подключаюсь…'
    spin = true
    tip = 'Ищу сервер TetraFree'
  } else if (b.status === 'offline') {
    cls = 'err'
    label = 'Нет сервера'
    tip = 'Сервер не отвечает. Работаю локально, изменения сохраняются в браузере и отправятся позже.'
  } else if (p?.cloud) {
    if (cs?.error) {
      cls = 'err'
      label = 'Ошибка облака'
      tip = cs.error
    } else if (cs?.syncing || b.syncing) {
      label = 'Синхронизация'
      spin = true
      tip = 'Обмениваюсь изменениями с командой'
    } else if (live) {
      cls = 'live'
      label = 'Команда онлайн'
      tip = 'Правки коллег приходят мгновенно' + (cs?.at ? ' · последняя сверка ' + ago(cs.at) : '')
    } else {
      cls = 'poll'
      label = 'Облако · раз в 5 с'
      tip = 'Поток событий не подключён, проверяю раз в 5 секунд'
    }
  } else if (b.syncing) {
    label = 'Сохраняю на диск'
    spin = true
    tip = 'Синхронизация с папкой проекта'
  } else if (b.lastError) {
    cls = 'err'
    label = 'Ошибка диска'
    tip = b.lastError
  } else return null
  return (
    <button
      className={'syncpill ' + cls}
      title={tip}
      aria-live="polite"
      onClick={() => p?.cloud && useStore.getState().openModal({ type: 'settings', section: 'members' })}
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
  const setPalette = useStore((s) => s.setPalette)
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
              {p.name}
              <Icon name="chevd" size={12} />
            </button>
          </>
        )}
      </div>
      <div className="tb-c" data-tauri-drag-region>
        {ws && (
          <button className="tb-search" onClick={() => setPalette(true)}>
            <Icon name="search" size={13} />
            Поиск и команды<span className="k">{modKey} K</span>
          </button>
        )}
      </div>
      <div className="tb-r">
        {ws && <SyncPill />}
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
