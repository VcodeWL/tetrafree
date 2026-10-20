/* Автоматизации: «когда случилось X — сделай Y». Лежат файлом `.tetra/automations.json` в проекте и едут вместе с ним.
     { "automations": [
        { "name": "Утренняя сводка", "when": { "daily": "09:00" }, "do": { "agent": "Сделай сводку изменений за вчера" } },
        { "name": "Тесты при правках", "when": { "files": "docs/*.md" }, "do": { "agent": "Запусти тесты: {{files}}", "tier": "Уведомить" } },
        { "name": "Готово!", "when": { "task": "done" }, "do": { "notify": "Закрыта задача: {{task}}" } } ] }
   Условия: every («30m», «2h»), daily («09:00»), files (маски), task (статус), open (проект открыт), manual (только кнопкой).
   Действия: agent (запрос агенту в отдельном чате «⚙ имя»), notify (уведомление), task (создать задачу).
   Безопасность: файл может прийти из чужого репозитория, поэтому автоматизация работает только после «Разрешить» —
   разрешение привязано к её содержимому (любая правка требует нового). Работает, пока приложение открыто и проект выбран. */
import { create } from 'zustand'
import type { Tier } from '../types'

export const AUTO_FILE = '.tetra/automations.json'
export const MIN_EVERY_MS = 60_000
/** Сколько раз одна автоматизация может сработать за час (защита от петель) */
export const MAX_PER_HOUR = 20

export type When =
  | { every: number; label: string }
  | { daily: string }
  | { files: string[] }
  | { task: string }
  | { open: true }
  | { manual: true }
export type Do = { agent: string; tier: Tier } | { notify: string } | { task: string }
export interface Auto {
  id: string
  name: string
  when: When
  do: Do
  enabled: boolean
  /** Оценочные USD: максимум резерва на запуск и на месяц. */
  costLimit?: number
  monthlyLimit?: number
  /** исходный объект — для хэша разрешения и записи обратно */
  raw: unknown
}

const TIERS = ['Тихо', 'Уведомить', 'Спросить', 'Эскалация']
const STATUSES = ['backlog', 'doing', 'review', 'done']

