import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { Avatar, Wordmark, PersonAv, AgentAvatar } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Menu, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { ago, nChats, nMembers, modKey, plural } from '../lib/util'
import { exportProject, importProjectFile } from '../lib/projectIO'
import type { Lane, Project } from '../types'
import { InviteCards } from '../modals/InviteGate'
import { logout } from '../lib/account'
import { openInEditor } from '../lib/editors'
import { bReveal, bCheckFolder, backendOnline, useBackend } from '../lib/backend'
import { Onboarding } from './Onboarding'

const nAgents = (n: number) => `${n} ${plural(n, ['агент работает', 'агента работают', 'агентов работают'])}`

/* Агенты в работе: что делает, где (чат), какие файлы занял, сколько сделано */
function LaneRow({ p, l, compact }: { p: Project; l: Lane; compact?: boolean }) {
  const go = (e: React.MouseEvent) => {
    e.stopPropagation()
    const st = useStore.getState()
    st.openProject(p.id)
    if (l.chatId && p.chats.some((c) => c.id === l.chatId)) st.setCenter({ kind: 'chat', id: l.chatId })
  }
  return (
    <button className={'lane' + (compact ? ' compact' : '')} onClick={go} title={`Открыть чат «${l.chat}»`}>
      <AgentAvatar name={l.who} size={compact ? 20 : 24} />
      <span className="lw">
        <b>{l.who}</b>
        <span className="la">{l.act}</span>
      </span>
      {!compact && (
        <span className="lc">
          {p.name} · «{l.chat}»
        </span>
      )}
      {l.lease !== '—' ? (
        <code className="ll" title={l.mode === 'write' ? 'Пишет в эти файлы' : 'Читает эти файлы'}>
          <Icon name={l.mode === 'write' ? 'edit' : 'eye'} size={11} />
          {l.lease}
        </code>
      ) : (
        <span className="ll none" />
      )}
      <span className="lp">
        <i style={{ width: l.pct + '%' }} />
      </span>
      <span className="lpc">{l.pct}%</span>
    </button>
  )
}

