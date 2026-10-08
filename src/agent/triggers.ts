/* Триггеры пайплайнов: какие из них запускать после события. Чистая логика — запуск в ci.ts. */
export type TriggerEvent = 'version' | 'commit'

/** `version` — появилась новая версия проекта (правки агента или редактора), `commit` — git-коммит из панели Git;
    `push` — любое из двух. `manual`, `tag` и прочее автоматически не запускаются. */
export const matchesTrigger = (trigger: string[], ev: TriggerEvent): boolean =>
  trigger.some((t) => t === ev || t === 'push')

export const pipelinesFor = <T extends { trigger: string[]; steps: unknown[] }>(
  defs: T[],
  ev: TriggerEvent,
): T[] => defs.filter((d) => d.steps.length > 0 && matchesTrigger(d.trigger, ev))

/** Расписание пайплайна: `schedule: every 30m`, `every 2h` (не чаще раза в 5 минут) или `daily 09:30` (по местному времени) */
export type Schedule = { kind: 'every'; ms: number } | { kind: 'daily'; h: number; m: number }

export function parseSchedule(src?: string): Schedule | null {
  /* допускаем кавычки и комментарий в конце строки: `schedule: "every 30m"  # раз в полчаса` */
  const s = (src || '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
    .toLowerCase()
  let m = /^every\s+(\d{1,4})\s*(m|min|h)$/.exec(s)
  if (m) {
    const ms = +m[1] * (m[2] === 'h' ? 3600e3 : 60e3)
    return ms >= 5 * 60e3 && ms <= 30 * 24 * 3600e3 ? { kind: 'every', ms } : null
  }
  m = /^daily\s+(\d{1,2}):(\d{2})$/.exec(s)
  if (m && +m[1] < 24 && +m[2] < 60) return { kind: 'daily', h: +m[1], m: +m[2] }
  return null
}

export const describeSchedule = (s: Schedule) =>
  s.kind === 'daily'
    ? `каждый день в ${String(s.h).padStart(2, '0')}:${String(s.m).padStart(2, '0')}`
    : s.ms % 3600e3 === 0
      ? `каждые ${s.ms / 3600e3} ч`
      : `каждые ${s.ms / 60e3} мин`

/** Пора ли запускать. last = 0 — расписание только что увидели: сначала запоминаем момент, пропущенное задним числом не запускаем. */
export function scheduleDue(s: Schedule, last: number, now: number): boolean {
  if (!last) return false
  if (s.kind === 'every') return now - last >= s.ms
  const occ = new Date(now)
  occ.setHours(s.h, s.m, 0, 0)
  if (occ.getTime() > now) occ.setDate(occ.getDate() - 1)
  return last < occ.getTime()
}

/** Когда расписание сработает в следующий раз (last = 0 — отсчёт ещё не начался: ждём один интервал от now). */
export function nextRun(s: Schedule, last: number, now: number): number {
  if (s.kind === 'every') return (last || now) + s.ms
  const occ = new Date(now)
  occ.setHours(s.h, s.m, 0, 0)
  if (last && last < occ.getTime() && occ.getTime() <= now) return now
  if (occ.getTime() <= now) occ.setDate(occ.getDate() + 1)
  return occ.getTime()
}