export function parseEvery(s: unknown): { ms: number; label: string } | null {
  const m = String(s ?? '')
    .trim()
    .toLowerCase()
    .match(/^(\d{1,4})\s*(m|min|м|мин|h|ч|d|д)$/u)
  if (!m) return null
  const n = +m[1]
  const u = m[2]
  const ms = n * (/^(h|ч)$/u.test(u) ? 3600_000 : /^(d|д)$/u.test(u) ? 86_400_000 : 60_000)
  return ms >= MIN_EVERY_MS
    ? { ms, label: `${n}${/^(h|ч)$/u.test(u) ? ' ч' : /^(d|д)$/u.test(u) ? ' дн' : ' мин'}` }
    : null
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'auto'

/** Текст файла → автоматизации и список ошибок (неверные записи пропускаются, остальные работают) */
export function parseAutomations(text: string | undefined): { list: Auto[]; errors: string[] } {
  const out = { list: [] as Auto[], errors: [] as string[] }
  if (!text || !text.trim()) return out
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch (e) {
    out.errors.push('Файл не разобрать как JSON: ' + (e as Error).message)
    return out
  }
  const arr = (j as { automations?: unknown })?.automations
  if (!Array.isArray(arr)) {
    out.errors.push('Нужен объект {"automations": [ … ]}')
    return out
  }
  const ids = new Set<string>()
  arr.forEach((r, i) => {
    const at = `Автоматизация №${i + 1}`
    if (!r || typeof r !== 'object') return out.errors.push(`${at}: ожидался объект`)
    const o = r as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : ''
    if (!name) return out.errors.push(`${at}: нужно поле name`)
    const w = o.when as Record<string, unknown> | undefined
    const d = o.do as Record<string, unknown> | undefined
    if (!w || typeof w !== 'object') return out.errors.push(`${name}: нужно поле when`)
    if (!d || typeof d !== 'object') return out.errors.push(`${name}: нужно поле do`)
    let when: When | null = null
    if (w.every !== undefined) {
      const e = parseEvery(w.every)
      if (!e) return out.errors.push(`${name}: every — например «30m» или «2h», не чаще раза в минуту`)
      when = { every: e.ms, label: e.label }
    } else if (w.daily !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(w.daily)))
        return out.errors.push(`${name}: daily — время «09:30»`)
      when = { daily: String(w.daily) }
    } else if (w.files !== undefined) {
      const g = (Array.isArray(w.files) ? w.files : [w.files]).filter(
        (x): x is string => typeof x === 'string' && !!x.trim(),
      )
      if (!g.length) return out.errors.push(`${name}: files — маска или список масок, например «src/**/*.ts»`)
      when = { files: g.map((x) => x.trim()) }
    } else if (w.task !== undefined) {
      if (!STATUSES.includes(String(w.task)))
        return out.errors.push(`${name}: task — один из ${STATUSES.join(', ')}`)
      when = { task: String(w.task) }
    } else if (w.open) when = { open: true }
    else if (w.manual) when = { manual: true }
    if (!when) return out.errors.push(`${name}: в when нужно одно из every, daily, files, task, open, manual`)
    let act: Do | null = null
    if (typeof d.agent === 'string' && d.agent.trim()) {
      const tier = d.tier === undefined ? 'Спросить' : String(d.tier)
      if (!TIERS.includes(tier)) return out.errors.push(`${name}: tier — один из ${TIERS.join(', ')}`)
      act = { agent: d.agent.trim().slice(0, 4000), tier: tier as Tier }
    } else if (typeof d.notify === 'string' && d.notify.trim())
      act = { notify: d.notify.trim().slice(0, 300) }
    else if (typeof d.task === 'string' && d.task.trim()) act = { task: d.task.trim().slice(0, 200) }
    if (!act) return out.errors.push(`${name}: в do нужно одно из agent, notify, task (непустой текст)`)
    for (const field of ['costLimit', 'monthlyLimit']) {
      if (
        o[field] !== undefined &&
        (typeof o[field] !== 'number' || !Number.isFinite(o[field]) || (o[field] as number) <= 0)
      )
        return out.errors.push(`${name}: ${field} — положительное число USD`)
    }
    let id = slug(name)
    for (let n = 2; ids.has(id); n++) id = slug(name) + '-' + n
    ids.add(id)
    out.list.push({
      id,
      name,
      when,
      do: act,
      enabled: o.enabled !== false,
      costLimit: o.costLimit as number | undefined,
      monthlyLimit: o.monthlyLimit as number | undefined,
      raw: r,
    })
  })
  return out
}

/* ------------------------------------------------------------------ маски файлов, время, шаблоны */

export function globToRe(g: string): RegExp {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}
export const matchFiles = (globs: string[], paths: string[]) => {
  const res = globs.map(globToRe)
  return paths.filter((p) => !p.startsWith('.tetra/') && res.some((r) => r.test(p)))
}

/** Пора ли запускать по расписанию. last — когда в последний раз сработала (или момент запуска приложения) */
export function dueNow(w: When, now: number, last: number): boolean {
  if ('every' in w) return now - last >= w.every
  if ('daily' in w) {
    const [h, m] = w.daily.split(':').map(Number)
    const at = new Date(now)
    at.setHours(h, m, 0, 0)
    const t = at.getTime()
    /* пропущенное утро не догоняем: окно — час после назначенного времени */
    return now >= t && now - t < 3600_000 && last < t
  }
  return false
}

export function expand(
  t: string,
  ctx: { files?: string[]; task?: string; name: string; project: string; now: number },
): string {
  const d = new Date(ctx.now)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const vars: Record<string, string> = {
    files:
      (ctx.files || []).slice(0, 20).join(', ') +
      ((ctx.files?.length || 0) > 20 ? ` и ещё ${ctx.files!.length - 20}` : ''),
    task: ctx.task || '',
    name: ctx.name,
    project: ctx.project,
    now: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
  }
  return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (a, k: string) => (k in vars ? vars[k] : a))
}

export const describeWhen = (w: When): string =>
  'every' in w
    ? `каждые ${w.label}`
    : 'daily' in w
      ? `каждый день в ${w.daily}`
      : 'files' in w
        ? `при изменении ${w.files.join(', ')}`
        : 'task' in w
          ? `когда задача переходит в «${w.task}»`
          : 'open' in w
            ? 'при открытии проекта'
            : 'только вручную'
