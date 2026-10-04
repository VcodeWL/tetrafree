/* Воспроизведение хода агента по шагам: события берутся из сохранённых частей сообщения. */
import type { Part } from '../types'

export interface ReplayEv {
  part: Part
  /** мс от первого события; null — у старых сообщений времени нет */
  at: number | null
}
export const SPEEDS = [1, 2, 4] as const
export const FALLBACK_MS = 1400
export const MIN_MS = 350
export const MAX_MS = 2600

/** Итоговый текст ответа — не событие хода, а результат; в ленту попадают шаги, чтение, файлы, команды */
export function buildReplay(parts: Part[]): ReplayEv[] {
  const ev = parts.filter((p) => p.k !== 'text' || p.text.trim())
  const t0 = ev.find((p) => p.at)?.at
  return ev.map((part) => ({ part, at: t0 && part.at ? Math.max(0, part.at - t0) : null }))
}
/** Пауза перед событием i: реальный интервал, ужатый до разумного, или фиксированная при отсутствии времени */
export function delayFor(ev: ReplayEv[], i: number, speed: number): number {
  const a = ev[i - 1]?.at,
    b = ev[i]?.at
  const base = a != null && b != null ? Math.min(MAX_MS, Math.max(MIN_MS, b - a)) : FALLBACK_MS
  return Math.round(base / Math.max(1, speed))
}
export function fmtOffset(ms: number | null): string {
  if (ms == null) return ''
  const s = ms / 1000
  return s < 60
    ? `+${s.toFixed(1)} c`
    : `+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
