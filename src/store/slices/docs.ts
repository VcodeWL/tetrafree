import { ME } from '../../data/seed'
import { uid } from '../../lib/util'
import { tomb, find } from '../helpers'
import type { SetState, Actions } from '../types'
import type { Project } from '../../types'

/** Удаление из явно выбранного проекта, без навигации текущего UI. */
function deleteProjectDoc(p: Project, id: string) {
  if (!p.docs.some((d) => d.id === id)) return
  p.docs = p.docs.filter((d) => d.id !== id)
  tomb(p, id)
}

export const docsActions = (
  set: SetState,
): Pick<Actions, 'addDocs' | 'createDoc' | 'updateDoc' | 'deleteDoc'> => ({
  addDocs: (docs, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (!p || !docs.length) return
      const made = docs.map((d) => ({
        id: 'd' + uid(),
        title: d.title,
        createdBy: ME,
        updatedAt: Date.now(),
        blocks: d.blocks,
      }))
      p.docs.unshift(...made)
      if (s.projectId === p.id) s.center = { kind: 'doc', id: made[0].id }
    }),
  createDoc: (pid) => {
    const id = 'd' + uid()
    set((s) => {
      const p = find(s, pid)
      if (!p) return
      p.docs.unshift({
        id,
        title: 'Без названия',
        createdBy: ME,
        updatedAt: Date.now(),
        blocks: [{ id: uid('b'), type: 'p', text: '' }],
      })
      if (s.projectId === p.id) s.center = { kind: 'doc', id }
    })
    return id
  },
  updateDoc: (id, patch, pid) =>
    set((s) => {
      const d = find(s, pid)?.docs.find((x) => x.id === id)
      if (!d) return
      if (patch.title !== undefined) d.title = patch.title
      if (patch.blocks) d.blocks = patch.blocks
      d.updatedAt = Date.now()
    }),
  deleteDoc: (id, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (!p) return
      deleteProjectDoc(p, id)
      if (s.projectId === p.id && s.center.kind === 'doc' && s.center.id === id)
        s.center = p.docs[0]
          ? { kind: 'doc', id: p.docs[0].id }
          : p.chats[0]
            ? { kind: 'chat', id: p.chats[0].id }
            : { kind: 'empty' }
    }),
})
