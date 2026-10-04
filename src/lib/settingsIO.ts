/* Перенос настроек между компьютерами: только внешний вид и поведение. Ключи провайдеров, адрес сервера и данные аккаунта в файл не попадают. */
import type { Settings } from '../types'
import { ACTIONS, check, effective } from './keymap'
import { UI_FONTS, CODE_FONTS } from './fonts'

export const FORMAT = 'tetrafree-settings'

const BOOL = [
  'showOnline',
  'notifyEscalations',
  'osNotify',
  'accents',
  'ambient',
  'reducedMotion',
  'enterToSend',
  'followAgent',
  'backendSync',
  'autoVerify',
  'autoBackup',
] as const

/** оставляет только известные поля с допустимыми значениями; всё остальное молча отбрасывается */
export function sanitize(raw: unknown): Partial<Settings> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of BOOL) if (typeof r[k] === 'boolean') out[k] = r[k]
  if (['dark', 'light', 'system'].includes(r.theme as string)) out.theme = r.theme
  if (['comfortable', 'compact'].includes(r.density as string)) out.density = r.density
  if ([11.5, 12.5, 14].includes(r.codeSize as number)) out.codeSize = r.codeSize
  if (['calm', 'gradient'].includes(r.look as string)) out.look = r.look
  if (UI_FONTS.some((f) => f.k === r.uiFont)) out.uiFont = r.uiFont
  if (CODE_FONTS.some((f) => f.k === r.codeFont)) out.codeFont = r.codeFont
  if (typeof r.budget === 'number' && isFinite(r.budget) && r.budget >= 0 && r.budget < 1e6)
    out.budget = r.budget
  if (r.priceCustom && typeof r.priceCustom === 'object') {
    const pc: Record<string, { inp: number; out: number }> = {}
    for (const [id, v] of Object.entries(r.priceCustom as Record<string, { inp?: unknown; out?: unknown }>)) {
      if (
        id.length < 80 &&
        v &&
        typeof v.inp === 'number' &&
        typeof v.out === 'number' &&
        v.inp >= 0 &&
        v.out >= 0 &&
        v.inp < 1e5 &&
        v.out < 1e5
      )
        pc[id] = { inp: v.inp, out: v.out }
    }
    if (Object.keys(pc).length) out.priceCustom = pc
  }
  if (r.keys && typeof r.keys === 'object') {
    const ks: Record<string, string> = {}
    for (const [id, c] of Object.entries(r.keys as Record<string, unknown>)) {
      if (typeof c !== 'string' || !ACTIONS.some((a) => a.id === id)) continue
      if (!check({ ...effective(), ...ks }, id, c)) ks[id] = c
    }
    if (Object.keys(ks).length) out.keys = ks
  }
  return out as Partial<Settings>
}

export function build(s: Settings) {
  return { app: FORMAT, v: 1, at: new Date().toISOString(), settings: sanitize(s) }
}

/** разбор файла; бросает понятную ошибку */
export function parse(text: string): Partial<Settings> {
  let j: { app?: string; settings?: unknown }
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error('Это не JSON-файл')
  }
  if (j?.app !== FORMAT) throw new Error('Это не файл настроек TetraFree')
  const s = sanitize(j.settings)
  if (!Object.keys(s).length) throw new Error('В файле нет подходящих настроек')
  return s
}
