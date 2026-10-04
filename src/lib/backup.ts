import { useStore } from '../store'
import type { Project } from '../types'
import { download, uid, localDay } from './util'

/* Резервная копия: все проекты и настройки одним JSON. Ключи провайдеров и адрес бэкенда не попадают в файл. */
interface Backup {
  app: 'tetrafree'
  v: 1
  at: number
  version: string
  projects: Project[]
  settings: Record<string, unknown>
}

export function buildBackup(): Backup {
  const s = useStore.getState()
  const { backendUrl: _b, seenVersion: _v, ...settings } = s.settings as unknown as Record<string, unknown>
  void _b
  void _v
  const data: Backup = {
    app: 'tetrafree',
    v: 1,
    at: Date.now(),
    version: __APP_VERSION__,
    projects: s.projects.map((p) => ({ ...p, cloud: undefined })),
    settings,
  }
  return data
}
export function exportBackup() {
  const data = buildBackup()
  download(`tetrafree-backup-${localDay()}.json`, JSON.stringify(data), 'application/json')
  return data.projects.length
}

const isProject = (p: unknown): p is Project => {
  const x = p as Project
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    Array.isArray(x.chats) &&
    Array.isArray(x.docs) &&
    Array.isArray(x.tasks) &&
    Array.isArray(x.versions) &&
    typeof x.files === 'object' &&
    x.files !== null
  )
}

/* Добавляет проекты из копии. Совпавшие по id или имени не затираются — получают новое имя. Возвращает число добавленных. */
export async function importBackup(file: File): Promise<number> {
  if (file.size > 80 * 1024 * 1024) throw new Error('Файл слишком большой для копии')
  let d: Backup
  try {
    d = JSON.parse(await file.text())
  } catch {
    throw new Error('Это не JSON-файл')
  }
  if (d?.app !== 'tetrafree' || !Array.isArray(d.projects))
    throw new Error('Это не резервная копия TetraFree')
  const ok = d.projects.filter(isProject)
  if (!ok.length) throw new Error('В копии нет проектов')
  useStore.setState((s) => {
    const names = new Set(s.projects.map((p) => p.name)),
      ids = new Set(s.projects.map((p) => p.id))
    const add = ok.map((p) => {
      let name = p.name,
        n = 2
      while (names.has(name)) name = `${p.name}-${n++}`
      names.add(name)
      const id = ids.has(p.id) ? 'p' + uid() : p.id
      ids.add(id)
      return { ...p, id, name, path: '', cloud: undefined, lanes: [] } as Project
    })
    return { projects: [...s.projects, ...add] }
  })
  return ok.length
}
