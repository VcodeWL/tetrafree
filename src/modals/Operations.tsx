import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon, type IconName } from '../components/ui/Icon'
import { useStore } from '../store'
import { automationIdentity, useAutomationJournal } from '../agent/automationJournal'
import { useAutomationControl, pauseAutomations, resumeAutomations } from '../agent/automationControl'
import {
  activeOperation,
  attentionOperation,
  terminalOperation,
  collectOperations,
  observeProgress,
  type Operation,
  type OperationAction,
  type ProgressObservation,
} from '../agent/operations'
import { ago } from '../lib/util'

type Filter = 'active' | 'attention' | 'history' | 'all'
const filters: [Filter, string][] = [
  ['active', 'Сейчас'],
  ['attention', 'Требует внимания'],
  ['history', 'История'],
  ['all', 'Все'],
]
const statusText: Record<Operation['status'], string> = {
  running: 'Выполняется',
  waiting: 'Ожидает',
  stopping: 'Отмена запрошена',
  attention: 'Проверь',
  succeeded: 'Завершено',
  failed: 'Ошибка',
  cancelled: 'Остановлено',
  interrupted: 'Прервано',
}
const icons: Record<Operation['kind'], IconName> = {
  agent: 'bolt',
  command: 'terminal',
  queue: 'chat',
  loop: 'refresh',
  pipeline: 'rocket',
  sync: 'refresh',
  review: 'shield',
  automation: 'clock',
}
const match = (row: Operation, filter: Filter) =>
  filter === 'all' ||
  (filter === 'active'
    ? activeOperation(row)
    : filter === 'attention'
      ? attentionOperation(row)
      : terminalOperation(row))

