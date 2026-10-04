import { uid } from '../../lib/util'
import { tomb, find } from '../helpers'
import type { SetState, Actions } from '../types'

export const memoryActions = (
  set: SetState,
): Pick<Actions, 'remember' | 'forget' | 'editMemory' | 'restoreMemory'> => ({
  remember: (m, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (p) {
        p.memory.unshift({ ...m, id: uid('mem'), at: Date.now() })
        if (p.memory.length > 60) p.memory.pop()
      }
    }),
  forget: (id) =>
    set((s) => {
      const p = find(s)
      if (p) {
        p.memory = p.memory.filter((x) => x.id !== id)
        tomb(p, id)
      }
    }),
  editMemory: (id, patch) =>
    set((s) => {
      const m = find(s)?.memory.find((x) => x.id === id)
      if (m) {
        if (patch.text !== undefined) m.text = patch.text.trim().slice(0, 500)
        if (patch.kind) m.kind = patch.kind
      }
    }),
  restoreMemory: (m) =>
    set((s) => {
      const p = find(s)
      if (p && !p.memory.some((x) => x.id === m.id)) {
        if (p.cloud?.tomb) delete p.cloud.tomb[m.id]
        p.memory.unshift(m)
      }
    }),
})
