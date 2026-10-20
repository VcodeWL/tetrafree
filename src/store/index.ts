import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Actor, Chat, Doc, ID } from '../types'
import { initialPersisted, initialUI } from './defaults'
import {
  PERSIST_VERSION,
  idbStorage,
  merge,
  migrate,
  partialize,
  registerPersistenceCheckpoint,
} from './persistence'
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
const storage = idbStorage(() =>
  useStore.getState().toast({
    title: 'Не удалось сохранить состояние',
    desc: 'Последние изменения пока не сохранены. Освободи место или экспортируй проекты.',
    tone: 'err',
    icon: 'warn',
  }),
)
let hydrationError: unknown
export async function hydrateStore(): Promise<void> {
  await useStore.persist.rehydrate()
  if (hydrationError) throw hydrationError
  if (!useStore.persist.hasHydrated()) throw new Error('Загрузка состояния не завершена')
}

export const useStore = create<S & Actions>()(
  persist(
    immer((set, get, api) => {
      const publish: typeof set = (...args) => {
        storage.reserveRevision()
        return set(...args)
      }
      // Cover both slice actions and public useStore.setState, before either notifies subscribers.
      api.setState = publish
      return {
        ...initialPersisted(),
        ...initialUI(),
        ...uiActions(publish, get),
        ...projectsActions(publish),
        ...filesActions(publish),
        ...chatsActions(publish),
        ...docsActions(publish),
        ...tasksActions(publish, get),
        ...settingsActions(publish),
        ...memoryActions(publish),
      }
    }),
    {
      name: 'tetrafree',
      version: PERSIST_VERSION,
      storage,
      skipHydration: true,
      onRehydrateStorage: () => {
        hydrationError = undefined
        return (_state, error) => {
          hydrationError = error
          storage.completeHydration(error)
        }
      },
      partialize,
      merge: (persisted, current) => merge(persisted, current as Full),
      migrate: (old, from) => migrate(old, from) as Full,
    },
  ),
)

registerPersistenceCheckpoint(
  async () => {
    if (!useStore.persist.hasHydrated()) throw hydrationError || new Error('Состояние ещё не загружено')
    storage.setItem('tetrafree', { state: partialize(useStore.getState()), version: PERSIST_VERSION })
    await storage.flush()
  },
  () => storage.captureGeneration(),
  () => storage.captureRuntimeRevision(),
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