export function OperationsModal() {
  const [tick, setTick] = useState(0)
  const [scope, setScope] = useState(useStore.getState().projectId || '')
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ row: Operation; action: OperationAction } | null>(null)
  const progress = useRef(new Map<string, ProgressObservation>())
  const [quiet, setQuiet] = useState(new Set<string>())
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const flight = useRef(false)
  const lifecycle = useRef({ mounted: false, generation: 0 })
  const paused = useAutomationControl((s) => s.paused)
  const controlError = useAutomationControl((s) => s.storageError)
  const journalError = useAutomationJournal((s) => s.unavailable)
  const projects = useStore.getState().projects
  const projectIds = JSON.stringify(projects.slice(0, 500).map((p) => p.id))
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      window.clearInterval(timer)
      state.mounted = false
      state.generation++
    }
  }, [])
  useEffect(() => {
    let alive = true
    const ids = JSON.parse(projectIds) as string[]
    void Promise.all(ids.map(async (pid) => [await automationIdentity(pid, ''), pid]))
      .then((entries) => {
        if (alive) setHashes(Object.fromEntries(entries))
      })
      .catch(() => {
        if (alive) setHashes({})
      })
    return () => {
      alive = false
    }
  }, [projectIds])
  const snapshot = useMemo(() => {
    void tick
    return collectOperations(hashes)
  }, [tick, hashes])
  useEffect(() => {
    const observed = observeProgress(snapshot.rows, progress.current, Date.now())
    progress.current = observed.next
    setQuiet(observed.quiet)
  }, [snapshot])
  const scoped = snapshot.rows.filter((r) => !scope || r.projectId === scope)
  const counts = {
    active: scoped.filter(activeOperation).length,
    attention: scoped.filter(attentionOperation).length,
    history: scoped.filter(terminalOperation).length,
    all: scoped.length,
  }
  const q = query.trim().toLocaleLowerCase('ru')
  const rows = scoped.filter(
    (r) =>
      match(r, filter) && (!q || `${r.project} ${r.title} ${r.detail}`.toLocaleLowerCase('ru').includes(q)),
  )
  const execute = async (action: OperationAction) => {
    if (flight.current) return
    flight.current = true
    setBusy(true)
    setNotice('')
    const originScope = scope
    const state = lifecycle.current,
      generation = ++state.generation
    try {
      const result = await action.run()
      if (state.mounted && state.generation === generation) {
        if (scopeRef.current === originScope) setNotice(result.message)
        setTick((n) => n + 1)
      }
    } catch {
      if (state.mounted && state.generation === generation && scopeRef.current === originScope)
        setNotice('Действие не завершено. Обнови список и проверь исходный проект перед повтором.')
    } finally {
      flight.current = false
      if (state.mounted && state.generation === generation) setBusy(false)
    }
  }
  return (
    <Modal wide label="Центр фоновых операций">
      <MHead
        icon="layers"
        title="Фоновые операции"
        sub="Что работает, чего ждёт и где требуется твоё решение. Ничего не запускается от открытия этого окна."
      />
      <div className="ops-toolbar">
        <label>
          Проект
          <select
            aria-label="Проекты операций"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value)
              setConfirm(null)
              setNotice('')
            }}
          >
            <option value="">Все проекты</option>
            {scope && !projects.some((p) => p.id === scope) && (
              <option value={scope}>Исходный проект удалён</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-search">
          Найти
          <input
            aria-label="Поиск операций"
            placeholder="Проект, операция или статус"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn sm" onClick={() => setTick((n) => n + 1)}>
          <Icon name="refresh" size={13} />
          Обновить
        </button>
      </div>
      <div className="ops-filters" role="group" aria-label="Фильтр операций">
        {filters.map(([key, label]) => (
          <button
            type="button"
            className={'btn sm ' + (filter === key ? 'pri' : 'gho')}
            aria-pressed={filter === key}
            key={key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="mono">{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="ops-policy">
        <span>
          {paused ? 'Автоматизации на паузе.' : 'Автоматические запуски разрешены по текущим настройкам.'}
        </span>
        <button
          type="button"
          className="linkbtn"
          disabled={controlError}
          onClick={paused ? resumeAutomations : pauseAutomations}
        >
          {paused ? 'Возобновить' : 'Поставить на паузу'}
        </button>
      </div>
      {(controlError || journalError) && (
        <p role="alert" className="ops-warning">
          Хранилище настроек или истории автоматизаций недоступно. История может быть неполной; исходные
          данные не сбрасываются.
        </p>
      )}
      {snapshot.truncated && (
        <p role="status" className="ops-warning">
          Список ограничен 250 строками и частью больших проектов. Отсутствие строки не доказывает отсутствие
          работы. Открой исходный проект для подробностей.
        </p>
      )}
      {confirm && (
        <div className="ops-confirm" role="group" aria-label="Подтверждение действия">
          <b>
            {confirm.action.label} · {confirm.row.title}
          </b>
          <p>{confirm.action.confirm}</p>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => {
              const a = confirm.action
              setConfirm(null)
              void execute(a)
            }}
          >
            Подтвердить действие
          </button>
          <button type="button" className="btn sm gho" onClick={() => setConfirm(null)}>
            Не выполнять
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="ops-notice">
          {notice}
        </p>
      )}
      <div className="ops-list" aria-label="Список операций" aria-busy={busy}>
        {!rows.length && (
          <div className="ops-empty">
            <Icon name="check" size={22} />
            <b>{filter === 'active' ? 'В этом списке нет текущей работы' : 'Подходящих операций нет'}</b>
            <span>
              Измени фильтр или открой другой проект. Старые запуски не возобновляются автоматически.
            </span>
          </div>
        )}
        {rows.map((row) => (
          <article className={'ops-row ' + row.status} key={row.id}>
            <span className="ops-kind">
              <Icon name={icons[row.kind]} size={17} />
            </span>
            <div className="ops-body">
              <div className="ops-title">
                <b>{row.title}</b>
                <span className={'ops-state ' + row.status}>{statusText[row.status]}</span>
              </div>
              <div className="ops-project">
                {row.project}
                {row.at ? ' · ' + ago(row.at) : ''}
              </div>
              <p>{row.detail}</p>
              {quiet.has(row.id) && (
                <p className="ops-warning">
                  Нет видимых обновлений 2 минуты с момента наблюдения в этом окне. Это не доказательство
                  зависания; проверь детали перед повтором.
                </p>
              )}
              <div className="ops-actions">
                {row.actions.map((action) => (
                  <button
                    type="button"
                    key={action.label}
                    className={'btn sm ' + (action.kind === 'cancel' ? 'gho' : '')}
                    disabled={busy}
                    onClick={() => {
                      if (action.confirm) {
                        setConfirm({ row, action })
                        setNotice('')
                      } else void execute(action)
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="ops-footnote">
        Индивидуальная остановка хода сохраняет очередь и уже полученный ответ; завершение отмены не
        гарантируется мгновенно. Глобальная «Остановить всё» по-прежнему очищает очереди. История чатов здесь
        ограничена последними 20 сообщениями. Сверка приложения, диска и облака — разные подтверждения.
      </p>
    </Modal>
  )
}
