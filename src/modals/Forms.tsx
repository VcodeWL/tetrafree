import { isVaulted, vaultMode } from '../lib/vault'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { DateField } from '../components/ui/DateField'
import { useStore, useProject, toast, actorName } from '../store'
import { Icon, BrandIcon } from '../components/ui/Icon'
import { AgentAvatar, ActorAv, Segmented, PersonAv } from '../components/ui/primitives'
import { Modal, MHead } from '../components/ui/Modal'
import { AGENTS, PRIMARY_AGENTS, ME } from '../data/seed'
import { uid, ago, copyText, localDay } from '../lib/util'
import { cleanApiBase } from '../lib/paths'
import { REPEAT_LABEL, canBlock, type Repeat } from '../lib/taskrel'
import { streamChat, listModels } from '../agent/llm'
import { sendMessage } from '../agent/engine'
import { COLS, PRIO } from '../workspace/TasksView'
/* Settings — тяжёлый, грузим отдельным чанком, а не в главный бандл */
const Shortcuts = lazy(() => import('./Settings').then((m) => ({ default: m.Shortcuts })))
import {
  TIERS,
  type Actor,
  type Priority,
  type Provider,
  type ProviderKind,
  type TaskStatus,
  type Tier,
} from '../types'

/* ---------- провайдер ---------- */
const KINDS: { k: ProviderKind; t: string; url: string }[] = [
  { k: 'anthropic', t: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  { k: 'openai', t: 'OpenAI', url: 'https://api.openai.com/v1' },
  { k: 'ollama', t: 'Ollama', url: 'http://localhost:11434/v1' },
  { k: 'custom', t: 'Совместимый с OpenAI', url: 'https://' },
]
export function ProviderModal({ id }: { id?: string }) {
  const orig = useStore((s) => s.providers.find((p) => p.id === id))
  const st = useStore.getState
  const [p, setP] = useState<Provider>(() =>
    orig
      ? structuredClone(orig)
      : {
          id: uid('pr'),
          name: '',
          kind: 'openai',
          baseUrl: KINDS[1].url,
          apiKey: '',
          models: [{ id: '', name: '' }],
          on: true,
        },
  )
  const [show, setShow] = useState(false)
  const [test, setTest] = useState<{ state: 'idle' | 'run' | 'ok' | 'err'; msg?: string }>({ state: 'idle' })
  const set = (patch: Partial<Provider>) => setP((x) => ({ ...x, ...patch }))
  const models = p.models.filter((m) => m.id.trim())
  const err = !p.name.trim()
    ? 'Укажи название'
    : !/^https?:\/\/.+/.test(p.baseUrl)
      ? 'Адрес должен начинаться с http:// или https://'
      : !models.length
        ? 'Добавь хотя бы одну модель'
        : ''
  const back = () => st().openModal({ type: 'settings', section: 'providers' })
  const save = () => {
    if (err) return
    st().saveProvider({
      ...p,
      baseUrl: cleanApiBase(p.baseUrl),
      name: p.name.trim(),
      models: models.map((m) => ({ id: m.id.trim(), name: m.name.trim() || m.id.trim() })),
    })
    if (!st().model) st().setModel(p.id + ':' + models[0].id.trim())
    toast({
      title: orig ? 'Провайдер обновлён' : 'Провайдер добавлен',
      desc: p.name,
      icon: 'key',
      tone: 'ok',
    })
    back()
  }
  const [loadingModels, setLM] = useState(false)
  const fetchModels = async () => {
    setLM(true)
    setTest({ state: 'run' })
    try {
      const rows = await listModels(p)
      if (!rows.length) throw new Error('Провайдер вернул пустой список моделей')
      setP((x) => {
        const have = new Map(x.models.filter((m) => m.id.trim()).map((m) => [m.id, m.name]))
        return { ...x, models: rows.map((r) => ({ id: r.id, name: have.get(r.id) || r.name })) }
      })
      setTest({ state: 'ok', msg: `Найдено моделей: ${rows.length}. Оставь нужные — лишние можно удалить.` })
    } catch (e) {
      setTest({ state: 'err', msg: (e as Error).message.slice(0, 200) })
    } finally {
      setLM(false)
    }
  }
  const runTest = async () => {
    if (!models.length) return
    setTest({ state: 'run' })
    const ac = new AbortController()
    let got = ''
    const t = setTimeout(() => ac.abort(), 15000)
    try {
      await streamChat({
        provider: p,
        model: models[0].id.trim(),
        system: 'Reply with one word.',
        messages: [{ role: 'user', content: 'ping' }],
        signal: ac.signal,
        onDelta: (d) => {
          got += d
          if (got.length > 2) ac.abort()
        },
      })
      setTest({ state: 'ok', msg: got ? `Ответ: «${got.trim().slice(0, 40)}»` : 'Соединение установлено' })
    } catch (e) {
      if (got) setTest({ state: 'ok', msg: `Ответ: «${got.trim().slice(0, 40)}»` })
      else
        setTest({
          state: 'err',
          msg:
            (e as Error).name === 'AbortError'
              ? 'Нет ответа за 15 секунд'
              : (e as Error).message.slice(0, 160),
        })
    } finally {
      clearTimeout(t)
    }
  }
  return (
    <Modal label="Провайдер" onClose={back}>
      <MHead
        icon="key"
        title={orig ? orig.name : 'Новый провайдер'}
        sub="Любой API, совместимый с Anthropic или OpenAI. Список моделей появится в выборе модели у композера."
        onClose={back}
      />
      <div className="field">
        <label>Тип</label>
        <div className="kchips">
          {KINDS.map((k) => (
            <button
              key={k.k}
              className={'kchip' + (p.kind === k.k ? ' on' : '')}
              onClick={() =>
                set({
                  kind: k.k,
                  baseUrl: KINDS.some((x) => x.url === p.baseUrl) || !p.baseUrl ? k.url : p.baseUrl,
                  name: p.name || (k.k === 'custom' ? '' : k.t),
                })
              }
            >
              <BrandIcon kind={k.k} size={15} />
              {k.t}
            </button>
          ))}
        </div>
      </div>
      <div className="fgrid">
        <div className="field">
          <label>Название</label>
          <input
            value={p.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Например, OpenRouter"
          />
        </div>
        <div className="field">
          <label htmlFor="pv-base">Базовый адрес</label>
          <input
            id="pv-base"
            className="mono"
            value={p.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value.trim() })}
            onBlur={() => set({ baseUrl: cleanApiBase(p.baseUrl) })}
          />
        </div>
      </div>
      <div className="field">
        <label>
          Ключ API {p.kind === 'ollama' && <span className="dim">— не нужен для локальной модели</span>}
        </label>
        <div className="pwd">
          <input
            type={show ? 'text' : 'password'}
            className="mono"
            value={p.apiKey}
            onChange={(e) => set({ apiKey: e.target.value.trim() })}
            onBlur={() => {
              /* ключ введён, а моделей ещё нет — подтягиваем список сразу */
              if (p.apiKey && !models.length && !loadingModels) void fetchModels()
            }}
            placeholder={p.kind === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            autoComplete="off"
          />
          <button
            className="eye"
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? 'Скрыть' : 'Показать'}
          >
            <Icon name={show ? 'eyeoff' : 'eye'} size={15} />
          </button>
        </div>
        {p.apiKey && (
          <span className="t4" role="status">
            {isVaulted(p)
              ? vaultMode === 'dpapi'
                ? 'Ключ хранится зашифрованным (Windows DPAPI), в браузерном хранилище его нет.'
                : 'Ключ хранится в отдельном файле на этом компьютере, в браузерном хранилище его нет.'
              : 'Ключ пока в браузерном хранилище — перенесётся в защищённое, когда запустится локальный сервер.'}
          </span>
        )}
      </div>
      <div className="field">
        <label>Модели — идентификатор и отображаемое имя</label>
        {p.models.map((m, i) => (
          <div className="mrow" key={i}>
            <input
              className="mid"
              value={m.id}
              placeholder="model-id"
              onChange={(e) =>
                set({ models: p.models.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })
              }
            />
            <input
              value={m.name}
              placeholder="Название"
              onChange={(e) =>
                set({ models: p.models.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
              }
            />
            <button
              className="iconbtn del"
              disabled={p.models.length === 1}
              onClick={() => set({ models: p.models.filter((_, j) => j !== i) })}
              aria-label="Удалить модель"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <button className="btn sm gho" onClick={() => set({ models: [...p.models, { id: '', name: '' }] })}>
          <Icon name="plus" size={13} />
          Модель
        </button>{' '}
        <button
          className="btn sm gho"
          disabled={loadingModels || (!p.apiKey && p.kind !== 'ollama')}
          onClick={fetchModels}
          title={!p.apiKey && p.kind !== 'ollama' ? 'Сначала добавь ключ' : 'GET /models у провайдера'}
        >
          <Icon name="refresh" size={13} />
          Загрузить список у провайдера
        </button>
      </div>
      {test.state !== 'idle' && (
        <div className={'testres ' + test.state}>
          {test.state === 'run' ? (
            <span className="tspin" />
          ) : (
            <Icon name={test.state === 'ok' ? 'check' : 'warn'} size={14} />
          )}
          <span>{test.state === 'run' ? 'Отправляю тестовый запрос…' : test.msg}</span>
        </div>
      )}
      {err && <div className="ferr">{err}</div>}
      <div className="mfoot">
        {orig && (
          <button
            className="btn gho danger"
            onClick={() =>
              st().openModal({
                type: 'confirm',
                danger: true,
                title: `Удалить ${orig.name}?`,
                body: 'Модели этого провайдера пропадут из выбора. Ключ будет стёрт с устройства.',
                confirm: 'Удалить',
                run: () => {
                  st().deleteProvider(orig.id)
                  back()
                },
              })
            }
          >
            <Icon name="trash" size={13} />
            Удалить
          </button>
        )}
        <span className="grow" />
        <button
          className="btn"
          disabled={!models.length || test.state === 'run' || (!p.apiKey && p.kind !== 'ollama')}
          onClick={runTest}
          title={!p.apiKey && p.kind !== 'ollama' ? 'Сначала добавь ключ' : ''}
        >
          <Icon name="bolt" size={13} />
          Проверить
        </button>
        <button className="btn pri" disabled={!!err} onClick={save}>
          Сохранить
        </button>
      </div>
    </Modal>
  )
}

/* ---------- новый чат ---------- */
export function NewChatModal() {
  const p = useProject()!
  const st = useStore.getState
  const [title, setTitle] = useState('')
  const [agents, setAgents] = useState<string[]>(['builder'])
  const [tier, setTier] = useState<Tier>('Спросить')
  const create = () => {
    const t = title.trim() || 'Новый чат'
    const id = st().createChat({
      title: t,
      creator: { kind: 'human', id: ME },
      agents: agents.map((name) => ({ name, tier, sub: [] })),
    })
    st().setCenter({ kind: 'chat', id })
    st().closeModal()
  }
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <Modal label="Новый чат">
      <MHead
        icon="chat"
        title="Новый чат"
        sub={`Чат виден всем участникам «${p.name}». Агенты разных чатов видят изменения друг друга через общую память.`}
      />
      <div className="field">
        <label>Тема</label>
        <input
          ref={ref}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Например, миграция на Postgres 17"
        />
      </div>
      <div className="field">
        <label>Агенты в чате</label>
        <div className="agpick">
          {PRIMARY_AGENTS.map((a) => {
            const on = agents.includes(a)
            return (
              <button
                key={a}
                className={'agopt' + (on ? ' on' : '')}
                onClick={() => setAgents(on ? agents.filter((x) => x !== a) : [...agents, a])}
              >
                <AgentAvatar name={a} size={26} />
                <span className="ag-x">
                  <b>{a}</b>
                  <span>{AGENTS[a]?.role}</span>
                </span>
                <span className="cbx2">{on && <Icon name="check" size={11} />}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="field">
        <label>Автономия</label>
        <Segmented
          wide
          label="Уровень автономии"
          value={tier}
          onChange={setTier}
          options={TIERS.map((t) => ({ k: t, t }))}
        />
        <div className="fhint">{TIER_HINT[tier]}</div>
      </div>
      <div className="mfoot">
        <span className="grow" />
        <button className="btn gho" onClick={() => st().closeModal()}>
          Отмена
        </button>
        <button className="btn pri" onClick={create}>
          Создать чат
        </button>
      </div>
    </Modal>
  )
}
export const TIER_HINT: Record<Tier, string> = {
  Тихо: 'Агент делает всё сам и просто пишет результат в чат.',
  Уведомить: 'Делает сам, но каждое действие с файлами сопровождает уведомлением.',
  Спросить: 'Опасные действия — удаление, установка пакетов, деплой — только после твоего «да».',
  Эскалация: 'Любая правка требует подтверждения: карточка с причиной, риском и альтернативами.',
}

/* ---------- подтверждение / переименование ---------- */
export function ConfirmModal({
  title,
  body,
  danger,
  confirm,
  run,
}: {
  title: string
  body: string
  danger?: boolean
  confirm: string
  run: () => void
}) {
  const st = useStore.getState
  const go = () => {
    st().closeModal()
    run()
  }
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <Modal label={title}>
      <MHead icon={danger ? 'warn' : 'info'} title={title} sub={body} />
      <div className="mfoot">
        <span className="grow" />
        <button className="btn gho" onClick={() => st().closeModal()}>
          Отмена
        </button>
        <button ref={ref} className={'btn ' + (danger ? 'dangerpri' : 'pri')} onClick={go}>
          {confirm}
        </button>
      </div>
    </Modal>
  )
}
export function RenameModal({
  title,
  value,
  run,
  check,
  label,
  hint,
}: {
  title: string
  value: string
  run: (v: string) => void
  check?: (v: string) => string | null
  label?: string
  hint?: string
}) {
  const st = useStore.getState
  const [v, setV] = useState(value)
  const err = v.trim() && v.trim() !== value && check ? check(v.trim()) : null
  const ok = !!v.trim() && !err
  const go = () => {
    if (!ok) return
    st().closeModal()
    if (v.trim() !== value) run(v.trim())
  }
  return (
    <Modal label={title}>
      <MHead icon="edit" title={title} sub={hint} />
      <div className="field">
        <input
          autoFocus
          value={v}
          aria-invalid={!!err}
          onChange={(e) => setV(e.target.value)}
          onFocus={(e) => {
            const i = e.target.value.lastIndexOf('.')
            e.target.setSelectionRange(0, i > 0 && !value.endsWith('/') && check ? i : e.target.value.length)
          }}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        {err && <div className="ferr">{err}</div>}
      </div>
      <div className="mfoot">
        <span className="grow" />
        <button className="btn gho" onClick={() => st().closeModal()}>
          Отмена
        </button>
        <button className="btn pri" disabled={!ok} onClick={go}>
          {label || 'Сохранить'}
        </button>
      </div>
    </Modal>
  )
}
export function ShortcutsModal() {
  return (
    <Modal label="Горячие клавиши" wide>
      <MHead icon="keyboard" title="Горячие клавиши" />
      <div className="sc-in">
        <Suspense fallback={<div className="sd">Загружаю…</div>}>
          <Shortcuts />
        </Suspense>
      </div>
    </Modal>
  )
}

/* ---------- задача ---------- */
export function TaskModal({ id, status }: { id?: string; status?: TaskStatus }) {
  const p = useProject()!
  const people = useStore((s) => s.people)
  const st = useStore.getState
  const orig = p.tasks.find((t) => t.id === id)
  const [title, setTitle] = useState(orig?.title || '')
  const [desc, setDesc] = useState(orig?.desc || '')
  const [stt, setStt] = useState<TaskStatus>(orig?.status || status || 'backlog')
  const [prio, setPrio] = useState<Priority>(orig?.priority || 'med')
  const [who, setWho] = useState<Actor | null>(orig?.assignee ?? null)
  const [start, setStart] = useState(orig?.start || '')
  const [due, setDue] = useState(orig?.due || '')
  const [subs, setSubs] = useState(orig?.subtasks || [])
  const [repeat, setRepeat] = useState<Repeat | ''>(orig?.repeat || '')
  const [blockedBy, setBlockedBy] = useState<string[]>(orig?.blockedBy || [])
  const [subText, setSubText] = useState('')
  const [labels, setLabels] = useState(orig?.labels || [])
  const [lblText, setLblText] = useState('')
  const [cmtText, setCmtText] = useState('')
  const addSub = () => {
    const t = subText.trim()
    if (!t) return
    setSubs([...subs, { id: uid('s'), text: t.slice(0, 200), done: false }])
    setSubText('')
  }
  const toggleSub = (sid: string) => {
    const next = subs.map((x) => (x.id === sid ? { ...x, done: !x.done } : x))
    setSubs(next)
    if (next.length && next.every((x) => x.done) && stt !== 'done')
      st().toast({
        title: 'Все подзадачи готовы',
        desc: 'Перенести задачу в «Готово»?',
        icon: 'check',
        action: { label: 'Да', run: () => setStt('done') },
      })
  }
  const addLabel = (raw: string) => {
    const l = raw.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (l && !labels.some((x) => x.toLowerCase() === l.toLowerCase()) && labels.length < 8)
      setLabels([...labels, l])
    setLblText('')
  }
  const addComment = () => {
    const text = cmtText.trim()
    if (!text || !orig) return
    st().saveTask({
      id: orig.id,
      title: orig.title,
      comments: [
        ...(orig.comments || []),
        { id: uid('c'), by: ME, text: text.slice(0, 2000), at: Date.now() },
      ],
    })
    setCmtText('')
  }
  const dateErr = start && due && due < start ? 'Срок раньше начала' : ''
  const whoKey = (a: Actor | null) => (!a ? '' : a.kind === 'agent' ? 'a:' + a.name : 'h:' + a.id)
  const fromKey = (k: string): Actor | null =>
    !k ? null : k.startsWith('a:') ? { kind: 'agent', name: k.slice(2) } : { kind: 'human', id: k.slice(2) }
  const save = (patch: Partial<{ status: TaskStatus; assignee: Actor | null }> = {}) => {
    if (!title.trim() || dateErr) return null
    const tid = st().saveTask({
      id: orig?.id,
      title: title.trim(),
      desc: desc.trim(),
      status: stt,
      priority: prio,
      assignee: who,
      start: start || undefined,
      due: due || undefined,
      subtasks: subs.length ? subs : undefined,
      labels: labels.length ? labels : undefined,
      repeat: repeat || undefined,
      blockedBy: blockedBy.length ? blockedBy : undefined,
      ...patch,
    })
    return tid
  }
  const delegate = () => {
    const agent = who?.kind === 'agent' ? who.name : 'builder'
    const tid = save({ assignee: { kind: 'agent', name: agent }, status: stt === 'backlog' ? 'doing' : stt })
    if (!tid) return
    const t = useStore
      .getState()
      .projects.find((x) => x.id === p.id)!
      .tasks.find((x) => x.id === tid)!
    const cid = st().createChat({
      title: `#${t.key} ${t.title}`.slice(0, 48),
      creator: { kind: 'human', id: ME },
      agents: [{ name: agent, tier: 'Спросить', sub: [] }],
    })
    st().setCenter({ kind: 'chat', id: cid })
    st().closeModal()
    setTimeout(
      () =>
        sendMessage(
          cid,
          `Возьми задачу #${t.key}: ${t.title}${t.desc ? '\n\n' + t.desc : ''}${t.due ? `\n\nСрок: ${t.due}` : ''}`,
        ),
      60,
    )
  }
  return (
    <Modal label="Задача">
      <MHead
        icon="task"
        title={
          orig ? (
            <>
              <span className="tkey">#{orig.key}</span>Задача
            </>
          ) : (
            'Новая задача'
          )
        }
      />
      <div className="field">
        <input
          autoFocus
          className="tt-in"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать"
          onKeyDown={(e) => e.key === 'Enter' && (save(), title.trim() && st().closeModal())}
        />
      </div>
      <div className="field">
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Описание, критерии готовности, ссылки"
          rows={4}
        />
      </div>
      <div className="field">
        <label>
          Подзадачи{subs.length > 0 && ` · ${subs.filter((x) => x.done).length} из ${subs.length}`}
        </label>
        {subs.length > 0 && (
          <div className="sub-bar">
            <i style={{ width: (subs.filter((x) => x.done).length / subs.length) * 100 + '%' }} />
          </div>
        )}
        <div className="subs">
          {subs.map((x) => (
            <div key={x.id} className={'sub-i' + (x.done ? ' done' : '')}>
              <input type="checkbox" checked={x.done} onChange={() => toggleSub(x.id)} aria-label={x.text} />
              <span>{x.text}</span>
              <button
                className="iconbtn sm"
                aria-label="Убрать подзадачу"
                onClick={() => setSubs(subs.filter((y) => y.id !== x.id))}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="sub-add">
          <input
            value={subText}
            onChange={(e) => setSubText(e.target.value)}
            placeholder="Добавить пункт и нажать Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSub()
              }
            }}
          />
          <button className="btn sm" onClick={addSub} disabled={!subText.trim()}>
            Добавить
          </button>
        </div>
      </div>
      <div className="field">
        <label>Метки</label>
        <div className="lbl-in">
          {labels.map((l) => (
            <span key={l} className="tlabel">
              {l}
              <button
                aria-label={'Убрать метку ' + l}
                onClick={() => setLabels(labels.filter((x) => x !== l))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={lblText}
            placeholder={labels.length ? '' : 'баг, дизайн, backend…'}
            onChange={(e) => {
              const v = e.target.value
              if (v.endsWith(',')) addLabel(v.slice(0, -1))
              else setLblText(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLabel(lblText)
              } else if (e.key === 'Backspace' && !lblText && labels.length) setLabels(labels.slice(0, -1))
            }}
            onBlur={() => lblText && addLabel(lblText)}
          />
        </div>
      </div>
      <div className="fgrid">
        <div className="field">
          <label>Статус</label>
          <select
            className="sel"
            aria-label="Статус"
            value={stt}
            onChange={(e) => setStt(e.target.value as TaskStatus)}
          >
            {COLS.map((c) => (
              <option key={c.k} value={c.k}>
                {c.t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Исполнитель</label>
          <div className="selwrap">
            <ActorAv actor={who} size={18} />
            <select
              className="sel"
              aria-label="Исполнитель"
              value={whoKey(who)}
              onChange={(e) => setWho(fromKey(e.target.value))}
            >
              <option value="">Не назначена</option>
              <optgroup label="Люди">
                {p.members
                  .filter((m) => !people[m]?.pending)
                  .map((m) => (
                    <option key={m} value={'h:' + m}>
                      {people[m]?.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Агенты">
                {Object.keys(AGENTS).map((a) => (
                  <option key={a} value={'a:' + a}>
                    {a}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Начало</label>
          <DateField label="Начало" value={start} onChange={setStart} />
        </div>
        <div className={'field' + (dateErr ? ' bad' : '')}>
          <label>Срок</label>
          <DateField label="Срок" value={due} onChange={setDue} />
          <div className="qdates">
            {(
              [
                ['Сегодня', 0],
                ['Завтра', 1],
                ['Через неделю', 7],
              ] as const
            ).map(([t, n]) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  const d = new Date()
                  d.setDate(d.getDate() + n)
                  setDue(localDay(d))
                }}
              >
                {t}
              </button>
            ))}
            {due && (
              <button type="button" onClick={() => setDue('')}>
                Убрать
              </button>
            )}
          </div>
          {dateErr && <div className="ferr">{dateErr}</div>}
        </div>
      </div>
      <div className="fgrid">
        <div className="field">
          <label>Повтор</label>
          <select
            className="sel"
            aria-label="Повтор"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as Repeat | '')}
          >
            <option value="">Не повторяется</option>
            {(Object.keys(REPEAT_LABEL) as Repeat[]).map((k) => (
              <option key={k} value={k}>
                {REPEAT_LABEL[k]}
              </option>
            ))}
          </select>
          {repeat && (
            <div className="fhint">
              {due
                ? 'Когда задача будет готова, появится копия со сроком дальше по расписанию.'
                : 'Без срока копия появится сразу после завершения.'}
            </div>
          )}
        </div>
        <div className="field">
          <label>Ждёт выполнения{blockedBy.length > 0 && ` · ${blockedBy.length}`}</label>
          {blockedBy.length > 0 && (
            <div className="lbl-in" style={{ marginBottom: 6 }}>
              {blockedBy.map((b) => {
                const bt = p.tasks.find((x) => x.id === b)
                return bt ? (
                  <span key={b} className="tlabel" title={bt.title}>
                    T-{bt.key}
                    {bt.status === 'done' ? ' ✓' : ''}
                    <button
                      aria-label={'Убрать зависимость T-' + bt.key}
                      onClick={() => setBlockedBy(blockedBy.filter((x) => x !== b))}
                    >
                      ×
                    </button>
                  </span>
                ) : null
              })}
            </div>
          )}
          <select
            className="sel"
            value=""
            aria-label="Добавить зависимость"
            onChange={(e) => e.target.value && setBlockedBy([...blockedBy, e.target.value])}
          >
            <option value="">{blockedBy.length ? 'Добавить ещё…' : 'Нет зависимостей'}</option>
            {p.tasks
              .filter(
                (x) =>
                  x.id !== orig?.id &&
                  !blockedBy.includes(x.id) &&
                  x.status !== 'done' &&
                  (!orig || canBlock(p.tasks, orig.id, x.id)),
              )
              .map((x) => (
                <option key={x.id} value={x.id}>
                  T-{x.key} · {x.title.slice(0, 48)}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Приоритет</label>
        <Segmented
          wide
          label="Приоритет"
          value={prio}
          onChange={setPrio}
          options={(['low', 'med', 'high'] as Priority[]).map((k) => ({
            k,
            t: PRIO[k],
            icon: <i className={'prio ' + (k === 'high' ? 'hi' : k === 'med' ? 'md' : 'lo')} />,
          }))}
        />
      </div>
      {orig && (
        <div className="field">
          <label>Обсуждение{!!orig.comments?.length && ` · ${orig.comments.length}`}</label>
          {!!orig.comments?.length && (
            <div className="cmts">
              {orig.comments.map((c) => (
                <div key={c.id} className="cmt">
                  <PersonAv id={c.by} size={24} round />
                  <div className="cb">
                    <div className="ch">
                      <b>{c.by === ME ? 'Ты' : people[c.by]?.name}</b>
                      <span>{ago(c.at)}</span>
                    </div>
                    <div className="ct">
                      {c.text
                        .split(/(@[\p{L}\d_-]+)/gu)
                        .map((x, i) => (x.startsWith('@') ? <mark key={i}>{x}</mark> : x))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="sub-add">
            <input
              value={cmtText}
              onChange={(e) => setCmtText(e.target.value)}
              placeholder="Комментарий; @имя — упомянуть"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addComment()
                }
              }}
            />
            <button className="btn sm" onClick={addComment} disabled={!cmtText.trim()}>
              Отправить
            </button>
          </div>
        </div>
      )}
      {orig && (
        <div className="fhint">
          Создана {new Date(orig.createdAt).toLocaleDateString('ru-RU')} · сейчас:{' '}
          {actorName(orig.assignee, people)}
        </div>
      )}
      <div className="mfoot">
        {orig && (
          <button
            className="btn gho danger"
            onClick={() =>
              st().openModal({
                type: 'confirm',
                danger: true,
                title: `Удалить #${orig.key}?`,
                body: `«${orig.title}» пропадёт с доски и из таймлайна.`,
                confirm: 'Удалить',
                run: () => st().deleteTask(orig.id),
              })
            }
          >
            <Icon name="trash" size={13} />
          </button>
        )}
        {orig && (
          <button
            className="btn gho"
            title="Скопировать ключ задачи"
            onClick={() => {
              copyText(`T-${orig.key} ${orig.title}`)
              toast({ title: 'Скопировано', desc: `T-${orig.key}`, icon: 'copy' })
            }}
          >
            <Icon name="copy" size={13} />
          </button>
        )}
        {orig && (
          <button
            className="btn gho"
            title="Создать копию задачи"
            onClick={() => {
              const { id: _i, key: _k, comments: _c, ...rest } = orig
              void _i
              void _k
              void _c
              st().saveTask({
                ...rest,
                title: orig.title + ' (копия)',
                status: 'backlog',
                subtasks: orig.subtasks?.map((x) => ({ ...x, id: uid('s'), done: false })),
              })
              st().closeModal()
              toast({ title: 'Копия создана', icon: 'copy' })
            }}
          >
            <Icon name="plus" size={13} />
            Дублировать
          </button>
        )}
        <span className="grow" />
        <button
          className="btn"
          disabled={!title.trim() || !!dateErr}
          onClick={delegate}
          title="Создаст чат с агентом и передаст ему задачу"
        >
          <Icon name="sparkle" size={13} />
          Делегировать {who?.kind === 'agent' ? who.name : 'агенту'}
        </button>
        <button
          className="btn pri"
          disabled={!title.trim() || !!dateErr}
          onClick={() => {
            if (save()) {
              st().closeModal()
              if (!orig) toast({ title: 'Задача создана', icon: 'check', tone: 'ok' })
            }
          }}
        >
          {orig ? 'Сохранить' : 'Создать'}
        </button>
      </div>
    </Modal>
  )
}
