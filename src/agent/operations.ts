/** Live projection only: no new scheduler, persisted payload, automatic retry or tool dispatch. */
import { useStore } from '../store'
import type { Message } from '../types'
import { captureTurnControl, captureRetryControls } from './engine'
import { queueFor, clearQueue, useQueue } from './queue'
import { loopFor, loopStop, useLoops } from './loop'
import { capturePipelineControl } from './ci'
import { useAutomationJournal, runReasonText } from './automationJournal'
import { retryAutomation } from './autorun'
import { captureSyncHealth, syncHealthLabel } from '../lib/syncStatus'
import { retryProjectSync } from '../lib/sync'
import { captureBackendContextRevision } from '../lib/backend'
import { getTokenRevision } from '../lib/token'

export type OperationStatus =
  'running' | 'waiting' | 'stopping' | 'attention' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export type OperationKind =
  'agent' | 'command' | 'queue' | 'loop' | 'pipeline' | 'sync' | 'review' | 'automation'
export interface OperationResult {
  ok: boolean
  message: string
}
export interface OperationAction {
  label: string
  kind: 'open' | 'cancel' | 'retry'
  confirm?: string
  run: () => OperationResult | Promise<OperationResult>
}
export interface Operation {
  id: string
  kind: OperationKind
  status: OperationStatus
  projectId?: string
  project: string
  title: string
  detail: string
  at?: number
  progress: string
  actions: OperationAction[]
}
export const OPERATION_LIMIT = 250
const S = () => useStore.getState()
const stale = (): OperationResult => ({
  ok: false,
  message: 'Операция изменилась или её источник удалён. Обнови список.',
})
const result = (message: string): OperationResult => ({ ok: true, message })
const currentProject = (pid: string) => (S().authed ? S().projects.find((p) => p.id === pid) : undefined)
const currentChat = (pid: string, cid: string) => currentProject(pid)?.chats.find((c) => c.id === cid)
const key = (...parts: string[]) => JSON.stringify(parts)
export const activeOperation = (row: Pick<Operation, 'status'>) =>
  ['running', 'waiting', 'stopping'].includes(row.status)
export const attentionOperation = (row: Pick<Operation, 'status'>) =>
  ['attention', 'failed', 'interrupted'].includes(row.status)
export const terminalOperation = (row: Pick<Operation, 'status'>) =>
  ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(row.status)

function openChat(pid: string, cid: string, mid?: string): OperationAction {
  return {
    label: 'Открыть чат',
    kind: 'open',
    run: () => {
      const chat = currentChat(pid, cid)
      if (!chat || (mid && !chat.messages.some((m) => m.id === mid))) return stale()
      if (S().projectId !== pid || S().screen !== 'workspace') S().openProject(pid)
      if (!currentChat(pid, cid) || S().projectId !== pid) return stale()
      S().setCenter({ kind: 'chat', id: cid })
      S().closeModal()
      return result('Открыт исходный чат.')
    },
  }
}
function openProjectWindow(
  pid: string,
  type: 'deploy' | 'recovery' | 'settings',
  section?: string,
): OperationAction {
  return {
    label: type === 'deploy' ? 'Открыть запуски' : type === 'recovery' ? 'Восстановление' : 'Подробнее',
    kind: 'open',
    run: () => {
      if (!currentProject(pid)) return stale()
      if (S().projectId !== pid || S().screen !== 'workspace') S().openProject(pid)
      if (!currentProject(pid) || S().projectId !== pid) return stale()
      S().openModal(type === 'settings' ? { type, section } : { type })
      return result('Открыт исходный проект.')
    },
  }
}
const bounded = (s: string) => s.slice(0, 160)
const recentAgent = (messages: readonly Message[]) => {
  for (let i = messages.length - 1, stop = Math.max(0, messages.length - 20); i >= stop; i--) {
    const message = messages[i]
    if (message?.kind === 'agent') return message
  }
}
const recentParts = (m: Extract<Message, { kind: 'agent' }>) => m.parts?.slice(-50) || []
const agentStage = (m: Extract<Message, { kind: 'agent' }>) => {
  const parts = recentParts(m)
  return parts.some((p) => p.k === 'cmd' && p.state === 'running')
    ? 'Выполняет команду'
    : parts.some((p) => p.k === 'file' && p.state === 'writing')
      ? 'Применяет правки'
      : 'Ожидает или получает ответ модели'
}

