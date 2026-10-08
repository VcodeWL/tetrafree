import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLayout } from '../lib/layout'
import { useReturnFocus } from '../hooks/useFocus'
import { addTab, updateTabs } from '../lib/termtabs'
import { opsFor } from '../lib/opstack'
import { hintOf } from '../lib/keymap'
import { useStore, getProject, toast } from '../store'
import { Icon, type IconName } from '../components/ui/Icon'
import { AgentAvatar, PersonAv } from '../components/ui/primitives'
import { AGENTS } from '../data/seed'
import { pipelinesOf, runPipeline } from '../agent/ci'
import { exportProject } from '../lib/projectIO'
import { modKey, slug, uid } from '../lib/util'
import { bReveal } from '../lib/backend'
import { openInEditor, openOsTerminal } from '../lib/editors'
import { DOC_TEMPLATES, buildBlocks } from '../data/docTemplates'
import { exportChat } from '../lib/chatExport'
import { exportBackup } from '../lib/backup'
import { COLS } from '../workspace/TasksView'
import { searchProject } from '../lib/search'
import { AGENT_TEMPLATES, fillTemplate } from '../data/agentTemplates'
import { sendMessage } from '../agent/engine'
import { importMd } from '../lib/mdfiles'
import { scriptsOf } from '../lib/scripts'
import { runInTerminal } from '../lib/termrun'
import { backupNow } from '../lib/autobackup'
import { scanTodos, todoMark } from '../lib/todos'

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  icon?: IconName
  node?: ReactNode
  hint?: string
  run: () => void
}

/* простое нечёткое совпадение: подпоследовательность + бонус за начало слова */
function score(q: string, s: string) {
  if (!q) return 1
  const t = s.toLowerCase()
  q = q.toLowerCase()
  const i = t.indexOf(q)
  if (i >= 0) return 100 - i + (i === 0 || t[i - 1] === ' ' || t[i - 1] === '/' ? 50 : 0)
  let j = 0,
    sc = 0
  for (let k = 0; k < t.length && j < q.length; k++)
    if (t[k] === q[j]) {
      j++
      sc += 1
    }
  return j === q.length ? sc : 0
}

/* недавно открытые файлы (в памяти): в Ctrl+P без запроса показываются первыми */
const recent: string[] = []
useStore.subscribe((s, prev) => {
  const f = s.activeFile
  if (!f || f === prev.activeFile) return
  const i = recent.indexOf(f)
  if (i >= 0) recent.splice(i, 1)
  recent.unshift(f)
  recent.length = Math.min(recent.length, 12)
})

export const openPalette = (prefix = '') =>
  window.dispatchEvent(new CustomEvent('tf:palette', { detail: prefix }))

