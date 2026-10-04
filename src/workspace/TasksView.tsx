import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY,
  isEmpty as isEmptyF,
  same as sameF,
  describe as describeF,
  type TaskFilter,
} from '../lib/taskviews'
import { useStore, useProject, actorName, getProject } from '../store'
import { openBlockers, REPEAT_LABEL } from '../lib/taskrel'
import type { Task, TaskStatus } from '../types'
import { Icon } from '../components/ui/Icon'
import { ActorAv } from '../components/ui/primitives'
import { modKey, nTasks, localDay, plural } from '../lib/util'
import { Menu, MenuHead, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { AGENTS } from '../data/seed'
import type { Actor } from '../types'

export const COLS: { k: TaskStatus; t: string; c: string }[] = [
  { k: 'backlog', t: 'Бэклог', c: '#6a6a74' },
  { k: 'doing', t: 'В работе', c: '#8fa6ff' },
  { k: 'review', t: 'Ревью', c: '#b78fff' },
  { k: 'done', t: 'Готово', c: '#8fe6c0' },
]
export const PRIO: Record<Task['priority'], string> = { low: 'низкий', med: 'средний', high: 'высокий' }
const fmtDay = (iso?: string) =>
  iso ? new Date(iso + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''
const today = () => localDay()
/* срок человеческим языком: сегодня / завтра / просрочено на N дн. / дата */
export function dueText(t: Task) {
  if (!t.due) return ''
  const d = Math.round(
    (new Date(t.due + 'T00:00').getTime() - new Date(today() + 'T00:00').getTime()) / 86400000,
  )
  if (t.status === 'done') return fmtDay(t.due)
  if (d === 0) return 'сегодня'
  if (d === 1) return 'завтра'
  if (d < 0) return `просрочено ${-d} дн`
  return d <= 6 ? `через ${d} дн` : fmtDay(t.due)
}
const soon = (t: Task) =>
  t.status !== 'done' &&
  !!t.due &&
  t.due >= today() &&
  dueText(t) !== fmtDay(t.due) &&
  (dueText(t) === 'сегодня' || dueText(t) === 'завтра')
const overdue = (t: Task) => t.status !== 'done' && !!t.due && t.due < today()

export function TasksView() {
  const p = useProject()!
  const view = useStore((s) => s.taskView)
  const st = useStore.getState
  const [filter, setFilter] = useState<'all' | 'me' | 'agents'>('all')
  const [q, setQ] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const [onlyLate, setOnlyLate] = useState(false)
  const allLabels = useMemo(() => [...new Set(p.tasks.flatMap((t) => t.labels || []))].sort(), [p.tasks])
  useEffect(() => {
    if (label && !allLabels.includes(label)) setLabel(null)
  }, [allLabels, label])
  const tasks = useMemo(
    () =>
      p.tasks.filter(
        (t) =>
          (!onlyLate || overdue(t)) &&
          (filter === 'all' ||
            (filter === 'me'
              ? t.assignee?.kind === 'human' && t.assignee.id === 'me'
              : t.assignee?.kind === 'agent')) &&
          (!label || !!t.labels?.includes(label)) &&
          (!q ||
            (t.title + ' T-' + t.key + ' ' + (t.labels || []).join(' '))
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [p.tasks, filter, q, label, onlyLate],
  )
  const [sel, setSel] = useState<string[]>([])
  const vm = useMenu()
  const cur: TaskFilter = { who: filter, q, label, late: onlyLate }
  const curView = (p.taskViews || []).find((v) => sameF(v.f, cur))
  const applyF = (f: TaskFilter) => {
    setFilter(f.who)
    setQ(f.q)
    setLabel(f.label)
    setOnlyLate(f.late)
  }
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]))
  useEffect(() => {
    setSel((x) => {
      const n = x.filter((id) => p.tasks.some((t) => t.id === id))
      return n.length === x.length ? x : n
    })
  }, [p.tasks])
  useEffect(() => {
    setSel([])
  }, [p.id])
  useEffect(() => {
    if (!sel.length) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useStore.getState().modal && !useStore.getState().palette) setSel([])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel.length])
  const done = p.tasks.filter((t) => t.status === 'done').length
  const pct = p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0
  const late = p.tasks.filter(overdue).length
  return (
    <div className="tboard">
      <div className="tsummary">
        <div className="tstat">
          <span className="tn">{p.tasks.length}</span>
          <span className="tk">всего</span>
        </div>
        <span className="tsvr" />
        <div className="tstat">
          <span className="tn">{p.tasks.filter((t) => t.status === 'doing').length}</span>
          <span className="tk">в работе</span>
        </div>
        <span className="tsvr" />
        <div className="tstat">
          <span className="tn">
            {p.tasks.filter((t) => t.assignee?.kind === 'agent' && t.status !== 'done').length}
          </span>
          <span className="tk">у агентов</span>
        </div>
        <span className="tsvr" />
        <button
          className={'tstat tstat-b' + (onlyLate ? ' on' : '')}
          disabled={!late && !onlyLate}
          aria-pressed={onlyLate}
          title={onlyLate ? 'Показать все задачи' : 'Показать только просроченные'}
          onClick={() => setOnlyLate(!onlyLate)}
        >
          <span className={'tn' + (late ? ' bad' : '')}>{late}</span>
          <span className="tk">просрочено</span>
        </button>
        <div className="tprog">
          <div className="tpbar">
            <span style={{ width: pct + '%' }} />
          </div>
          <div className="tpk">
            {done} / {p.tasks.length} · {pct}%
          </div>
        </div>
      </div>
      <div className="tviewbar">
        {(
          [
            ['board', 'Доска', 'board'],
            ['list', 'Список', 'list'],
            ['timeline', 'Таймлайн', 'calendar'],
          ] as const
        ).map(([k, t, i]) => (
          <button key={k} className={'tv' + (view === k ? ' on' : '')} onClick={() => st().setTaskView(k)}>
            <Icon name={i} size={14} />
            {t}
          </button>
        ))}
        <span className="tvsep" />
        {(
          [
            ['all', 'Все'],
            ['me', 'Мои'],
            ['agents', 'Агенты'],
          ] as const
        ).map(([k, t]) => (
          <button key={k} className={'tv sm' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>
            {t}
          </button>
        ))}
        <span className="grow" />
        <button
          className={'tv sm' + (curView ? ' on' : '')}
          onClick={(e) => vm.open(e)}
          aria-haspopup="menu"
          title="Сохранённые виды"
        >
          <Icon name="list" size={13} />
          {curView ? curView.name : 'Виды'}
        </button>
        <label className="tsearch">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фильтр" />
        </label>
        <button
          className="btn pri sm"
          onClick={() => st().openModal({ type: 'task' })}
          title={`${modKey}+Shift+T`}
        >
          <Icon name="plus" size={14} />
          Задача
        </button>
      </div>
      {vm.st && (
        <Menu anchor={vm.st.anchor} onClose={vm.close} place="bottom-end" width={290}>
          <MenuHead>Виды</MenuHead>
          <MenuItem
            icon="list"
            label="Все задачи"
            sel={isEmptyF(cur)}
            onClick={() => {
              vm.close()
              applyF(EMPTY)
            }}
          />
          {(p.taskViews || []).map((v) => (
            <MenuItem
              key={v.id}
              icon="list"
              label={v.name}
              right={
                <span className="t4" style={{ fontSize: 11 }}>
                  {describeF(v.f)}
                </span>
              }
              sel={curView?.id === v.id}
              onClick={() => {
                vm.close()
                applyF(v.f)
              }}
            />
          ))}
          <MenuSep />
          <MenuItem
            icon="plus"
            label="Сохранить текущий фильтр…"
            disabled={isEmptyF(cur) || !!curView}
            onClick={() => {
              vm.close()
              const f = cur
              st().openModal({
                type: 'rename',
                title: 'Сохранить вид',
                label: 'Название',
                value: '',
                hint: describeF(f),
                run: (n) => {
                  if (n.trim()) {
                    st().saveTaskView(n, f)
                    st().toast({ title: 'Вид сохранён', desc: n.trim(), icon: 'check', tone: 'ok' })
                  }
                },
                check: (n) => (n.trim() ? null : 'Введи название'),
              })
            }}
          />
          {curView && (
            <MenuItem
              icon="trash"
              danger
              label={`Удалить «${curView.name}»`}
              onClick={() => {
                vm.close()
                st().removeTaskView(curView.id)
              }}
            />
          )}
        </Menu>
      )}
      {allLabels.length > 0 && (
        <div className="tlabels" role="group" aria-label="Метки">
          <span className="t4">Метки</span>
          {allLabels.map((l) => (
            <button
              key={l}
              className={'tlabel btn-l' + (label === l ? ' on' : '')}
              aria-pressed={label === l}
              onClick={() => setLabel(label === l ? null : l)}
            >
              {l}
            </button>
          ))}
          {label && (
            <button className="linkbtn" onClick={() => setLabel(null)}>
              Сбросить
            </button>
          )}
        </div>
      )}
      {!p.tasks.length && (
        <div className="tempty-hero">
          <Icon name="task" size={20} />
          <div>
            <b>Задач пока нет</b>
            <p>Заведи первую вручную или опиши цель в чате — агент разобьёт её на задачи сам.</p>
          </div>
          <button className="btn pri sm" onClick={() => st().openModal({ type: 'task' })}>
            <Icon name="plus" size={14} />
            Новая задача
          </button>
        </div>
      )}
      {view === 'board' ? (
        <Board tasks={tasks} sel={sel} toggle={toggle} />
      ) : view === 'list' ? (
        <List tasks={tasks} sel={sel} toggle={toggle} />
      ) : (
        <Timeline tasks={tasks} />
      )}
      {sel.length > 0 && view !== 'timeline' && (
        <BulkBar ids={sel} all={tasks.map((t) => t.id)} setSel={setSel} />
      )}
    </div>
  )
}

const picks = (e: React.MouseEvent, n: number) => e.ctrlKey || e.metaKey || e.shiftKey || n > 0

function Card({
  t,
  onDragStart,
  selected,
  nSel,
  toggle,
}: {
  t: Task
  onDragStart: (e: React.DragEvent) => void
  selected: boolean
  nSel: number
  toggle: () => void
}) {
  const st = useStore.getState
  return (
    <div
      className={'tcard p-' + t.priority + (selected ? ' sel' : '')}
      draggable
      onDragStart={onDragStart}
      aria-pressed={selected}
      onClick={(e) => {
        if (picks(e, nSel)) toggle()
        else st().openModal({ type: 'task', id: t.id })
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') st().openModal({ type: 'task', id: t.id })
        else if (e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
    >
      <div className="tkey">
        T-{t.key}
        {t.priority === 'high' && <span className="prio hi">высокий</span>}
      </div>
      <div className="tt">{t.title}</div>
      {(!!t.labels?.length ||
        !!t.subtasks?.length ||
        !!t.comments?.length ||
        !!t.blockedBy?.length ||
        !!t.repeat) && (
        <div className="tmeta">
          {t.labels?.slice(0, 3).map((l) => (
            <span key={l} className="tlabel">
              {l}
            </span>
          ))}
          {!!t.subtasks?.length && (
            <span className={'tsub' + (t.subtasks.every((x) => x.done) ? ' ok' : '')} title="Подзадачи">
              <Icon name="check" size={11} />
              {t.subtasks.filter((x) => x.done).length}/{t.subtasks.length}
            </span>
          )}
          {(() => {
            const b = openBlockers(t, getProject()?.tasks || [])
            return b.length ? (
              <span
                className="tsub blk"
                title={'Ждёт: ' + b.map((x) => 'T-' + x.key + ' ' + x.title).join(', ')}
              >
                <Icon name="lock" size={11} />
                {b.length}
              </span>
            ) : null
          })()}
          {t.repeat && (
            <span className="tsub" title={REPEAT_LABEL[t.repeat]}>
              <Icon name="refresh" size={11} />
            </span>
          )}
          {!!t.comments?.length && (
            <span className="tsub" title="Комментарии">
              <Icon name="chat" size={11} />
              {t.comments.length}
            </span>
          )}
        </div>
      )}
      <div className="tb">
        <ActorAv actor={t.assignee} size={22} />
        <span className="t4 tas" title={t.assignee ? actorName(t.assignee) : undefined}>
          {t.assignee ? actorName(t.assignee) : 'Свободна'}
        </span>
        {t.due && (
          <span className={'tdue' + (overdue(t) ? ' late' : soon(t) ? ' soon' : '')} title={fmtDay(t.due)}>
            <Icon name="clock" size={11} />
            {dueText(t)}
          </span>
        )}
      </div>
    </div>
  )
}

function Board({ tasks, sel, toggle }: { tasks: Task[]; sel: string[]; toggle: (id: string) => void }) {
  const st = useStore.getState
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ col: TaskStatus; before: string | null } | null>(null)
  const [adding, setAdding] = useState<TaskStatus | null>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const [colsEnd, setColsEnd] = useState(false)
  useEffect(() => {
    const el = colsRef.current
    if (!el) return
    const f = () => setColsEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [title, setTitle] = useState('')
  const drop = () => {
    if (drag && over && over.before !== drag) st().moveTask(drag, over.col, over.before)
    setDrag(null)
    setOver(null)
  }
  return (
    <div
      className={'cols' + (colsEnd ? ' end' : '')}
      ref={colsRef}
      onScroll={(e) => {
        const t = e.currentTarget
        setColsEnd(t.scrollLeft + t.clientWidth >= t.scrollWidth - 4)
      }}
    >
      {COLS.map((c) => {
        const list = tasks.filter((t) => t.status === c.k)
        return (
          <div
            key={c.k}
            className={'tcol' + (over?.col === c.k ? ' dropping' : '')}
            onDragOver={(e) => {
              e.preventDefault()
              if (!over || over.col !== c.k) setOver({ col: c.k, before: null })
            }}
            onDrop={drop}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
            }}
          >
            <div className="th">
              <span className="cdot" style={{ background: c.c }} />
              {c.t}
              <span className="count">{list.length}</span>
            </div>
            {list.map((t) => (
              <div
                key={t.id}
                className={
                  'tslot' + (over?.before === t.id ? ' before' : '') + (drag === t.id ? ' dragging' : '')
                }
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  const below = e.clientY > r.top + r.height / 2
                  const idx = list.indexOf(t)
                  const before = below ? (list[idx + 1]?.id ?? null) : t.id
                  if (over?.before !== before || over?.col !== c.k) setOver({ col: c.k, before })
                }}
              >
                <Card
                  t={t}
                  selected={sel.includes(t.id)}
                  nSel={sel.length}
                  toggle={() => toggle(t.id)}
                  onDragStart={(e) => {
                    setDrag(t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', t.id)
                  }}
                />
              </div>
            ))}
            {over?.col === c.k && over.before === null && drag && <div className="tghost" />}
            {adding === c.k ? (
              <form
                className="tadd"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (title.trim()) st().saveTask({ title: title.trim(), status: c.k })
                  setTitle('')
                }}
              >
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название задачи"
                  onBlur={() => {
                    if (!title.trim()) setAdding(null)
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                />
                <span className="t4">Enter — добавить · Esc — закрыть</span>
              </form>
            ) : (
              <button
                className="taddc"
                onClick={() => {
                  setAdding(c.k)
                  setTitle('')
                }}
              >
                <Icon name="plus" size={13} />
                Добавить
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function List({ tasks, sel, toggle }: { tasks: Task[]; sel: string[]; toggle: (id: string) => void }) {
  const st = useStore.getState
  return (
    <div className="tlist">
      {COLS.map((c) => {
        const rank = { high: 0, med: 1, low: 2 } as const
        const list = tasks
          .filter((t) => t.status === c.k)
          .sort(
            (a, b) => rank[a.priority] - rank[b.priority] || (a.due || '9999').localeCompare(b.due || '9999'),
          )
        if (!list.length) return null
        return (
          <div key={c.k} className="tlgroup">
            <div className="tlg-h">
              <span className="cdot" style={{ background: c.c }} />
              {c.t}
              <span className="t4">{nTasks(list.length)}</span>
            </div>
            {list.map((t) => (
              <div
                key={t.id}
                className={'tli' + (t.status === 'done' ? ' done' : '') + (sel.includes(t.id) ? ' sel' : '')}
                role="button"
                tabIndex={0}
                aria-pressed={sel.includes(t.id)}
                onClick={(e) => {
                  if (picks(e, sel.length)) toggle(t.id)
                  else st().openModal({ type: 'task', id: t.id })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') st().openModal({ type: 'task', id: t.id })
                  else if (e.key === ' ' && e.target === e.currentTarget) {
                    e.preventDefault()
                    toggle(t.id)
                  }
                }}
              >
                <span
                  className={'cbx' + (t.status === 'done' ? ' done' : '')}
                  role="checkbox"
                  aria-checked={t.status === 'done'}
                  onClick={(e) => {
                    e.stopPropagation()
                    st().moveTask(t.id, t.status === 'done' ? 'doing' : 'done')
                  }}
                >
                  {t.status === 'done' && (
                    <Icon name="check" size={13} stroke={2.6} style={{ color: '#0b0b10' }} />
                  )}
                </span>
                <span className="tkey mono">T-{t.key}</span>
                <span className="tlt">{t.title}</span>
                {t.labels?.slice(0, 2).map((l) => (
                  <span key={l} className="tlabel">
                    {l}
                  </span>
                ))}
                {(() => {
                  const b = openBlockers(t, getProject()?.tasks || [])
                  return b.length ? (
                    <span
                      className="tsub blk"
                      title={'Ждёт: ' + b.map((x) => 'T-' + x.key + ' ' + x.title).join(', ')}
                    >
                      <Icon name="lock" size={11} />
                      {b.length}
                    </span>
                  ) : null
                })()}
                {t.repeat && (
                  <span className="tsub" title={REPEAT_LABEL[t.repeat]}>
                    <Icon name="refresh" size={11} />
                  </span>
                )}
                {!!t.subtasks?.length && (
                  <span className="tsub">
                    <Icon name="check" size={11} />
                    {t.subtasks.filter((x) => x.done).length}/{t.subtasks.length}
                  </span>
                )}
                <span
                  title={'Приоритет: ' + PRIO[t.priority]}
                  className={'prio ' + (t.priority === 'high' ? 'hi' : t.priority === 'low' ? 'lo' : 'md')}
                >
                  {PRIO[t.priority]}
                </span>
                {t.due && (
                  <span
                    className={'tdue' + (overdue(t) ? ' late' : soon(t) ? ' soon' : '')}
                    title={fmtDay(t.due)}
                  >
                    <Icon name="clock" size={11} />
                    {dueText(t)}
                  </span>
                )}
                <span className="tassignee">
                  <ActorAv actor={t.assignee} size={22} />
                  <span className="t3">{actorName(t.assignee)}</span>
                </span>
              </div>
            ))}
          </div>
        )
      })}
      {!tasks.length && <div className="empty-li">Задач по фильтру нет.</div>}
    </div>
  )
}

function Timeline({ tasks }: { tasks: Task[] }) {
  const st = useStore.getState
  const sc = useRef<HTMLDivElement>(null)
  const toToday = (smooth: boolean) => {
    const el = sc.current
    const t = el?.querySelector<HTMLElement>('.g-today')
    if (el && t)
      el.scrollTo({
        left: Math.max(0, t.offsetLeft - el.clientWidth / 3),
        behavior: smooth ? 'smooth' : 'auto',
      })
  }
  useEffect(() => {
    toToday(false)
  }, [])
  const dated = tasks.filter((t) => t.start || t.due)
  if (!dated.length)
    return <div className="empty-li">Нет задач с датами — укажи начало и срок в карточке задачи.</div>
  const DAY = 86400000
  const ts = (s: string) => new Date(s + 'T00:00').getTime()
  const min = Math.min(...dated.map((t) => ts(t.start || t.due!)), ts(today())) - 2 * DAY
  const max = Math.max(...dated.map((t) => ts(t.due || t.start!)), ts(today())) + 3 * DAY
  const days = Math.round((max - min) / DAY)
  const W = 34
  const x = (s: string) => ((ts(s) - min) / DAY) * W
  return (
    <div className="gantt">
      <div className="g-names">
        <div className="g-head">
          <button className="linkbtn" onClick={() => toToday(true)}>
            Сегодня
          </button>
        </div>
        {dated.map((t) => (
          <div
            key={t.id}
            className="g-name"
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === 'Enter' || e.key === ' ') &&
              (e.preventDefault(), st().openModal({ type: 'task', id: t.id }))
            }
            onClick={() => st().openModal({ type: 'task', id: t.id })}
          >
            <span className="tkey mono">T-{t.key}</span>
            {t.title}
          </div>
        ))}
      </div>
      <div className="g-scroll" ref={sc}>
        <div className="g-grid" style={{ width: days * W }}>
          <div className="g-head">
            {Array.from({ length: days }, (_, i) => {
              const d = new Date(min + i * DAY)
              return (
                <div
                  key={i}
                  className={'g-day' + ([0, 6].includes(d.getDay()) ? ' we' : '')}
                  style={{ width: W }}
                >
                  <b>{d.getDate()}</b>
                  {d.getDate() === 1 || i === 0 ? d.toLocaleDateString('ru-RU', { month: 'short' }) : ''}
                </div>
              )
            })}
          </div>
          <div className="g-today" style={{ left: x(today()) + W / 2 }} />
          {dated.map((t) => {
            const s = t.start || t.due!,
              e = t.due || t.start!
            const col = COLS.find((c) => c.k === t.status)!.c
            return (
              <div key={t.id} className="g-row">
                <div
                  className={'g-bar' + (overdue(t) ? ' late' : '')}
                  style={{ left: x(s), width: Math.max(W, x(e) - x(s) + W), ['--c' as string]: col }}
                  role="button"
                  tabIndex={0}
                  aria-label={t.title}
                  onKeyDown={(ev) =>
                    (ev.key === 'Enter' || ev.key === ' ') &&
                    (ev.preventDefault(), st().openModal({ type: 'task', id: t.id }))
                  }
                  onClick={() => st().openModal({ type: 'task', id: t.id })}
                  title={`${t.title} · ${fmtDay(s)} — ${fmtDay(e)}`}
                >
                  <ActorAv actor={t.assignee} size={16} />
                  <span>{t.title}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function BulkBar({ ids, all, setSel }: { ids: string[]; all: string[]; setSel: (v: string[]) => void }) {
  const p = useProject()!
  const st = useStore.getState
  const people = useStore((x) => x.people)
  const m = useMenu<'status' | 'prio' | 'who'>()
  const patch = (f: Partial<Task>) =>
    ids.forEach((id) => {
      const t = p.tasks.find((x) => x.id === id)
      if (t) st().saveTask({ id, title: t.title, ...f })
    })
  const done = (what: string) =>
    st().toast({
      title: what,
      desc: `${ids.length} ${plural(ids.length, ['задача', 'задачи', 'задач'])}`,
      icon: 'check',
      tone: 'ok',
    })
  const addLabel = () =>
    st().openModal({
      type: 'rename',
      title: 'Добавить метку',
      value: '',
      label: 'Добавить',
      hint: `ко всем выбранным: ${ids.length}`,
      check: (v) => (v.length > 24 ? 'Не длиннее 24 символов' : null),
      run: (v) => {
        const l = v.toLowerCase().replace(/[,#]/g, '')
        ids.forEach((id) => {
          const t = p.tasks.find((x) => x.id === id)
          if (t && !(t.labels || []).includes(l))
            st().saveTask({ id, title: t.title, labels: [...(t.labels || []), l].slice(0, 8) })
        })
        done('Метка добавлена')
      },
    })
  const del = () =>
    st().openModal({
      type: 'confirm',
      danger: true,
      confirm: 'Удалить',
      title: `Удалить ${ids.length} ${plural(ids.length, ['задачу', 'задачи', 'задач'])}?`,
      body: 'Это действие нельзя отменить.',
      run: () => {
        ids.forEach((id) => st().deleteTask(id))
        setSel([])
        st().toast({ title: 'Задачи удалены', icon: 'trash' })
      },
    })
  const members = p.members.map((id) => people[id]).filter(Boolean)
  return (
    <div className="bulk" role="toolbar" aria-label="Действия над выбранными задачами">
      <b>{ids.length}</b>
      <span className="t3">{plural(ids.length, ['выбрана', 'выбраны', 'выбрано'])}</span>
      <span className="bsep" />
      <button className="btn gho sm" onClick={(e) => m.open(e, 'status')}>
        Статус
      </button>
      <button className="btn gho sm" onClick={(e) => m.open(e, 'prio')}>
        Приоритет
      </button>
      <button className="btn gho sm" onClick={(e) => m.open(e, 'who')}>
        Исполнитель
      </button>
      <button className="btn gho sm" onClick={addLabel}>
        Метка
      </button>
      <button className="btn gho sm danger" onClick={del}>
        <Icon name="trash" size={13} />
        Удалить
      </button>
      <span className="bsep" />
      {ids.length < all.length && (
        <button className="linkbtn" onClick={() => setSel(all)}>
          Выбрать все ({all.length})
        </button>
      )}
      <button
        className="iconbtn sm"
        aria-label="Снять выделение"
        title="Снять выделение (Esc)"
        onClick={() => setSel([])}
      >
        <Icon name="x" size={13} />
      </button>
      {m.st && (
        <Menu anchor={m.st.anchor} onClose={m.close} place="top-start">
          {m.st.data === 'status' &&
            COLS.map((c) => (
              <MenuItem
                key={c.k}
                icon="chev"
                label={c.t}
                onClick={() => {
                  m.close()
                  ids.forEach((id) => st().moveTask(id, c.k))
                  done('Статус: ' + c.t)
                }}
              />
            ))}
          {m.st.data === 'prio' &&
            (['high', 'med', 'low'] as const).map((k) => (
              <MenuItem
                key={k}
                icon="chev"
                label={PRIO[k]}
                onClick={() => {
                  m.close()
                  patch({ priority: k })
                  done('Приоритет: ' + PRIO[k])
                }}
              />
            ))}
          {m.st.data === 'who' && (
            <>
              <MenuItem
                icon="x"
                label="Не назначена"
                onClick={() => {
                  m.close()
                  patch({ assignee: null })
                  done('Исполнитель снят')
                }}
              />
              <MenuSep />
              <MenuHead>Люди</MenuHead>
              {members.map((u) => (
                <MenuItem
                  key={u.id}
                  icon="user"
                  label={u.name}
                  onClick={() => {
                    m.close()
                    patch({ assignee: { kind: 'human', id: u.id } as Actor })
                    done('Исполнитель: ' + u.name)
                  }}
                />
              ))}
              <MenuSep />
              <MenuHead>Агенты</MenuHead>
              {Object.keys(AGENTS).map((a) => (
                <MenuItem
                  key={a}
                  icon="bolt"
                  label={a}
                  onClick={() => {
                    m.close()
                    patch({ assignee: { kind: 'agent', name: a } as Actor })
                    done('Исполнитель: ' + a)
                  }}
                />
              ))}
            </>
          )}
        </Menu>
      )}
    </div>
  )
}
