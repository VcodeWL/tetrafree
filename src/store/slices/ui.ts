import { ME } from '../../data/seed'
import { uid, initialsOf } from '../../lib/util'
import { useNotifs } from '../../lib/notifs'
import { find, chatOf } from '../helpers'
import { initialPersisted, initialUI } from '../defaults'
import type { SetState, GetState, Actions } from '../types'

export const uiActions = (
  set: SetState,
  get: GetState,
): Pick<
  Actions,
  | 'signIn'
  | 'signOut'
  | 'setAuthMode'
  | 'toLauncher'
  | 'setSort'
  | 'setCenter'
  | 'setMode'
  | 'setRight'
  | 'setRightWidth'
  | 'toast'
  | 'dismissToast'
  | 'openModal'
  | 'closeModal'
  | 'setPalette'
  | 'setSummary'
  | 'setSideOpen'
  | 'setDock'
  | 'setSideHidden'
  | 'resetData'
> => ({
  signIn: (name, email, hue) =>
    set((s) => {
      s.authed = true
      const me = s.people[ME]
      if (name) {
        me.name = name.trim()
        me.initials = initialsOf(name)
      }
      if (email) me.email = email.trim()
      if (hue !== undefined) me.hue = hue
      s.screen = 'launcher'
    }),
  signOut: () =>
    set((s) => {
      s.authed = false
      s.screen = 'auth'
      s.authMode = 'signin'
      s.projectId = null
      s.modal = null
      s.mode = 'dev'
    }),
  setAuthMode: (m) =>
    set((s) => {
      s.authMode = m
    }),
  toLauncher: () =>
    set((s) => {
      s.screen = 'launcher'
      s.mode = 'dev'
      s.modal = null
      s.sideOpen = false
    }),
  setSort: (v) =>
    set((s) => {
      s.sort = v
    }),
  setCenter: (c) =>
    set((s) => {
      s.center = c
      s.sideOpen = false
      if (c.kind === 'chat') {
        const ch = chatOf(find(s), c.id)
        if (ch) ch.unread = false
      }
    }),
  setMode: (m) =>
    set((s) => {
      s.mode = m
    }),
  setRight: (o) =>
    set((s) => {
      Object.assign(s, o)
    }),
  setRightWidth: (w) =>
    set((s) => {
      s.rightWidth = w
    }),
  toast: (t) => {
    if (get().toasts.some((x) => x.title === t.title && x.desc === t.desc)) return
    const id = uid('t')
    useNotifs.getState().add({ title: t.title, desc: t.desc, icon: t.icon, tone: t.tone })
    set((s) => {
      s.toasts.push({ ...t, id })
      if (s.toasts.length > 4) s.toasts.shift()
    })
    setTimeout(() => get().dismissToast(id), t.action ? 5200 : 3400)
  },
  dismissToast: (id) =>
    set((s) => {
      s.toasts = s.toasts.filter((t) => t.id !== id)
    }),
  openModal: (m) =>
    set((s) => {
      s.modal = m
      s.palette = false
    }),
  closeModal: () =>
    set((s) => {
      s.modal = null
    }),
  setPalette: (v) =>
    set((s) => {
      s.palette = v
    }),
  setSummary: (v) =>
    set((s) => {
      s.summary = v
    }),
  setSideOpen: (v) =>
    set((s) => {
      s.sideOpen = v
    }),
  setDock: (v) =>
    set((s) => {
      s.dock = v
    }),
  setSideHidden: (v) =>
    set((s) => {
      s.sideHidden = v
    }),
  resetData: () =>
    set((s) => {
      Object.assign(s, initialPersisted(), initialUI(), { authed: true, screen: 'launcher' })
    }),
})
