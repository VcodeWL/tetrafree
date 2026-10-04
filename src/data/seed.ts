import type { Person, Project } from '../types'

export const ME = 'me'

/** Профиль владельца до входа в аккаунт. Имя и почту подставляет вход (signIn). */
export const BLANK_ME: Person = {
  id: ME,
  name: 'Я',
  initials: 'Я',
  email: '',
  hue: 250,
  status: 'online',
}

export interface AgentDef {
  name: string
  role: string
  glyph: 'hub' | 'pen'
}
/** Режимы работы агента (одна и та же выбранная пользователем модель; различается системный промпт) */
export const AGENTS: Record<string, AgentDef> = {
  builder: { name: 'builder', role: 'пишет код и собирает версии', glyph: 'hub' },
  designer: { name: 'designer', role: 'собирает макеты', glyph: 'pen' },
}
export const PRIMARY_AGENTS = ['builder']

export function emptyProject(p: Partial<Project> & { id: string; name: string }, now = Date.now()): Project {
  return {
    path: '',
    desc: '',
    icon: 'sparkle',
    members: [ME],
    creator: ME,
    createdAt: now,
    openedAt: now,
    template: 'Пустой',
    tools: [],
    chats: [],
    docs: [],
    tasks: [],
    taskSeq: 1,
    dirs: [],
    versions: [],
    deploy: { auto: true, runs: [] },
    lanes: [],
    memory: [],
    ...p,
    files: { ...(p.files || {}) },
  }
}
