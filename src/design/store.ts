import { create } from 'zustand'
import type { FilePreimage } from '../lib/filePreimage'
import type { Path } from './dom'

export type SubMode = 'canvas' | 'preview' | 'code'
export type Device = 'desktop' | 'tablet' | 'mobile'
export const DEVICE_W: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 }
export const DEVICE_RU: Record<Device, string> = { desktop: 'Десктоп', tablet: 'Планшет', mobile: 'Телефон' }

export interface DesignHistoryEntry {
  pid: string
  page: string
  before: string
  after: string
  expected: FilePreimage
  lineage: object
}

interface D {
  pid: string | null
  page: string | null
  sub: SubMode
  sel: Path | null
  hover: Path | null
  editing: boolean
  frames: Device[]
  previewDevice: Device
  zoom: number
  pan: { x: number; y: number }
  fit: boolean
  rev: number // меняется при любой правке DOM — перерисовка слоёв и инспектора
  doc: Document | null
  undo: DesignHistoryEntry[]
  redo: DesignHistoryEntry[]
  saved: number
  leftTab: 'layers' | 'pages'
  grid: boolean
  tool: 'select' | 'hand'
  set: (p: Partial<D>) => void
  bump: () => void
}
export const useDesign = create<D>((set) => ({
  pid: null,
  page: null,
  sub: 'canvas',
  sel: null,
  hover: null,
  editing: false,
  frames: ['desktop', 'mobile'],
  previewDevice: 'desktop',
  zoom: 0.5,
  pan: { x: 40, y: 40 },
  fit: true,
  rev: 0,
  doc: null,
  undo: [],
  redo: [],
  saved: 0,
  leftTab: 'layers',
  grid: false,
  tool: 'select',
  set: (p) => set(p),
  bump: () => set((s) => ({ rev: s.rev + 1 })),
}))
