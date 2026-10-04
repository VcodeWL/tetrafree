import { ME } from '../../data/seed'
import { uid } from '../../lib/util'
import { tomb, find } from '../helpers'
import type { SetState, Actions } from '../types'

export const docsActions = (
  set: SetState,
): Pick<Actions, 'addDocs' | 'createDoc' | 'updateDoc' | 'deleteDoc'> => ({
  addDocs: (docs) =>
    set((s) => {
      const p = find(s)
      if (!p || !docs.length) return
      const made = docs.map((d) => ({
        id: 'd' + uid(),
        title: d.title,
        createdBy: ME,
        updatedAt: Date.now(),
        blocks: d.blocks,
      }))
      p.docs.unshift(...made)
      s.center = { kind: 'doc', id: made[0].id }
    }),
  createDoc: () => {
    const id = 'd' + uid()
    set((s) => {
      const p = find(s)
      if (!p) return
      p.docs.unshift({
        id,
        title: 'Без названия',
        createdBy: ME,
        updatedAt: Date.now(),
        blocks: [{ id: uid('b'), type: 'p', text: '' }],
      })
      s.center = { kind: 'doc', id }
    })
    return id
  },
  updateDoc: (id, patch) =>
    set((s) => {
      const d = find(s)?.docs.find((x) => x.id === id)
      if (!d) return
      if (patch.title !== undefined) d.title = patch.title
      if (patch.blocks) d.blocks = patch.blocks
      d.updatedAt = Date.now()
    }),
  deleteDoc: (id) =>
    set((s) => {
      const p = find(s)
      if (!p) return
      p.docs = p.docs.filter((d) => d.id !== id)
      tomb(p, id)
      if (s.center.kind === 'doc' && s.center.id === id)
        s.center = p.docs[0]
          ? { kind: 'doc', id: p.docs[0].id }
          : p.chats[0]
            ? { kind: 'chat', id: p.chats[0].id }
            : { kind: 'empty' }
    }),
})
