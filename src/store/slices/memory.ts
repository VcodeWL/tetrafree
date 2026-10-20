import { uid } from '../../lib/util'
import { tomb, find } from '../helpers'
import type { SetState, Actions } from '../types'
import type { Memory, Project } from '../../types'

/** Восстановление в явно выбранный проект; не перезаписывает уже живую запись. */
function restoreProjectMemory(p: Project, m: Memory) {
  if (p.memory.some((x) => x.id === m.id)) return
  const removedAt = p.cloud?.tomb?.[m.id] || 0
  if (p.cloud?.tomb) delete p.cloud.tomb[m.id]
  p.memory.unshift({ ...m, at: Math.max(Date.now(), m.at + 1, removedAt + 1) })
}

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
  editMemory: (id, patch, pid) =>
    set((s) => {
      const m = find(s, pid)?.memory.find((x) => x.id === id)
      if (m) {
        const text = patch.text === undefined ? m.text : patch.text.trim().slice(0, 500)
        const kind = patch.kind || m.kind
        if (text === m.text && kind === m.kind) return
        m.text = text
        m.kind = kind
        /* at — время последнего изменения заметки, stamp для cloud merge. */
        m.at = Math.max(Date.now(), m.at + 1)
      }
    }),
  restoreMemory: (m, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (p) restoreProjectMemory(p, m)
    }),
})
