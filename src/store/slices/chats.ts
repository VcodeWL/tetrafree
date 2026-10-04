import type { Actor, Message } from '../../types'
import { ME } from '../../data/seed'
import { uid } from '../../lib/util'
import { tomb, find, chatOf } from '../helpers'
import type { SetState, Actions } from '../types'

export const chatsActions = (
  set: SetState,
): Pick<
  Actions,
  | 'createChat'
  | 'duplicateChat'
  | 'renameChat'
  | 'deleteChat'
  | 'pushMsg'
  | 'patchMsg'
  | 'setChat'
  | 'setDraft'
  | 'restoreChat'
> => ({
  createChat: ({ title, creator, agents, first }) => {
    const id = 'c' + uid()
    set((s) => {
      const p = find(s)
      if (!p) return
      const who =
        creator.kind === 'agent'
          ? `**агент ${creator.name}**`
          : `**${s.people[creator.id]?.name || 'Участник'}**`
      const now = Date.now()
      p.chats.unshift({
        id,
        title,
        creator,
        agents,
        running: false,
        createdAt: now,
        lastAt: now,
        messages: [
          { id: uid('m'), kind: 'sys', text: `Чат создал ${who} — виден всем участникам`, at: now },
          ...(first || []),
        ],
      })
      s.center = { kind: 'chat', id }
    })
    return id
  },
  duplicateChat: (src) => {
    const id = 'c' + uid()
    let ok = false
    set((s) => {
      const p = find(s)
      const c = p?.chats.find((x) => x.id === src)
      if (!p || !c) return
      const now = Date.now()
      ok = true
      const msgs = c.messages
        .filter((m) => m.kind === 'sys' || m.kind === 'human' || (m.kind === 'agent' && !m.streaming))
        .map((m) => {
          const n = JSON.parse(JSON.stringify(m)) as Message
          n.id = uid('m')
          if (n.kind === 'agent') {
            delete n.turn
            delete n.startedAt
          }
          if (n.kind === 'human') delete n.pinned
          return n
        })
      p.chats.unshift({
        id,
        title: c.title + ' (копия)',
        creator: { kind: 'human', id: ME } as Actor,
        agents: JSON.parse(JSON.stringify(c.agents)),
        running: false,
        createdAt: now,
        lastAt: now,
        messages: [
          ...msgs,
          {
            id: uid('m'),
            kind: 'sys',
            text: 'Копия чата «' + c.title + '» — история скопирована, агенты начнут с чистого хода',
            at: now,
          },
        ],
      })
      s.center = { kind: 'chat', id }
    })
    return ok ? id : null
  },
  renameChat: (id, title) =>
    set((s) => {
      const c = chatOf(find(s), id)
      if (c) c.title = title
    }),
  deleteChat: (id) =>
    set((s) => {
      const p = find(s)
      if (!p) return
      p.chats = p.chats.filter((c) => c.id !== id)
      tomb(p, id)
      p.lanes = p.lanes.filter((l) => l.chatId !== id)
      if (s.center.kind === 'chat' && s.center.id === id)
        s.center = p.chats[0] ? { kind: 'chat', id: p.chats[0].id } : { kind: 'empty' }
    }),
  pushMsg: (chatId, m, pid) =>
    set((s) => {
      const c = chatOf(find(s, pid), chatId)
      if (!c) return
      c.messages.push(m)
      c.lastAt = m.at
      const viewing =
        s.screen === 'workspace' &&
        s.center.kind === 'chat' &&
        s.center.id === chatId &&
        s.projectId === (pid ?? s.projectId)
      if (!viewing && m.kind !== 'sys') c.unread = true
    }),
  patchMsg: (chatId, msgId, patch, pid) =>
    set((s) => {
      const c = chatOf(find(s, pid), chatId)
      const m = c?.messages.find((x) => x.id === msgId)
      if (m) Object.assign(m, patch)
    }),
  setChat: (chatId, patch, pid) =>
    set((s) => {
      const c = chatOf(find(s, pid), chatId)
      if (c) Object.assign(c, patch)
    }),
  setDraft: (chatId, v) =>
    set((s) => {
      s.drafts[chatId] = v
    }),

  restoreChat: (c, index) =>
    set((s) => {
      const p = find(s)
      if (p && !p.chats.some((x) => x.id === c.id)) {
        if (p.cloud?.tomb) delete p.cloud.tomb[c.id]
        p.chats.splice(Math.min(index, p.chats.length), 0, { ...c, running: false, lastAt: Date.now() })
        s.center = { kind: 'chat', id: c.id }
      }
    }),
})