/** Project hashes are computed outside this synchronous read-only projection. */
export function collectOperations(projectHashes: Readonly<Record<string, string>> = {}): {
  rows: Operation[]
  truncated: boolean
} {
  const state = S(),
    rows: Operation[] = []
  if (!state.authed) return { rows, truncated: false }
  const queues = useQueue.getState(),
    loops = useLoops.getState()
  let truncated = false
  const priority = (r: Operation) => (activeOperation(r) ? 0 : attentionOperation(r) ? 1 : 2)
  const add = (row: Operation) => {
    if (rows.length < OPERATION_LIMIT) {
      rows.push(row)
      return
    }
    truncated = true
    if (priority(row) === 2) return
    for (let i = rows.length - 1; i >= 0; i--)
      if (priority(rows[i]) > priority(row)) {
        rows[i] = row
        break
      }
  }
  // Two passes keep current runtime controls before bounded history.
  for (const p of state.projects.slice(0, 500)) {
    for (const c of p.chats.slice(0, 200)) {
      const ctl = captureTurnControl(c.id, p.id)
      const last = ctl ? recentAgent(c.messages) : undefined
      if (ctl)
        add({
          id: key('agent', p.id, c.id),
          kind: 'agent',
          status: ctl.phase === 'stopping' ? 'stopping' : ctl.phase === 'queued' ? 'waiting' : 'running',
          projectId: p.id,
          project: p.name,
          title: bounded(c.title),
          detail:
            ctl.phase === 'stopping'
              ? 'Остановка запрошена; завершение ещё не подтверждено.'
              : ctl.phase === 'queued'
                ? 'Подготовлен следующий элемент очереди.'
                : last
                  ? agentStage(last)
                  : 'Ход агента',
          at: last?.startedAt,
          progress: JSON.stringify([
            last?.id,
            last?.chars,
            last?.text.length,
            last &&
              recentParts(last).map((x) =>
                x.k === 'cmd' ? [x.state, x.out?.length] : x.k === 'file' ? x.state : x.k,
              ),
          ]),
          actions: [
            openChat(p.id, c.id),
            ...(ctl.phase === 'stopping'
              ? []
              : [
                  {
                    label: 'Остановить ход',
                    kind: 'cancel' as const,
                    run: () =>
                      ctl.cancel()
                        ? result('Остановка запрошена. Очередь сохранена; завершение проверяй по статусу.')
                        : stale(),
                  },
                ]),
          ],
        })
      else if (c.running)
        add({
          id: key('orphan', p.id, c.id),
          kind: 'agent',
          status: 'attention',
          projectId: p.id,
          project: p.name,
          title: bounded(c.title),
          detail: 'В снимке есть признак работы, но живого исполнителя нет. Продолжение не подтверждено.',
          progress: 'unknown',
          actions: [openChat(p.id, c.id)],
        })
      const queue = queueFor(queues, p.id, c.id)
      if (queue.length)
        add({
          id: key('queue', p.id, c.id),
          kind: 'queue',
          status: 'waiting',
          projectId: p.id,
          project: p.name,
          title: bounded(c.title),
          detail: `Сообщений в очереди: ${queue.length}. Текст остаётся в исходном чате.`,
          progress: String(queue.length),
          actions: [
            openChat(p.id, c.id),
            {
              label: 'Снять очередь',
              kind: 'cancel',
              confirm:
                'Удалить ожидающие сообщения из этой очереди? Это не остановит текущий ход. Новые элементы, добавленные после открытия подтверждения, не будут удалены.',
              run: () => {
                if (!currentChat(p.id, c.id) || queueFor(useQueue.getState(), p.id, c.id) !== queue)
                  return stale()
                clearQueue(c.id, p.id)
                return result('Ожидающая очередь очищена.')
              },
            },
          ],
        })
      const loop = loopFor(loops, p.id, c.id)
      if (loop)
        add({
          id: key('loop', p.id, c.id),
          kind: 'loop',
          status: loop.phase === 'wait' ? 'waiting' : 'running',
          projectId: p.id,
          project: p.name,
          title: bounded(loop.title),
          detail: `Проход ${loop.n}${loop.max ? ' из ' + loop.max : ''}${loop.phase === 'wait' ? ' · ожидание следующего прохода' : ''}. Задача и контекст остаются в чате.`,
          at: loop.startedAt,
          progress: JSON.stringify([loop.n, loop.phase, loop.nextAt]),
          actions: [
            openChat(p.id, c.id),
            {
              label: 'Отключить цикл',
              kind: 'cancel',
              run: () => {
                if (loopFor(useLoops.getState(), p.id, c.id) !== loop || !currentChat(p.id, c.id))
                  return stale()
                return loopStop(c.id, 'отключён в центре операций', p.id)
                  ? result('Следующие проходы отключены. Уже идущий ход при необходимости останови отдельно.')
                  : stale()
              },
            },
          ],
        })
    }
    for (const r of p.deploy.runs.slice(0, 20)) {
      const ctl = capturePipelineControl(p.id, r.id)
      const phase = ctl
        ? ctl.stopping
          ? 'stopping'
          : 'running'
        : r.status === 'running'
          ? 'attention'
          : r.status === 'ok'
            ? 'succeeded'
            : 'failed'
      add({
        id: key('pipeline', p.id, r.id),
        kind: 'pipeline',
        status: phase,
        projectId: p.id,
        project: p.name,
        title: bounded(r.pipeline || 'Пайплайн'),
        detail: ctl
          ? 'Командный пайплайн. Остановка — запрос отмены, не доказательство остановки дерева процессов.'
          : r.status === 'running'
            ? 'Живой исполнитель не найден. Состояние старого запуска не подтверждено.'
            : r.status === 'ok'
              ? 'Запуск завершён. Логи доступны в исходном проекте.'
              : 'Запуск завершился без успеха. Проверь логи и актуальный YAML перед ручным повтором.',
        at: r.at,
        progress: JSON.stringify(r.steps.map((s) => s.state)),
        actions: [
          openProjectWindow(p.id, 'deploy'),
          ...(ctl && !ctl.stopping
            ? [
                {
                  label: 'Остановить пайплайн',
                  kind: 'cancel' as const,
                  run: () =>
                    ctl.cancel()
                      ? result('Отмена запрошена. Дождись завершения; незавершённые эффекты не откатываются.')
                      : stale(),
                },
              ]
            : []),
        ],
      })
    }
    const h = captureSyncHealth(p.id),
      label = syncHealthLabel(h)
    if (
      ['checking', 'pending', 'partial', 'error'].includes(h.disk) ||
      ['failed', 'pending'].includes(h.checkpoint)
    ) {
      const epoch = captureBackendContextRevision(),
        revision = getTokenRevision()
      const actions: OperationAction[] = [openProjectWindow(p.id, 'settings', 'backend')]
      if (h.conflicts) actions.push(openProjectWindow(p.id, 'recovery'))
      if (h.canRetry)
        actions.push({
          label: 'Повторить безопасно',
          kind: 'retry',
          run: async () => {
            if (
              !currentProject(p.id) ||
              S().projectId !== p.id ||
              epoch !== captureBackendContextRevision() ||
              revision !== getTokenRevision()
            )
              return stale()
            await retryProjectSync(p.id)
            if (
              S().projectId !== p.id ||
              epoch !== captureBackendContextRevision() ||
              revision !== getTokenRevision()
            )
              return stale()
            const latest = syncHealthLabel(captureSyncHealth(p.id))
            return result(latest.text + '. ' + latest.detail)
          },
        })
      add({
        id: key('sync', p.id),
        kind: 'sync',
        status:
          h.disk === 'checking' || h.checkpoint === 'pending'
            ? 'running'
            : h.disk === 'pending'
              ? 'waiting'
              : 'attention',
        projectId: p.id,
        project: p.name,
        title: label.text,
        detail: label.detail,
        progress: JSON.stringify([h.disk, h.checkpoint, h.failedFiles, h.conflicts]),
        actions,
      })
    }
  }
  for (const ctl of captureRetryControls()) {
    const p = currentProject(ctl.pid),
      c = currentChat(ctl.pid, ctl.chatId)
    if (!p || !c) continue
    add({
      id: key('command', ctl.pid, ctl.chatId, ctl.msgId, ctl.partId),
      kind: 'command',
      status: ctl.stopping ? 'stopping' : 'running',
      projectId: p.id,
      project: p.name,
      title: bounded(c.title),
      detail: ctl.stopping
        ? 'Остановка повторной команды запрошена; завершение не подтверждено.'
        : 'Повтор команды из исходной карточки. Сама команда и вывод остаются в чате.',
      progress: ctl.stopping ? 'stopping' : 'running',
      actions: [
        openChat(p.id, c.id, ctl.msgId),
        ...(ctl.stopping
          ? []
          : [
              {
                label: 'Остановить команду',
                kind: 'cancel' as const,
                run: () =>
                  ctl.cancel()
                    ? result('Отмена повторной команды запрошена. Дождись завершения в исходной карточке.')
                    : stale(),
              },
            ]),
      ],
    })
  }
  for (const p of state.projects.slice(0, 500))
    for (const c of p.chats.slice(0, 200)) {
      for (const m of c.messages.slice(-20).reverse()) {
        if (m.kind !== 'agent' || m.streaming) continue
        const pending = m.parts?.filter((x) => x.k === 'file' && x.state === 'proposed').length || 0
        if (pending)
          add({
            id: key('review', p.id, c.id, m.id),
            kind: 'review',
            status: 'attention',
            projectId: p.id,
            project: p.name,
            title: bounded(c.title),
            detail: `Правок ждут решения: ${pending}. Применение — только в исходном чате.`,
            at: m.endedAt || m.at,
            progress: String(pending),
            actions: [openChat(p.id, c.id, m.id)],
          })
        else if (m.endedAt || m.error || m.stopped)
          add({
            id: key('history', p.id, c.id, m.id),
            kind: 'agent',
            status: m.stopped ? 'cancelled' : m.error ? 'failed' : 'succeeded',
            projectId: p.id,
            project: p.name,
            title: bounded(c.title),
            detail: m.stopped
              ? 'Ход остановлен. Ответ и правки доступны в чате.'
              : m.error
                ? 'Ход завершился с ошибкой. Открой ответ перед ручным повтором.'
                : 'Ход завершён. Это не подтверждение проверки всех правок или их записи на диск.',
            at: m.endedAt || m.at,
            progress: 'terminal',
            actions: [openChat(p.id, c.id, m.id)],
          })
      }
    }
  for (const r of useAutomationJournal.getState().runs) {
    const pid = projectHashes[r.project],
      p = pid ? currentProject(pid) : undefined
    const actions: OperationAction[] = []
    if (p) {
      actions.push(openProjectWindow(p.id, 'settings', 'automations'))
      if (r.outcome !== 'running')
        actions.push({
          label: 'Повторить…',
          kind: 'retry',
          confirm:
            'Повторить актуальную разрешённую автоматизацию? Может потратить токены или изменить проект. Файловый/задачный контекст не восстанавливается. Пауза не снимается автоматически.',
          run: async () => {
            if (
              S().projectId !== p.id ||
              !currentProject(p.id) ||
              useAutomationJournal.getState().runs.find((x) => x.id === r.id) !== r
            )
              return stale()
            const response = await retryAutomation(p.id, r.id)
            return { ok: response.ok, message: response.note }
          },
        })
    }
    add({
      id: key('automation', r.id),
      kind: 'automation',
      status: r.outcome === 'blocked' ? 'attention' : r.outcome,
      projectId: p?.id,
      project: p?.name || 'Проект не определён в этом снимке',
      title: 'Автоматизация',
      detail: runReasonText[r.reason],
      at: r.at,
      progress: r.outcome,
      actions,
    })
  }
  if (state.projects.length > 500 || state.projects.some((p) => p.chats.length > 200)) truncated = true
  rows.sort((a, b) => priority(a) - priority(b) || (b.at || 0) - (a.at || 0) || a.id.localeCompare(b.id))
  return { rows, truncated }
}

export interface ProgressObservation {
  token: string
  since: number
}
/** Advisory evidence observed while the window is open; never diagnoses a hang or cancels work. */
export function observeProgress(
  rows: readonly Operation[],
  previous: ReadonlyMap<string, ProgressObservation>,
  now: number,
) {
  const next = new Map<string, ProgressObservation>(),
    quiet = new Set<string>()
  for (const row of rows) {
    if (row.status !== 'running' && row.status !== 'stopping') continue
    const old = previous.get(row.id)
    const observation =
      old && old.token === row.progress && old.since <= now ? old : { token: row.progress, since: now }
    next.set(row.id, observation)
    if (now - observation.since >= 120_000) quiet.add(row.id)
  }
  return { next, quiet }
}
