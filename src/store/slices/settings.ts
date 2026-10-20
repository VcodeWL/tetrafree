import { ME } from '../../data/seed'
import { recordVaultKeyIntent } from '../../lib/vaultState'
import { initialsOf } from '../../lib/util'
import { find } from '../helpers'
import type { SetState, Actions } from '../types'

// Throw before mutation so synchronous callers cannot announce a successful save.
function keyIntent(set: SetState, id: string, clear: boolean) {
  try {
    recordVaultKeyIntent(id, clear, true)
  } catch (error) {
    set((s) => {
      s.toasts.push({
        id: 'vault-durability-' + Date.now(),
        title: 'Ключ не изменён',
        desc: error instanceof Error ? error.message : 'Хранилище устройства недоступно.',
        tone: 'err',
        icon: 'warn',
      })
    })
    throw error
  }
}
export const settingsActions = (
  set: SetState,
): Pick<
  Actions,
  | 'removeMember'
  | 'updateMe'
  | 'saveProvider'
  | 'deleteProvider'
  | 'toggleProvider'
  | 'setModel'
  | 'setSetting'
> => ({
  removeMember: (id) =>
    set((s) => {
      const p = find(s)
      if (p && p.creator !== id) p.members = p.members.filter((m) => m !== id)
    }),
  updateMe: (patch) =>
    set((s) => {
      Object.assign(s.people[ME], patch)
      if (patch.name) s.people[ME].initials = initialsOf(patch.name)
    }),
  saveProvider: (pr) => {
    keyIntent(set, pr.id, !pr.apiKey)
    set((s) => {
      const i = s.providers.findIndex((x) => x.id === pr.id)
      if (i >= 0) s.providers[i] = pr
      else s.providers.push(pr)
    })
  },
  deleteProvider: (id) => {
    keyIntent(set, id, true)
    set((s) => {
      s.providers = s.providers.filter((p) => p.id !== id)
      if (s.model.startsWith(id + ':')) {
        const f = s.providers.find((p) => p.on && p.models.length)
        s.model = f ? f.id + ':' + f.models[0].id : ''
      }
    })
  },
  toggleProvider: (id) =>
    set((s) => {
      const p = s.providers.find((x) => x.id === id)
      if (!p) return
      p.on = !p.on
      if (!p.on && s.model.startsWith(id + ':')) {
        const f = s.providers.find((x) => x.on && x.models.length)
        s.model = f ? f.id + ':' + f.models[0].id : ''
      }
    }),
  setModel: (m) =>
    set((s) => {
      s.model = m
    }),
  setSetting: (k, v) =>
    set((s) => {
      s.settings[k] = v
    }),
})
