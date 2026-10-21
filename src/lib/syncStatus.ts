/** Project/context-scoped observations, never an atomicity or cloud-sync certificate. */
import { create } from 'zustand'
import { useStore } from '../store'
import type { Project } from '../types'
import { captureBackendContextRevision, useBackend } from './backend'
import { getToken, getTokenRevision } from './token'
import { flushPersistence } from '../store/persistence'

export type SyncHealth = {
  projectId?: string
  backend: 'checking' | 'offline' | 'remote' | 'signed-out' | 'local'
  disk:
    | 'no-project'
    | 'unavailable'
    | 'disabled'
    | 'unchecked'
    | 'checking'
    | 'pending'
    | 'partial'
    | 'error'
    | 'verified'
  checkpoint: 'unconfirmed' | 'pending' | 'confirmed' | 'failed'
  lastDiskCheckAt?: number
  failedFiles: number
  conflicts: number
  truncated: boolean
  canRetry: boolean
}
interface Context {
  path: string | undefined
  base: string
  token: string | null
  epoch: number
  tokenRevision: number
  enabled: boolean
}
const project = (pid: string) => useStore.getState().projects.find((p) => p.id === pid)
const context = (pid: string): Context => ({
  path: project(pid)?.path,
  base: useBackend.getState().base,
  token: getToken(),
  epoch: captureBackendContextRevision(),
  tokenRevision: getTokenRevision(),
  enabled: useStore.getState().settings.backendSync !== false,
})
const same = (a: Context, b: Context) =>
  a.path === b.path &&
  a.base === b.base &&
  a.token === b.token &&
  a.epoch === b.epoch &&
  a.tokenRevision === b.tokenRevision &&
  a.enabled === b.enabled
