import type { Project } from '../types'

type FileProject = Pick<Project, 'id' | 'files' | 'dirs'>
interface FileStore {
  getState: () => { projects: FileProject[] }
  subscribe: (listener: () => void) => () => void
}
interface Revision {
  files: Record<string, string>
  dirs: string[]
  values: Map<string, { value: string; token: object }>
}
const trackers = new WeakMap<FileStore, Map<string, Revision>>()

/** Volatile revisions distinguish deletion/recreation and ABA edits, without changing persistence. */
function revisions(store: FileStore) {
  let byProject = trackers.get(store)
  if (byProject) return byProject
  byProject = new Map()
  const current = byProject
  const observe = () => {
    const projects = store.getState().projects
    for (const pid of current.keys()) if (!projects.some((p) => p.id === pid)) current.delete(pid)
    for (const p of projects) {
      const previous = current.get(p.id)
      if (previous?.files === p.files && previous?.dirs === p.dirs) continue
      const values = new Map<string, { value: string; token: object }>()
      const add = (key: string, value: string) => {
        const old = previous?.values.get(key)
        values.set(key, old?.value === value ? old : { value, token: {} })
      }
      for (const [path, value] of Object.entries(p.files)) add('f:' + path, value)
      for (const path of p.dirs) add('d:' + path, '')
      current.set(p.id, { files: p.files, dirs: p.dirs, values })
    }
  }
  trackers.set(store, current)
  observe()
  store.subscribe(observe)
  return current
}

export interface FilePreimage {
  pid: string
  path: string
  files: Record<string, string>
  dirs: string[]
  /** Must be evaluated inside the store transaction, before any writes. */
  unchanged: () => boolean
}
export function captureFileTree(store: FileStore, pid: string, path: string): FilePreimage {
  const tracked = revisions(store)
  const project = store.getState().projects.find((p) => p.id === pid)
  const under = (name: string) => name === path || name.startsWith(path + '/')
  const files = Object.fromEntries(Object.entries(project?.files || {}).filter(([name]) => under(name)))
  const dirs = (project?.dirs || []).filter(under)
  const before = new Map([...(tracked.get(pid)?.values || [])].filter(([key]) => under(key.slice(2))))
  return {
    pid,
    path,
    files,
    dirs,
    unchanged: () => {
      const now = tracked.get(pid)
      if (!project || !now) return false
      const values = [...now.values].filter(([key]) => under(key.slice(2)))
      return (
        values.length === before.size &&
        values.every(([key, value]) => before.get(key)?.token === value.token)
      )
    },
  }
}

/** Check data again against the actual transaction draft, not only against a rendered snapshot. */
export function matchesFileTree(project: FileProject, before: FilePreimage) {
  if (project.id !== before.pid || !before.unchanged()) return false
  const under = (name: string) => name === before.path || name.startsWith(before.path + '/')
  const files = Object.entries(project.files).filter(([name]) => under(name))
  const dirs = project.dirs.filter(under)
  return (
    files.length === Object.keys(before.files).length &&
    files.every(([name, text]) => before.files[name] === text) &&
    dirs.length === before.dirs.length &&
    dirs.every((name) => before.dirs.includes(name))
  )
}