export function Palette() {
  const open = useStore((s) => s.palette)
  const setOpen = useStore((s) => s.setPalette)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inp = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useReturnFocus(open)

  useEffect(() => {
    const h = (e: Event) => {
      setQ(String((e as CustomEvent).detail || ''))
      setSel(0)
      setOpen(true)
    }
    window.addEventListener('tf:palette', h)
    return () => window.removeEventListener('tf:palette', h)
  }, [setOpen])
  useEffect(() => {
    if (open) setTimeout(() => inp.current?.focus(), 10)
    else setQ('')
  }, [open])

  const items = useMemo(() => (open ? build() : []), [open])
  const prefix = /^[>@#/?*:!]/.test(q) ? q[0] : ''
  const text = (prefix ? q.slice(1) : q).trim()
  const groups: Record<string, string> = {
    '>': 'Команды',
    '@': 'Люди и агенты',
    '#': 'Задачи',
    '/': 'Файлы',
    '?': 'Поиск по содержимому',
    '*': 'Все проекты',
    ':': 'Строка',
    '!': 'TODO в коде',
  }
  const found = useMemo<Item[]>(() => {
    if (open && prefix === ':') {
      const st = useStore.getState()
      const f = st.activeFile
      const n = parseInt(text, 10)
      if (!f || !(f in (getProject()?.files || {}))) return []
      const total = (getProject()!.files[f] || '').split('\n').length
      if (!n || n < 1) return []
      const line = Math.min(n, total)
      return [
        {
          id: 'goto',
          group: 'Строка',
          label: `Перейти к строке ${line}`,
          sub: f + (n > total ? ` · в файле всего ${total}` : ''),
          icon: 'code',
          run: () => window.dispatchEvent(new CustomEvent('tf:goto', { detail: { file: f, line } })),
        },
      ]
    }
    if (open && prefix === '!') {
      const pr = getProject()
      if (!pr) return []
      return scanTodos(pr.files)
        .filter((t) => !text || (t.text + ' ' + t.file).toLowerCase().includes(text.toLowerCase()))
        .map((t): Item => {
          const ex = pr.tasks.find((x) => x.desc.startsWith(todoMark(t)))
          return {
            id: 'todo:' + t.file + ':' + t.line,
            group: 'TODO в коде',
            label: t.text,
            sub: `${t.kind} · ${t.file}:${t.line}`,
            icon: ex ? 'checksq' : 'task',
            hint: ex ? '#' + ex.key + ' · открыть' : '↵ создать задачу',
            run: () => {
              const s = useStore.getState()
              if (ex) {
                s.openModal({ type: 'task', id: ex.id })
                return
              }
              const id = s.saveTask({
                title: t.text.slice(0, 90),
                desc: todoMark(t) + '\n\nСоздано из комментария ' + t.kind,
                status: 'backlog',
                priority: t.kind === 'FIXME' ? 'high' : 'med',
              })
              const key = getProject()?.tasks.find((x) => x.id === id)?.key
              s.toast({
                title: 'Задача создана',
                desc: (key ? '#' + key + ' · ' : '') + t.text.slice(0, 60),
                icon: 'task',
                tone: 'ok',
                action: {
                  label: 'К коду',
                  run: () =>
                    window.dispatchEvent(
                      new CustomEvent('tf:goto', { detail: { file: t.file, line: t.line } }),
                    ),
                },
              })
            },
          }
        })
    }
    if (open && prefix === '*') {
      const all = useStore.getState().projects
      return all.flatMap((pr) =>
        searchProject(pr, text, 12).map((h): Item => ({
          id: pr.id + ':' + h.id,
          group: pr.name,
          label: h.label,
          sub: h.group + (h.sub ? ' · ' + h.sub : ''),
          icon:
            h.group === 'Код'
              ? 'code'
              : h.group === 'Документы'
                ? 'doc'
                : h.group === 'Задачи'
                  ? 'task'
                  : h.group === 'Чаты'
                    ? 'chat'
                    : 'bolt',
          run: () => {
            const st = useStore.getState()
            if (st.projectId !== pr.id || st.screen !== 'workspace') st.openProject(pr.id)
            setTimeout(h.run, 350)
          },
        })),
      )
    }
    const p = open && prefix === '?' ? getProject() : null
    if (!p) return []
    return searchProject(p, text).map((h) => ({
      id: h.id,
      group: h.group,
      label: h.label,
      sub: h.sub,
      icon:
        h.group === 'Код'
          ? 'code'
          : h.group === 'Документы'
            ? 'doc'
            : h.group === 'Задачи'
              ? 'task'
              : h.group === 'Чаты'
                ? 'chat'
                : 'bolt',
      run: h.run,
    }))
  }, [open, prefix, text])
  const res = useMemo(() => {
    if (prefix === '?' || prefix === '*' || prefix === ':' || prefix === '!') return found
    const pool = prefix ? items.filter((i) => i.group === groups[prefix]) : items
    return pool
      .map((i) => ({ i, s: Math.max(score(text, i.label), score(text, i.sub || '') * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (text ? b.s - a.s : 0))
      .slice(0, text ? 40 : 60)
      .map((x) => x.i)
    // groups — неизменяемый литерал, в зависимости не нужен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, prefix, text, found])
  const ordered = useMemo(() => {
    const order = ['Команды', 'Проекты', 'Чаты', 'Документы', 'Задачи', 'Файлы', 'Люди и агенты']
    if (prefix === '?' || prefix === '*' || prefix === ':' || prefix === '!') return res
    if (text) {
      const gs: string[] = []
      res.forEach((r) => {
        if (!gs.includes(r.group)) gs.push(r.group)
      })
      return gs.flatMap((g) => res.filter((r) => r.group === g))
    }
    return order.flatMap((g) =>
      res.filter((r) => r.group === g).slice(0, prefix ? 60 : g === 'Команды' ? 8 : 5),
    )
  }, [res, text, prefix])
  useEffect(() => {
    setSel(0)
  }, [q])
  useEffect(() => {
    list.current?.querySelector('.pi2.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null
  const go = (i?: Item) => {
    if (!i) return
    setOpen(false)
    setTimeout(i.run, 0)
  }
  let last = ''
  return (
    <div className="pal-wrap open" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pal" role="dialog" aria-label="Палитра команд">
        <div className="pal-in">
          <Icon name="search" size={17} />
          <input
            ref={inp}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Команды, чаты, файлы…   > команды · @ люди · # задачи · / файлы · ? текст везде · * все проекты · : строка · ! TODO"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(ordered.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                go(ordered[sel])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              } else if (e.key === 'Backspace' && q.length === 1 && prefix) setQ('')
            }}
          />
          {prefix && <span className="chip sm">{groups[prefix]}</span>}
        </div>
        <div className="pal-res" ref={list}>
          {ordered.map((it, idx) => {
            const head =
              it.group !== last ? (
                <div className="pg" key={'g' + it.group}>
                  {it.group}
                </div>
              ) : null
            last = it.group
            return [
              head,
              <div
                key={it.id}
                className={'pi2' + (idx === sel ? ' sel' : '')}
                onMouseMove={() => sel !== idx && setSel(idx)}
                onClick={() => go(it)}
              >
                {it.node || <Icon name={it.icon || 'dot'} size={15} />}
                <span className="pl">
                  {it.label}
                  {it.sub && <span className="psub">{it.sub}</span>}
                </span>
                {it.hint && <span className="r">{it.hint}</span>}
              </div>,
            ]
          })}
          {!ordered.length && (
            <div className="pal-empty">
              {prefix === '!' ? (
                'В коде нет комментариев TODO или FIXME'
              ) : prefix === ':' ? (
                'Открой файл и введи номер строки, например :42'
              ) : (prefix === '?' || prefix === '*') && text.length < 2 ? (
                'Введи хотя бы 2 символа — поищу в коде, документах, задачах, чатах и памяти'
              ) : (
                <>Ничего не нашлось{text && <> по «{text}»</>}</>
              )}
            </div>
          )}
        </div>
        <div className="pal-foot">
          <span>↑↓ выбор</span>
          <span>↵ открыть</span>
          <span>esc закрыть</span>
          <span className="grow" />
          <span>{modKey}+K</span>
        </div>
      </div>
    </div>
  )
}

function build(): Item[] {
  const st = useStore.getState
  const s = st()
  const p = getProject()
  const out: Item[] = []
  const hk = (id: string) => hintOf(id, modKey, st().settings.keys)
  const cmd = (id: string, label: string, icon: IconName, run: () => void, hint?: string, sub?: string) =>
    out.push({ id: 'c:' + id, group: 'Команды', label, icon, run, hint, sub })
  if (s.screen !== 'workspace' || !p) {
    cmd('np', 'Новый проект', 'plus', () => st().openModal({ type: 'newProject' }))
    if (st().projectId) {
      const pid = st().projectId!
      cmd('rv', 'Показать папку проекта в проводнике', 'folder', () => {
        const pr = st().projects.find((x) => x.id === pid)
        if (pr)
          void bReveal(pr).catch(() =>
            st().toast({ title: 'Нужен сервер TetraFree', icon: 'warn', tone: 'warn' }),
          )
      })
      cmd('ed', 'Открыть проект во внешнем редакторе', 'code', () => void openInEditor(pid))
      cmd('pf', 'Сменить папку проекта', 'folder', () => st().openModal({ type: 'projectFolder', id: pid }))
    }
    cmd('op', 'Открыть папку как проект', 'folder', () =>
      st().openModal({ type: 'newProject', mode: 'open' }),
    )
    cmd('cl', 'Клонировать репозиторий как проект', 'link', () =>
      st().openModal({ type: 'newProject', mode: 'clone' }),
    )
    cmd('set', 'Настройки', 'gear', () => st().openModal({ type: 'settings' }), hk('settings'))
    cmd('hk', 'Горячие клавиши', 'keyboard', () => st().openModal({ type: 'shortcuts' }))
    s.projects.forEach((x) =>
      out.push({
        id: 'p:' + x.id,
        group: 'Проекты',
        label: x.name,
        sub: x.path,
        icon: x.icon,
        run: () => st().openProject(x.id),
      }),
    )
    return out
  }
  if (s.center.kind === 'chat') {
    const c = p.chats.find((x) => x.id === (s.center as { id: string }).id)
    if (c)
      cmd('xchat', 'Экспортировать чат в Markdown', 'down', () => {
        exportChat(c)
        st().toast({ title: 'Чат сохранён', desc: slug(c.title) + '.md', icon: 'down' })
      })
  }
  cmd('chat', 'Новый чат', 'chat', () => st().openModal({ type: 'newChat' }), hk('newchat'))
  cmd('task', 'Новая задача', 'task', () => st().openModal({ type: 'task' }), hk('newtask'))
  cmd('doc', 'Новый документ', 'doc', () => st().createDoc())
  DOC_TEMPLATES.forEach((t) =>
    cmd(
      'doc-' + t.k,
      'Новый документ: ' + t.title,
      'doc',
      () => {
        const id = st().createDoc()
        st().updateDoc(id, { title: t.title, blocks: buildBlocks(t.k) })
      },
      undefined,
      t.hint,
    ),
  )
  cmd('tasks', 'Открыть задачи', 'board', () => st().setCenter({ kind: 'tasks' }))
  cmd('term', 'Терминал', 'terminal', () => st().setDock(!st().dock), hk('term'))
  pipelinesOf(p.files).forEach((d) =>
    cmd(
      'run-' + d.name,
      `Запустить пайплайн ${d.name}`,
      d.name === 'release' ? 'rocket' : 'play',
      () => {
        runPipeline(d.name)
        st().openModal({ type: 'deploy' })
      },
      d.name === 'release' ? modKey + ' ⇧ R' : undefined,
      d.file,
    ),
  )
  cmd('ver', 'История версий', 'clock', () => st().openModal({ type: 'versions' }))
  cmd('act', 'Активность агентов и память', 'bolt', () => st().openModal({ type: 'activity' }))
  cmd('dep', 'Деплой', 'rocket', () => st().openModal({ type: 'deploy' }))
  cmd('brz', 'Открыть превью в браузере', 'browser', () =>
    st().setRight({ rightOpen: true, rightTab: 'browser' }),
  )
  cmd('edp', 'Открыть проект во внешнем редакторе', 'code', () => void openInEditor(p.id))
  cmd('ost', 'Открыть терминал системы в папке проекта', 'terminal', () => void openOsTerminal(p.id))
  if (s.activeFile && p.files[s.activeFile] !== undefined) {
    const af = s.activeFile
    cmd(
      'edf',
      'Открыть файл во внешнем редакторе: ' + af.split('/').pop(),
      'code',
      () => void openInEditor(p.id, { file: af }),
    )
  }
  AGENT_TEMPLATES.forEach((t) =>
    cmd(
      'tpl-' + t.id,
      'Агенту: ' + t.title,
      'sparkle',
      () => {
        const file = st().activeFile && p.files[st().activeFile!] !== undefined ? st().activeFile : null
        if (t.needsFile && !file) {
          toast({
            title: 'Сначала открой файл',
            desc: 'Шаблон «' + t.title + '» работает с открытым файлом',
            icon: 'warn',
            tone: 'warn',
          })
          return
        }
        const ctr = st().center
        let cid: string | null = ctr.kind === 'chat' ? ctr.id : null
        if (!cid) {
          cid = st().createChat({
            title: t.title + (file ? ': ' + file.split('/').pop() : ''),
            creator: { kind: 'human', id: 'me' },
            agents: [{ name: 'builder', tier: 'Спросить', sub: [] }],
          })
          st().setCenter({ kind: 'chat', id: cid })
        }
        sendMessage(cid, fillTemplate(t, file))
      },
      undefined,
      t.hint,
    ),
  )
  cmd('cmp', 'Сравнить два файла', 'layers', () =>
    st().openModal({ type: 'compare', a: st().activeFile || undefined }),
  )
  {
    const proj = st().projects.find((x) => x.id === st().projectId)
    if (proj)
      for (const sc of scriptsOf(proj.files))
        cmd(
          'npm:' + sc.name,
          'Запустить: ' + sc.cmd,
          'terminal',
          () => runInTerminal(sc.cmd),
          undefined,
          sc.body.slice(0, 70),
        )
  }
  cmd('mdi', 'Импорт .md файлов в документы', 'doc', () => importMd(false))
  cmd('mdd', 'Импорт папки с .md в документы', 'doc', () => importMd(true))
  if (st().activeFile && st().rightTab === 'code') {
    cmd('foldall', 'Код: свернуть все блоки', 'code', () =>
      window.dispatchEvent(new CustomEvent('tf:fold', { detail: { all: true } })),
    )
    cmd('unfold', 'Код: развернуть все блоки', 'code', () =>
      window.dispatchEvent(new CustomEvent('tf:fold', { detail: { all: false } })),
    )
  }
  if (st().activeFile) {
    const af = st().activeFile!
    cmd('blame', 'Кто менял: ' + af.split('/').pop(), 'git', () =>
      st().openModal({ type: 'blame', path: af }),
    )
  }
  {
    const ops = opsFor(p.id)
    const run = (kind: 'undo' | 'redo') => () => {
      try {
        const op = ops[kind]()
        st().toast({
          title: (kind === 'undo' ? 'Отменено: ' : 'Повторено: ') + (op?.label ?? '—'),
          icon: kind,
        })
      } catch (e) {
        st().toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'err' })
      }
    }
    if (ops.canUndo) cmd('fundo', 'Отменить файловую операцию', 'undo', run('undo'), undefined, ops.nextUndo)
    if (ops.canRedo) cmd('fredo', 'Повторить файловую операцию', 'redo', run('redo'), undefined, ops.nextRedo)
  }
  cmd('newterm', 'Терминал: новая вкладка', 'terminal', () => {
    const s = st()
    if (s.mode === 'design') s.setMode('dev')
    s.setDock(true)
    updateTabs(p.id, addTab)
  })
  cmd(
    'minimap',
    useLayout.getState().minimap ? 'Мини-карта кода: скрыть' : 'Мини-карта кода: показать',
    'code',
    () => useLayout.getState().setMinimap(!useLayout.getState().minimap),
  )
  cmd('layoutreset', 'Сбросить раскладку панелей', 'gear', () => {
    useLayout.getState().reset()
    st().setRightWidth(45)
    localStorage.removeItem('tf.treeW')
    st().toast({
      title: 'Раскладка сброшена',
      desc: 'Дерево файлов обновится при следующем открытии проекта',
      icon: 'gear',
      tone: 'ok',
    })
  })
  cmd('trash', 'Корзина: вернуть удалённые файлы', 'trash', () => st().openModal({ type: 'trash' }))
  cmd('bkp', 'Резервная копия на диск сейчас', 'down', () => {
    void backupNow().catch((e) =>
      toast({ title: 'Не удалось сделать копию', desc: (e as Error).message, icon: 'warn', tone: 'warn' }),
    )
  })
  cmd(
    'today',
    'Сегодня: что горит и что ждёт',
    'target',
    () => st().openModal({ type: 'today' }),
    hk('today'),
  )
  cmd(
    'repl',
    'Найти и заменить в проекте',
    'search',
    () => st().openModal({ type: 'replace' }),
    hk('replace'),
  )
  cmd('todo', 'TODO из кода → задачи', 'task', () => openPalette('!'))
  cmd('remote', 'Git: удалённый репозиторий и зеркало', 'link', () => st().openModal({ type: 'remote' }))
  cmd('git', 'Открыть Git', 'git', () => st().setRight({ rightOpen: true, rightTab: 'git' }), hk('git'))
  cmd('code', 'Показать код', 'code', () => st().setRight({ rightOpen: true, rightTab: 'code' }))
  cmd(
    'design',
    s.mode === 'design' ? 'Режим разработки' : 'Режим дизайна',
    s.mode === 'design' ? 'code' : 'pen',
    () => st().setMode(s.mode === 'design' ? 'dev' : 'design'),
    modKey + ' ⇧ D',
  )
  cmd('exp', 'Экспорт проекта в архив', 'down', () => {
    const url = URL.createObjectURL(exportProject(p))
    const a = document.createElement('a')
    a.href = url
    a.download = p.name + '.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast({
      title: 'Архив готов',
      desc: p.name + '.zip — файлы, доки, задачи и история',
      icon: 'down',
      tone: 'ok',
    })
  })
  cmd('inv', 'Пригласить участника', 'userplus', () =>
    st().openModal({ type: 'settings', section: 'members' }),
  )
  cmd('usage', 'Расходы и лимит', 'bolt', () => st().openModal({ type: 'settings', section: 'usage' }))
  cmd('prov', 'Провайдеры и ключи', 'key', () => st().openModal({ type: 'settings', section: 'providers' }))
  cmd('set', 'Настройки', 'gear', () => st().openModal({ type: 'settings' }), hk('settings'))
  cmd('side', 'Показать / скрыть сайдбар', 'sidebar', () => st().setSideHidden(!st().sideHidden), hk('side'))
  cmd('sw', 'Сменить проект', 'folder', () => st().toLauncher(), hk('project'))
  cmd('hk', 'Горячие клавиши', 'keyboard', () => st().openModal({ type: 'shortcuts' }), hk('shortcuts'))
  cmd(
    'theme',
    document.documentElement.classList.contains('light') ? 'Включить тёмную тему' : 'Включить светлую тему',
    'gear',
    () => st().setSetting('theme', document.documentElement.classList.contains('light') ? 'dark' : 'light'),
  )
  cmd(
    'dens',
    s.settings.density === 'compact' ? 'Плотность: комфортная' : 'Плотность: компактная',
    'gear',
    () => st().setSetting('density', s.settings.density === 'compact' ? 'comfortable' : 'compact'),
  )
  cmd('bak', 'Сохранить резервную копию', 'down', () => {
    const n = exportBackup()
    toast({ title: 'Копия сохранена', desc: `проектов: ${n}`, icon: 'down' })
  })
  if (s.center.kind === 'doc') {
    const d = p.docs.find((x) => x.id === (s.center as { id: string }).id)
    if (d)
      cmd('ddup', 'Дублировать документ', 'doc', () => {
        const id = st().createDoc()
        st().updateDoc(id, {
          title: d.title + ' (копия)',
          blocks: d.blocks.map((b) => ({ ...b, id: uid('b') })),
        })
        toast({ title: 'Документ продублирован', icon: 'doc' })
      })
  }
  cmd('wn', 'Что нового', 'sparkle', () => st().openModal({ type: 'settings', section: 'about' }))

  p.chats.forEach((c) =>
    out.push({
      id: 'ch:' + c.id,
      group: 'Чаты',
      label: c.title,
      sub: c.agents.map((a) => a.name).join(', '),
      icon: 'chat',
      run: () => st().setCenter({ kind: 'chat', id: c.id }),
    }),
  )
  p.docs.forEach((d) =>
    out.push({
      id: 'd:' + d.id,
      group: 'Документы',
      label: d.title,
      icon: 'doc',
      run: () => st().setCenter({ kind: 'doc', id: d.id }),
    }),
  )
  p.tasks.forEach((t) =>
    out.push({
      id: 't:' + t.id,
      group: 'Задачи',
      label: t.title,
      sub: COLS.find((c) => c.k === t.status)?.t,
      icon: t.status === 'done' ? 'checksq' : 'task',
      hint: '#' + t.key,
      run: () => st().openModal({ type: 'task', id: t.id }),
    }),
  )
  Object.keys(p.files)
    .sort((a, b) => {
      const ra = recent.indexOf(a),
        rb = recent.indexOf(b)
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b)
    })
    .forEach((f) =>
      out.push({
        id: 'f:' + f,
        group: 'Файлы',
        label: f.split('/').pop()!,
        sub: f,
        icon: 'file',
        run: () => st().openFile(f),
      }),
    )
  const chatId = s.center.kind === 'chat' ? s.center.id : null
  p.members.forEach((m) => {
    const x = s.people[m]
    if (x)
      out.push({
        id: 'u:' + m,
        group: 'Люди и агенты',
        label: x.name,
        sub: [x.role, x.pending ? 'приглашён' : x.status === 'online' ? 'в сети' : '']
          .filter(Boolean)
          .join(' · '),
        node: <PersonAv id={m} size={18} round />,
        run: () => st().openModal({ type: 'settings', section: 'members' }),
      })
  })
  Object.values(AGENTS).forEach((a) =>
    out.push({
      id: 'a:' + a.name,
      group: 'Люди и агенты',
      label: '@' + a.name,
      sub: a.role,
      node: <AgentAvatar name={a.name} size={18} />,
      hint: chatId ? 'упомянуть' : undefined,
      run: () => {
        if (chatId)
          window.dispatchEvent(
            new CustomEvent('tf:compose', { detail: { chatId, text: '@' + a.name + ' ' } }),
          )
        else {
          const id = st().createChat({
            title: 'Чат с ' + a.name,
            creator: { kind: 'human', id: 'me' },
            agents: [{ name: a.name, tier: 'Спросить', sub: [] }],
          })
          st().setCenter({ kind: 'chat', id })
        }
      },
    }),
  )
  return out
}
