import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Actor, Chat, Doc, ID } from '../types'
import { initialPersisted, initialUI } from './defaults'
import { PERSIST_VERSION, debouncedStorage, merge, migrate, partialize } from './persistence'
import { chatsActions } from './slices/chats'
import { docsActions } from './slices/docs'
import { filesActions } from './slices/files'
import { memoryActions } from './slices/memory'
import { projectsActions } from './slices/projects'
import { settingsActions } from './slices/settings'
import { tasksActions } from './slices/tasks'
import { uiActions } from './slices/ui'
import type { Actions, Full, S, Toast } from './types'

export type { Actions, BuildSummary, ModalState, Toast } from './types'
export { pickFile } from './helpers'

/**
 * Единый стор приложения. Состояние — в types.ts/defaults.ts, действия разложены по доменам в slices/:
 * ui (экраны, модалки, тосты), projects, files (файлы, корзина, версии), chats, docs, tasks, settings (люди, провайдеры), memory.
 * Новая мутация = новая запись в Actions (types.ts) + реализация в нужном слайсе. Схема хранения — persistence.ts.
 */
export const useStore = create<S & Actions>()(
  persist(
    immer((set, get) => ({
      ...initialPersisted(),
      ...initialUI(),
      ...uiActions(set, get),
      ...projectsActions(set),
      ...filesActions(set),
      ...chatsActions(set),
      ...docsActions(set),
      ...tasksActions(set, get),
      ...settingsActions(set),
      ...memoryActions(set),
    })),
    {
      name: 'tetrafree',
      version: PERSIST_VERSION,
      storage: debouncedStorage(() =>
        useStore.getState().toast({
          title: 'Локальное хранилище заполнено',
          desc: 'Последние изменения не сохранятся после перезапуска. Удали старые проекты или экспортируй их в архив.',
          tone: 'err',
          icon: 'warn',
        }),
      ),
      partialize,
      merge: (persisted, current) => merge(persisted, current as Full),
      migrate: (old, from) => migrate(old, from) as Full,
    },
  ),
)

/* ---------- селекторы ---------- */
export const useProject = () => useStore((s) => s.projects.find((p) => p.id === s.projectId))
export const getProject = () => {
  const s = useStore.getState()
  return s.projects.find((p) => p.id === s.projectId)
}
export const getChat = (pid: ID, chatId: ID) =>
  useStore
    .getState()
    .projects.find((p) => p.id === pid)
    ?.chats.find((c) => c.id === chatId)
export const toast = (t: Omit<Toast, 'id'>) => useStore.getState().toast(t)
export const actorName = (a: Actor | null | undefined, people = useStore.getState().people) =>
  !a ? 'не назначена' : a.kind === 'agent' ? a.name : people[a.id]?.name || 'участник'
export type { Doc, Chat }