export function Launcher() {
  const projects = useStore((s) => s.projects)
  const sort = useStore((s) => s.sort)
  const people = useStore((s) => s.people)
  const st = useStore.getState
  const [q, setQ] = useState('')
  const menu = useMenu<Project>()
  const prof = useMenu()
  const fileRef = useRef<HTMLInputElement>(null)
  /* проекты, чья папка исчезла с диска */
  const [gone, setGone] = useState<Set<string>>(new Set())
  const online = useBackend((b) => b.status === 'online')
  useEffect(() => {
    if (!online || !backendOnline()) return
    let live = true
    projects.forEach((p) => {
      if (!p.path) return
      bCheckFolder(p.path)
        .then((r) => {
          if (live && r.ok && r.exists === false) setGone((g) => new Set(g).add(p.id))
        })
        .catch(() => {})
    })
    return () => {
      live = false
    }
  }, [online, projects.length]) // eslint-disable-line react-hooks/exhaustive-deps -- проверяем при открытии и при добавлении проекта
  const working = projects.flatMap((p) => p.lanes.map((l) => ({ p, l })))
  const list = useMemo(() => {
    const f = projects.filter((p) =>
      (p.name + ' ' + p.desc + ' ' + p.path).toLowerCase().includes(q.toLowerCase().trim()),
    )
    return [...f].sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        (sort === 'name' ? a.name.localeCompare(b.name) : b.openedAt - a.openedAt),
    )
  }, [projects, q, sort])

  /* «/» — к поиску проектов, как в большинстве приложений */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || useStore.getState().modal) return
      if ((e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable]')) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('.lc-bar .search input')?.focus()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const doImport = async (f?: File) => {
    if (!f) return
    try {
      const p = await importProjectFile(f)
      st().importProject(p)
      st().toast({ title: 'Проект импортирован', desc: p.name, icon: 'down', tone: 'ok' })
    } catch (e) {
      st().toast({ title: 'Не удалось импортировать', desc: (e as Error).message, tone: 'err', icon: 'warn' })
    }
  }
  const act = (p: Project, what: string) => {
    menu.close()
    if (what === 'open') st().openProject(p.id)
    if (what === 'rename')
      st().openModal({
        type: 'rename',
        title: 'Переименовать проект',
        value: p.name,
        run: (v) => st().renameProject(p.id, v),
      })
    if (what === 'reveal')
      bReveal(p).then(
        (r) => {
          if (!r.ok) st().toast({ title: 'Не открылось', desc: r.reason, icon: 'warn', tone: 'warn' })
        },
        (e) =>
          st().toast({
            title: 'Нужен сервер TetraFree',
            desc: String(e.message),
            icon: 'warn',
            tone: 'warn',
          }),
      )
    if (what === 'editor') void openInEditor(p.id)
    if (what === 'folder') st().openModal({ type: 'projectFolder', id: p.id })
    if (what === 'pin')
      st().up((x) => {
        x.pinned = !x.pinned
      }, p.id)
    if (what === 'dup') {
      st().duplicateProject(p.id)
      st().toast({ title: 'Копия создана', desc: p.name + '-copy', icon: 'copy' })
    }
    if (what === 'delete')
      st().openModal({
        type: 'confirm',
        danger: true,
        title: `Удалить «${p.name}»?`,
        body: 'Проект, чаты, документы, задачи и история версий будут удалены с этого устройства. Сначала можно выгрузить архив.',
        confirm: 'Удалить проект',
        run: () => {
          const i = st().projects.findIndex((x) => x.id === p.id)
          const copy = structuredClone(st().projects[i])
          st().deleteProject(p.id)
          st().toast({
            title: 'Проект удалён',
            desc: p.name,
            icon: 'trash',
            action: { label: 'Вернуть', run: () => st().restoreProject(copy, i) },
          })
        },
      })
  }
  const exportZip = (p: Project) => {
    menu.close()
    const url = URL.createObjectURL(exportProject(p))
    const a = document.createElement('a')
    a.href = url
    a.download = p.name + '.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    st().toast({
      title: 'Архив готов',
      desc: `${p.name}.zip — файлы, история, чаты и задачи (без ключей)`,
      icon: 'down',
      tone: 'ok',
    })
  }

  return (
    <main className="launcher">
      <div className="lc-top">
        <Wordmark size={34} text={19} />
        <div className="grow" />
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            doImport(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          Импорт архива
        </button>
        <button className="btn" onClick={() => st().openModal({ type: 'newProject', mode: 'open' })}>
          <Icon name="folder" size={14} />
          Открыть папку
        </button>
        <button className="btn" onClick={() => st().openModal({ type: 'newProject', mode: 'clone' })}>
          <Icon name="link" size={14} />
          Клонировать
        </button>
        <button className="btn pri" onClick={() => st().openModal({ type: 'newProject' })}>
          <Icon name="plus" size={15} />
          Новый проект
        </button>
        <button className="lc-me" onClick={prof.open} aria-label="Профиль">
          <Avatar person={people.me} size={34} />
        </button>
      </div>
      <div className="lc-hero fadeup">
        <h1>
          Твои <em>проекты</em>
        </h1>
        <p>Каждый проект — настоящая папка на диске. Открой существующую или создай новую.</p>
      </div>
      <div className="lc-body">
        <InviteCards />
        {working.length > 0 && (
          <section className="lc-live" aria-label="Агенты в работе">
            <div className="lh">
              <span className="pulsedot" />
              <b>Агенты в работе</b>
              <span className="t4">
                {working.length} · в {new Set(working.map((w) => w.p.id)).size}{' '}
                {plural(new Set(working.map((w) => w.p.id)).size, ['проекте', 'проектах', 'проектах'])}
              </span>
            </div>
            <div className="ll-list">
              {working.slice(0, 6).map(({ p, l }) => (
                <LaneRow key={p.id + l.id} p={p} l={l} />
              ))}
            </div>
            {working.length > 6 && (
              <div className="t4 lmore">и ещё {working.length - 6} — открой проект, чтобы увидеть всех</div>
            )}
          </section>
        )}
        <div className="lc-bar">
          <label className="search">
            <Icon name="search" size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.stopPropagation()
                  setQ('')
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  document.querySelector<HTMLElement>('.plist .prow')?.focus()
                }
              }}
              placeholder="Поиск по проектам"
              aria-label="Поиск по проектам"
            />
            {q && (
              <button className="xs" onClick={() => setQ('')} aria-label="Очистить">
                <Icon name="x" size={13} />
              </button>
            )}
          </label>
          <div className="segmini">
            <button className={sort === 'recent' ? 'on' : ''} onClick={() => st().setSort('recent')}>
              <Icon name="clock" size={13} />
              Недавние
            </button>
            <button className={sort === 'name' ? 'on' : ''} onClick={() => st().setSort('name')}>
              <Icon name="sort" size={13} />
              По имени
            </button>
          </div>
          <span className="lc-count">
            {list.length} из {projects.length}
          </span>
        </div>
        <div className="plist">
          {list.map((p, i) => (
            <motion.div
              key={p.id}
              className="prow"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => st().openProject(p.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                const rows = [...document.querySelectorAll<HTMLElement>('.plist .popen')]
                const i = rows.indexOf(e.target as HTMLElement)
                if (i < 0) return
                e.preventDefault()
                rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
              }}
              onContextMenu={(e) => menu.at(e, p)}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                e.currentTarget.style.setProperty('--mx', e.clientX - r.left + 'px')
                e.currentTarget.style.setProperty('--my', e.clientY - r.top + 'px')
              }}
            >
              <span className="glow" />
              <span className="pico">
                <Icon name={p.icon} size={22} />
              </span>
              <div className="pmid">
                <h3 aria-level={2}>
                  <button className="popen" onClick={(e) => (e.stopPropagation(), st().openProject(p.id))}>
                    {p.name}
                  </button>
                  {p.pinned && <Icon name="pin" size={13} className="pinned-ic" />}
                  {p.lanes.length > 0 && (
                    <span
                      className="chip sm live"
                      title={p.lanes.map((l) => `${l.who}: ${l.act}`).join('\n')}
                    >
                      {nAgents(p.lanes.length)}
                    </span>
                  )}
                </h3>
                <div className="path">
                  {p.path || 'путь определится при первом открытии'}
                  {gone.has(p.id) && (
                    <span
                      className="chip sm warn"
                      title="Папка не найдена на диске. «Сменить папку…» в меню проекта"
                    >
                      папки нет на диске
                    </span>
                  )}
                </div>
                <div className="pd">{p.desc}</div>
              </div>
              <div className="pend">
                <span className="when">{ago(p.openedAt)}</span>
                <div className="avstack">
                  {p.members.slice(0, 4).map((m) => (
                    <PersonAv key={m} id={m} size={26} />
                  ))}
                </div>
                <span className="pmeta">
                  {nChats(p.chats.length)} · {nMembers(p.members.length)} · v
                  {p.versions[p.versions.length - 1]?.n ?? 0}
                  {p.tasks.some((t) => t.status !== 'done')
                    ? ` · задач: ${p.tasks.filter((t) => t.status !== 'done').length}`
                    : ''}
                </span>
              </div>
              <button
                className="iconbtn pmore"
                onClick={(e) => {
                  e.stopPropagation()
                  menu.open(e, p)
                }}
                aria-label="Действия с проектом"
              >
                <Icon name="more" size={16} />
              </button>
              <span className="arrow">
                <Icon name="chev" size={18} />
              </span>
            </motion.div>
          ))}
          {!list.length && (
            <div className="lc-empty">
              <Icon name={q ? 'search' : 'folder'} size={22} />
              <b>{q ? 'Ничего не нашлось' : 'Пока нет проектов'}</b>
              <span>
                {q
                  ? `По запросу «${q}» проектов нет.`
                  : 'Создай новый проект или открой папку с кодом — агент будет работать прямо в ней.'}
              </span>
              {q ? (
                <button className="btn sm" onClick={() => setQ('')}>
                  Сбросить поиск
                </button>
              ) : (
                <div className="row-gap">
                  <button className="btn pri sm" onClick={() => st().openModal({ type: 'newProject' })}>
                    <Icon name="plus" size={14} />
                    Новый проект
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => st().openModal({ type: 'newProject', mode: 'open' })}
                  >
                    <Icon name="folder" size={14} />
                    Открыть папку
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <Onboarding />
        <p className="lc-hint">
          Правый клик по проекту — действия · <span className="kbd">{modKey} ,</span> — настройки
        </p>
      </div>
      {menu.st && (
        <Menu anchor={menu.st.anchor} onClose={menu.close} place="bottom-end">
          <MenuItem icon="arrow" label="Открыть" onClick={() => act(menu.st!.data, 'open')} />
          <MenuItem
            icon="pin"
            label={menu.st.data.pinned ? 'Открепить' : 'Закрепить вверху'}
            onClick={() => act(menu.st!.data, 'pin')}
          />
          <MenuItem icon="edit" label="Переименовать" onClick={() => act(menu.st!.data, 'rename')} />
          <MenuItem
            icon="folder"
            label="Показать в проводнике"
            onClick={() => act(menu.st!.data, 'reveal')}
          />
          <MenuItem icon="code" label="Открыть в редакторе" onClick={() => act(menu.st!.data, 'editor')} />
          <MenuItem icon="folder" label="Сменить папку…" onClick={() => act(menu.st!.data, 'folder')} />
          <MenuItem icon="copy" label="Дублировать" onClick={() => act(menu.st!.data, 'dup')} />
          <MenuItem
            icon="down"
            label="Экспорт архивом"
            right=".zip"
            onClick={() => exportZip(menu.st!.data)}
          />
          <MenuSep />
          <MenuItem icon="trash" label="Удалить" danger onClick={() => act(menu.st!.data, 'delete')} />
        </Menu>
      )}
      {prof.st && (
        <Menu anchor={prof.st.anchor} onClose={prof.close} place="bottom-end">
          <div className="ddprof">
            <Avatar person={people.me} size={34} />
            <div>
              <b>{people.me.name}</b>
              <span>{people.me.email}</span>
            </div>
          </div>
          <MenuSep />
          <MenuItem
            icon="user"
            label="Профиль"
            onClick={() => {
              prof.close()
              st().openModal({ type: 'settings', section: 'account' })
            }}
          />
          <MenuItem
            icon="gear"
            label="Настройки"
            right={modKey + ' ,'}
            onClick={() => {
              prof.close()
              st().openModal({ type: 'settings' })
            }}
          />
          <MenuSep />
          <MenuItem
            icon="logout"
            label="Выйти"
            onClick={() => {
              prof.close()
              void logout()
            }}
          />
        </Menu>
      )}
    </main>
  )
}
