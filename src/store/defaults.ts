import type { Settings } from '../types'
import { BLANK_ME, ME } from '../data/seed'
import type { Persisted, UI } from './types'

export const DEFAULT_SETTINGS: Settings = {
  showOnline: true,
  notifyEscalations: true,
  accents: true,
  ambient: true,
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  enterToSend: true,
}

export const initialPersisted = (): Persisted => ({
  authed: false,
  people: { [ME]: { ...BLANK_ME } },
  projects: [],
  providers: [],
  settings: { ...DEFAULT_SETTINGS },
  model: '',
  rightWidth: 46,
  taskView: 'board',
  lastProject: null,
  sort: 'recent',
})
export const initialUI = (): UI => ({
  screen: 'auth',
  authMode: 'signin',
  projectId: null,
  center: { kind: 'empty' },
  mode: 'dev',
  rightOpen: true,
  rightTab: 'code',
  activeFile: null,
  dirty: {},
  closedDirs: {},
  viewVersion: {},
  modal: null,
  palette: false,
  toasts: [],
  summary: null,
  sideOpen: false,
  drafts: {},
  dock: false,
  sideHidden: false,
})
