/* Живые буферы: то, что агент пишет прямо сейчас. Отдельный стор без persist —
   частые обновления не трогают основной стор и localStorage. */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ID } from '../types'

export interface LiveFile {
  pid: ID
  path: string
  text: string
  caret: number
  agent: string
  chatId: ID
  op: 'create' | 'edit' | 'delete'
  startedAt: number
}
interface LiveState {
  files: Record<string, LiveFile>
}
export const useLive = create<LiveState>(() => ({ files: {} }))
export const liveKey = (pid: ID, path: string) => pid + '\u0000' + path

export const live = {
  start(f: Omit<LiveFile, 'startedAt'>) {
    useLive.setState((s) => ({
      files: { ...s.files, [liveKey(f.pid, f.path)]: { ...f, startedAt: Date.now() } },
    }))
  },
  set(pid: ID, path: string, text: string, caret = text.length) {
    const k = liveKey(pid, path)
    useLive.setState((s) => (s.files[k] ? { files: { ...s.files, [k]: { ...s.files[k], text, caret } } } : s))
  },
  end(pid: ID, path: string) {
    const k = liveKey(pid, path)
    useLive.setState((s) => {
      if (!s.files[k]) return s
      const f = { ...s.files }
      delete f[k]
      return { files: f }
    })
  },
  endChat(chatId: ID) {
    useLive.setState((s) => ({
      files: Object.fromEntries(Object.entries(s.files).filter(([, v]) => v.chatId !== chatId)),
    }))
  },
}
export const useLiveFile = (pid: ID | null | undefined, path: string | null | undefined) =>
  useLive((s) => (pid && path ? s.files[liveKey(pid, path)] : undefined))
export const useLiveInProject = (pid: ID | null | undefined) =>
  useLive(useShallow((s) => Object.values(s.files).filter((f) => f.pid === pid)))
