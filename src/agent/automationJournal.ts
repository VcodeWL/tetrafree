/* Durable bounded whitelist. Never persist prompts, paths, display names, contexts or exception text. */
import { create } from 'zustand'
import { notifyAutomation, registerAutomationStopper, type AutomationOutcome } from './automationControl'

export const JOURNAL_KEY = 'tf-automation-journal-v1'
export const HISTORY_LIMIT = 100
export type RunReason =
  'complete' | 'error' | 'stopped' | 'restart' | 'budget' | 'tariff' | 'dispatch' | 'review'
export interface AutomationRun {
  id: string
  identity: string
  project: string
  approval: string
  at: number
  ended?: number
  outcome: 'running' | AutomationOutcome
  reason: RunReason
  model: string
  estimate: number | null
  reserved: number
}
interface Journal {
  version: 1
  runs: AutomationRun[]
  month: string
  totals: Record<string, number>
}
const reasons: RunReason[] = [
  'complete',
  'error',
  'stopped',
  'restart',
  'budget',
  'tariff',
  'dispatch',
  'review',
]
const outcomes = ['running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'blocked']
const models = ['локальная', 'opus', 'sonnet', 'haiku', 'gpt-4', 'gpt-5', 'другая модель']
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
export const monthOf = (now = Date.now()) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export const modelFamily = (mid: string, local: boolean) =>
  local
    ? 'локальная'
    : ['opus', 'sonnet', 'haiku'].find((s) => mid.toLowerCase().includes(s)) ||
      (/gpt-?5/i.test(mid) ? 'gpt-5' : /gpt-?4/i.test(mid) ? 'gpt-4' : 'другая модель')
const empty = (): Journal => ({ version: 1, runs: [], month: monthOf(), totals: {} })
function decode(raw: string): Journal {
  const j = JSON.parse(raw)
  if (
    j.version !== 1 ||
    !Array.isArray(j.runs) ||
    j.runs.length > HISTORY_LIMIT ||
    !/^\d{4}-\d{2}$/.test(j.month) ||
    !j.totals ||
    typeof j.totals !== 'object' ||
    Object.keys(j.totals).length > 1000
  )
    throw Error()
  const runs = j.runs.map((r: AutomationRun): AutomationRun => {
    if (
      !/^[a-f0-9-]{16,50}$/.test(r.id) ||
      !hex(r.project) ||
      !hex(r.identity) ||
      !hex(r.approval) ||
      !num(r.at) ||
      !outcomes.includes(r.outcome) ||
      !reasons.includes(r.reason) ||
      !models.includes(r.model) ||
      (r.estimate !== null && !num(r.estimate)) ||
      !num(r.reserved) ||
      (r.ended !== undefined && !num(r.ended))
    )
      throw Error()
    return {
      id: r.id,
      project: r.project,
      identity: r.identity,
      approval: r.approval,
      at: r.at,
      ended: r.outcome === 'running' ? Date.now() : r.ended,
      outcome: r.outcome === 'running' ? 'interrupted' : r.outcome,
      reason: r.outcome === 'running' ? 'restart' : r.reason,
      model: r.model,
      estimate: r.outcome === 'running' ? null : r.estimate,
      reserved: r.reserved,
    }
  })
  const totals: Record<string, number> = {}
  for (const [k, v] of Object.entries(j.totals)) {
    if (!hex(k) || !num(v)) throw Error()
    totals[k] = v
  }
  return { version: 1, runs, month: j.month, totals }
}
let journal = empty()
let unavailable = false
try {
  const raw = localStorage.getItem(JOURNAL_KEY)
  if (raw) {
    journal = decode(raw)
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
  }
} catch {
  unavailable = true
}
export const useAutomationJournal = create(() => ({ ...journal, unavailable }))
function persist(next: Journal): boolean {
  if (unavailable) return false // Preserve unknown/corrupt data instead of replacing it.
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(next))
    journal = next
    useAutomationJournal.setState({ ...journal, unavailable: false })
    return true
  } catch {
    unavailable = true
    try {
      useAutomationJournal.setState({ unavailable: true })
    } catch {
      /* Reporting failure must not reject detached work. */
    }
    return false
  }
}
export async function automationIdentity(pid: string, autoId: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([pid, autoId])))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export function beginAutomation(
  project: string,
  identity: string,
  approval: string,
  model: string,
): string | null {
  if (!hex(project) || !hex(identity) || !hex(approval) || !models.includes(model)) return null
  const run: AutomationRun = {
    id: crypto.randomUUID(),
    project,
    identity,
    approval,
    model,
    at: Date.now(),
    outcome: 'running',
    reason: 'dispatch',
    estimate: 0,
    reserved: 0,
  }
  // Never evict a live run; bounded failure is safer than losing its reservation.
  const live = journal.runs.filter((r) => r.outcome === 'running')
  if (live.length >= HISTORY_LIMIT) return null
  const old = journal.runs.filter((r) => r.outcome !== 'running').slice(0, HISTORY_LIMIT - live.length - 1)
  return persist({ ...journal, runs: [run, ...live, ...old] }) ? run.id : null
}
export function reserveAutomation(
  id: string,
  usd: number | null,
  limits: { run?: number; month?: number; global?: number; spent?: number },
): RunReason | null {
  const r = journal.runs.find((x) => x.id === id && x.outcome === 'running')
  if (!r || unavailable) return 'dispatch'
  if (usd !== null && !num(usd)) return 'tariff'
  const capped = !!(limits.run || limits.month || limits.global)
  if (usd === null && capped) return 'tariff'
  const month = monthOf()
  const totals = month === journal.month ? { ...journal.totals } : {}
  const add = usd ?? 0
  const all = Object.values(totals).reduce((a, b) => a + b, 0)
  if (
    (limits.run && r.reserved + add > limits.run) ||
    (limits.month && (totals[r.identity] || 0) + add > limits.month) ||
    (limits.global && Math.max(limits.spent || 0, 0) + all + add > limits.global)
  )
    return 'budget'
  if (!(r.identity in totals) && Object.keys(totals).length >= 1000) return 'budget'
  totals[r.identity] = (totals[r.identity] || 0) + add
  const runs = journal.runs.map((x) =>
    x.id === id ? { ...x, reserved: x.reserved + add, estimate: usd === null ? null : x.estimate } : x,
  )
  return persist({ ...journal, month, totals, runs }) ? null : 'dispatch'
}
export function finishAutomation(
  id: string,
  outcome: AutomationOutcome,
  reason: RunReason,
  estimate?: number | null,
) {
  const run = journal.runs.find((r) => r.id === id)
  if (!run || run.outcome !== 'running') return
  const amount = estimate === null ? null : num(estimate) ? estimate : run.estimate
  const runs = journal.runs.map((r) =>
    r.id === id ? { ...r, outcome, reason, ended: Date.now(), estimate: amount } : r,
  )
  if (persist({ ...journal, runs })) notifyAutomation(outcome)
}
export const runReasonText: Record<RunReason, string> = {
  complete: 'Завершено',
  review: 'Ответ завершён; правки ждут решения в чате',
  error: 'Ошибка модели или инструмента. Проверь чат и подключение.',
  stopped: 'Остановлено пользователем или сменой проекта',
  restart: 'Прервано перезапуском приложения; само не продолжится',
  budget: 'Не хватает оценочного бюджета на следующий запрос',
  tariff: 'Тариф неизвестен: контроль расходов невозможен',
  dispatch: 'Не удалось отправить запрос или сохранить журнал',
}

registerAutomationStopper(() => {
  for (const r of [...journal.runs])
    if (r.outcome === 'running') finishAutomation(r.id, 'cancelled', 'stopped', null)
})
