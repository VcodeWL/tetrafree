/* Раскладка рабочего окна: ширина сайдбара и высота нижней панели. Хранится на устройстве, не в проекте. */
import { create } from 'zustand'
import { clamp } from './util'

export const SIDE = { min: 220, max: 420, def: 294 }
export const DOCK = { min: 140, max: 640, def: 280 }
const KEY = 'tf.layout'

export interface Layout {
  sideW: number
  dockH: number
  minimap: boolean
}
export const defaults = (): Layout => ({ sideW: SIDE.def, dockH: DOCK.def, minimap: true })

/** Читает сохранённое значение; мусор и выход за границы приводятся к допустимым */
export function parseLayout(raw: string | null): Layout {
  const d = defaults()
  if (!raw) return d
  try {
    const j = JSON.parse(raw) as Partial<Layout>
    const n = (v: unknown, r: { min: number; max: number; def: number }) =>
      typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), r.min, r.max) : r.def
    return { sideW: n(j.sideW, SIDE), dockH: n(j.dockH, DOCK), minimap: j.minimap !== false }
  } catch {
    return d
  }
}
/** Нижняя панель не должна съедать больше 70% окна */
export const dockMax = (winH: number) => Math.max(DOCK.min, Math.min(DOCK.max, Math.round(winH * 0.7)))

interface LayoutStore extends Layout {
  setSide(w: number): void
  setDock(h: number, winH?: number): void
  setMinimap(v: boolean): void
  reset(): void
}
const save = (l: Layout) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sideW: l.sideW, dockH: l.dockH, minimap: l.minimap }))
  } catch {
    /* хранилище недоступно */
  }
}
export const useLayout = create<LayoutStore>()((set, get) => ({
  ...parseLayout(typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)),
  setSide: (w) => {
    set({ sideW: clamp(Math.round(w), SIDE.min, SIDE.max) })
    save(get())
  },
  setDock: (h, winH = 1000) => {
    set({ dockH: clamp(Math.round(h), DOCK.min, dockMax(winH)) })
    save(get())
  },
  setMinimap: (v) => {
    set({ minimap: v })
    save(get())
  },
  reset: () => {
    set(defaults())
    save(get())
  },
}))