export const describeDo = (d: Do): string =>
  'agent' in d
    ? `агент (${d.tier}): ${d.agent.slice(0, 90)}`
    : 'notify' in d
      ? `уведомление: ${d.notify}`
      : `создать задачу: ${d.task}`

/** Хэш для разрешения: содержимое автоматизации + проект. SHA-256 */
export async function autoHash(pid: string, a: Auto): Promise<string> {
  const buf = new TextEncoder().encode(JSON.stringify([pid, a.id, a.raw]))
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ правка файла из интерфейса */

export function addAutomation(text: string | undefined, rec: Record<string, unknown>): string {
  let j: Record<string, unknown> = {}
  try {
    const v = JSON.parse(text || '{}')
    if (v && typeof v === 'object' && !Array.isArray(v)) j = v
  } catch {
    throw new Error('Файл автоматизаций повреждён — исправьте его вручную, чтобы ничего не потерять')
  }
  const list = Array.isArray(j.automations) ? (j.automations as unknown[]) : []
  return JSON.stringify({ ...j, automations: [...list, rec] }, null, 2) + '\n'
}
export function updateAutomation(
  text: string,
  id: string,
  f: (r: Record<string, unknown>) => Record<string, unknown> | null,
): string {
  const j = JSON.parse(text) as { automations: Record<string, unknown>[] }
  const { list } = parseAutomations(text)
  const idx = list.findIndex((a) => a.id === id)
  if (idx < 0) return text
  /* parseAutomations пропускает неверные записи — ищем исходную по ссылке на raw */
  const at = j.automations.findIndex((r) => JSON.stringify(r) === JSON.stringify(list[idx].raw))
  if (at < 0) return text
  const next = f(j.automations[at])
  if (next) j.automations[at] = next
  else j.automations.splice(at, 1)
  return JSON.stringify(j, null, 2) + '\n'
}

export const EXAMPLES: { title: string; rec: Record<string, unknown> }[] = [
  {
    title: 'Сводка каждое утро',
    rec: {
      name: 'Утренняя сводка',
      when: { daily: '09:00' },
      do: {
        agent:
          'Посмотри, что менялось в проекте за последние сутки (версии, git), и коротко напиши: что сделано, что сломано, что делать сегодня.',
      },
    },
  },
  {
    title: 'Тесты при правках кода',
    rec: {
      name: 'Тесты при правках',
      when: { files: ['src/**/*.ts', 'src/**/*.tsx'] },
      do: {
        agent:
          'Изменились файлы: {{files}}. Запусти тесты проекта; если что-то красное — найди причину и предложи исправление.',
        tier: 'Спросить',
      },
    },
  },
  {
    title: 'Сообщать о закрытых задачах',
    rec: { name: 'Задача закрыта', when: { task: 'done' }, do: { notify: 'Закрыта задача: {{task}}' } },
  },
  {
    title: 'Ревью раз в 2 часа',
    rec: {
      name: 'Ревью раз в два часа',
      when: { every: '2h' },
      do: {
        agent:
          'Сделай ревью последних изменений (git diff). Только замечания по делу, без вкусовщины. Код не меняй.',
        tier: 'Спросить',
      },
    },
  },
]

/* ------------------------------------------------------------------ состояние выполнения */

export interface RunInfo {
  last?: { at: number; ok: boolean; note: string }
  /** сработала за последний час (для лимита) */
  recent: number[]
  running?: boolean
}
export const useAutos = create<{ runs: Record<string, RunInfo>; approved: Record<string, true> }>(() => ({
  runs: {},
  approved: (() => {
    try {
      return JSON.parse(localStorage.getItem('tf-auto-ok') || '{}')
    } catch {
      return {}
    }
  })(),
}))
export const setApproved = (hash: string, on: boolean) =>
  useAutos.setState((s) => {
    const approved = { ...s.approved }
    if (on) approved[hash] = true
    else delete approved[hash]
    try {
      localStorage.setItem(
        'tf-auto-ok',
        JSON.stringify(
          Object.fromEntries(
            Object.keys(approved)
              .slice(-300)
              .map((k) => [k, true]),
          ),
        ),
      )
    } catch {
      /* хранилище недоступно */
    }
    return { approved }
  })

/** Можно ли запускать сейчас: лимит срабатываний в час. Чистая функция. */
export function underLimit(recent: number[], now: number): boolean {
  return recent.filter((t) => now - t < 3600_000).length < MAX_PER_HOUR
}
