import { create } from 'zustand'
import type { IconName } from '../components/ui/Icon'

/* Журнал уведомлений: всплывающий тост живёт 3 секунды, а история остаётся — можно перечитать, что промелькнуло. */
export interface Notif {
  id: string
  title: string
  desc?: string
  icon?: IconName
  tone?: 'ok' | 'warn' | 'err'
  at: number
  read: boolean
}
interface S {
  items: Notif[]
  add: (n: Omit<Notif, 'id' | 'at' | 'read'>) => void
  readAll: () => void
  clear: () => void
}

export const useNotifs = create<S>((set) => ({
  items: [],
  add: (n) =>
    set((s) => ({
      items: [
        { ...n, id: Math.random().toString(36).slice(2), at: Date.now(), read: false },
        ...s.items,
      ].slice(0, 40),
    })),
  readAll: () =>
    set((s) => (s.items.some((i) => !i.read) ? { items: s.items.map((i) => ({ ...i, read: true })) } : s)),
  clear: () => set({ items: [] }),
}))