interface Observation {
  context: Context
  running: boolean
  disk: SyncHealth['disk']
  files?: Project['files']
  dirs?: string[]
  at?: number
  failedFiles: number
  conflicts: number
  truncated: boolean
}
const observations = new Map<string, Observation>()
const checkpoints = new Map<string, { context: Context; project: Project; state: SyncHealth['checkpoint'] }>()
const checkpointFlights = new Map<string, object>()
/** Notification only. Sensitive internal contexts never enter this public store. */
export const useSyncStatus = create<{ revision: number }>(() => ({ revision: 0 }))
const notify = () => useSyncStatus.setState((s) => ({ revision: s.revision + 1 }))
export function beginSyncHealth(pid: string) {
  const record: Observation = {
    context: context(pid),
    running: true,
    disk: 'checking',
    failedFiles: 0,
    conflicts: 0,
    truncated: false,
  }
  observations.set(pid, record)
  notify()
  return record
}
/** Used only after guarded legacy folder resolution; not a general stale-result bypass. */
export function resolvedSyncHealth(pid: string, record: Observation) {
  if (observations.get(pid) === record) {
    record.context = context(pid)
    notify()
  }
}
export function finishSyncHealth(
  pid: string,
  record: Observation,
  result?: {
    failedFiles: number
    conflicts: number
    truncated: boolean
    pending: boolean
  },
) {
  if (observations.get(pid) !== record) return
  record.running = false
  if (same(record.context, context(pid)) && project(pid)) {
    record.disk = !result
      ? 'error'
      : result.failedFiles || result.truncated
        ? 'partial'
        : result.pending
          ? 'pending'
          : 'verified'
    if (result) {
      Object.assign(record, result)
      record.files = project(pid)!.files
      record.dirs = project(pid)!.dirs
      if (record.disk === 'verified') record.at = Date.now()
    }
  }
  notify()
}
export function invalidateSyncHealth(pid: string) {
  observations.delete(pid)
  checkpoints.delete(pid)
  notify()
}
/** A successful app checkpoint is NOT a disk write. Concurrent edits invalidate this observation. */
export function checkpointProject(pid: string): Promise<void> {
  const p = project(pid)
  if (!p) return Promise.reject(new Error('Проект больше не открыт'))
  const record = { context: context(pid), project: p, state: 'pending' as SyncHealth['checkpoint'] }
  checkpoints.set(pid, record)
  notify()
  const marker = {}
  checkpointFlights.set(pid, marker)
  const flight = (async () => {
    try {
      await flushPersistence()
      record.state = project(pid) === p && same(record.context, context(pid)) ? 'confirmed' : 'unconfirmed'
    } catch (error) {
      record.state = 'failed'
      throw error
    } finally {
      if (checkpointFlights.get(pid) === marker) checkpointFlights.delete(pid)
      notify()
    }
  })()
  return flight
}
/** Strict whitelist: no path, URL, token, content or arbitrary Error strings. */
export function captureSyncHealth(pid = useStore.getState().projectId || undefined): SyncHealth {
  const p = pid ? project(pid) : undefined,
    b = useBackend.getState()
  const backend: SyncHealth['backend'] =
    b.status === 'checking'
      ? 'checking'
      : b.status !== 'online'
        ? 'offline'
        : !b.info?.local
          ? 'remote'
          : !getToken()
            ? 'signed-out'
            : 'local'
  const record = pid ? observations.get(pid) : undefined
  const valid = !!pid && !!record && same(record.context, context(pid))
  const checkpoint = pid ? checkpoints.get(pid) : undefined
  const checkpointState =
    p && checkpoint && same(checkpoint.context, context(pid!)) && p === checkpoint.project
      ? checkpoint.state
      : 'unconfirmed'
  let disk: SyncHealth['disk'] = !p
    ? 'no-project'
    : backend !== 'local'
      ? 'unavailable'
      : useStore.getState().settings.backendSync === false
        ? 'disabled'
        : !valid
          ? 'unchecked'
          : record.running
            ? 'checking'
            : record.disk
  if (disk === 'verified' && (record!.files !== p!.files || record!.dirs !== p!.dirs)) disk = 'pending'
  return {
    ...(p ? { projectId: p.id } : {}),
    backend,
    disk,
    checkpoint: checkpointState,
    ...(disk === 'verified' && record?.at ? { lastDiskCheckAt: record.at } : {}),
    failedFiles: valid ? record.failedFiles : 0,
    conflicts: valid ? record.conflicts : 0,
    truncated: valid ? record.truncated : false,
    canRetry: !!p && !(valid && record.running) && !checkpointFlights.has(pid!),
  }
}
export function syncHealthLabel(h: SyncHealth): { c: string; text: string; detail: string } {
  const checkpoint =
    h.checkpoint === 'confirmed'
      ? 'Checkpoint проекта подтверждён в хранилище приложения.'
      : h.checkpoint === 'failed'
        ? 'Checkpoint не подтверждён: не закрывайте приложение до повторного сохранения или экспорта.'
        : h.checkpoint === 'pending'
          ? 'Сохраняю checkpoint проекта в хранилище приложения.'
          : 'Текущие данные в памяти приложения; checkpoint ещё не подтверждён.'
  const labels: Record<SyncHealth['disk'], [string, string, string]> = {
    'no-project': ['off', 'Нет проекта', 'Выберите проект.'],
    unavailable: [
      'off',
      h.backend === 'checking'
        ? 'Проверяю сервер…'
        : h.backend === 'signed-out'
          ? 'Диск: нужен вход'
          : h.backend === 'remote'
            ? 'Диск этого устройства недоступен'
            : 'Диск: нет связи',
      'Сверка с папкой на диске не подтверждена.',
    ],
    disabled: ['off', 'Диск: синхронизация выключена', 'Автоматическая сверка отключена в настройках.'],
    unchecked: [
      'off',
      'Диск ещё не проверен',
      'Сервер доступен, но этот проект в текущем контексте ещё не сверен.',
    ],
    checking: ['sync', 'Сверяю с диском…', 'Проверка этого проекта уже идёт; повтор не нужен.'],
    pending: [
      'sync',
      'Диск: ожидает сверки',
      'Есть несверенные изменения; безопасный повтор не сбрасывает recovery и baseline.',
    ],
    partial: [
      'err',
      'Диск: сверка неполная',
      'Не все файлы проверены или записаны. Полное совпадение не подтверждено.',
    ],
    error: [
      'err',
      'Диск: сверка не завершена',
      'Проверьте подключение и recovery-копии; можно повторить без сброса baseline.',
    ],
    verified: [
      'ok',
      'Диск: проверенные файлы совпали',
      'Сверка доступных текстовых файлов завершена. Игнорируемые и двоичные файлы не проверялись.',
    ],
  }
  const [c, text, detail] = labels[h.disk]
  return { c, text, detail: detail + ' ' + checkpoint + ' Статус не подтверждает синхронизацию облака.' }
}
