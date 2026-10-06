/* Операции агента над файлами проекта (запись, удаление, чистка пустых папок) */
import { useStore } from '../store'
import type { ID } from '../types'

const S = () => useStore.getState()

export const fileOf = (pid: ID, path: string) => S().projects.find((p) => p.id === pid)?.files[path]
export const base = (f: string) => f.split('/').pop() || f

/** Записать (content) или удалить (null) файл в конкретном проекте */
export function putFile(pid: ID, path: string, content: string | null) {
  const st = S()
  if (content !== null) {
    st.writeFile(path, content, pid)
    return
  }
  if (st.projectId === pid) st.deleteFile(path)
  else
    st.up((p) => {
      delete p.files[path]
    }, pid)
  pruneDirs(pid, path)
}
/** Папки, в которых не осталось файлов, исчезают вместе с ними. С `after` — только папки удалённого пути (чужие пустые папки не трогаем). */
export function pruneDirs(pid: ID, after?: string) {
  S().up((p) => {
    const keep = new Set<string>()
    for (const f of Object.keys(p.files)) {
      const seg = f.split('/')
      seg.pop()
      for (let i = 1; i <= seg.length; i++) keep.add(seg.slice(0, i).join('/'))
    }
    const mine = after ? new Set<string>() : null
    if (mine && after) {
      const seg = after.split('/')
      seg.pop()
      for (let i = 1; i <= seg.length; i++) mine.add(seg.slice(0, i).join('/'))
    }
    p.dirs = p.dirs.filter((d) => keep.has(d) || (mine !== null && !mine.has(d)))
  }, pid)
}
export function expandDelete(pid: ID, path: string): string[] {
  const files = Object.keys(S().projects.find((p) => p.id === pid)?.files || {})
  const clean = path.replace(/\/+$/, '')
  if (files.includes(clean)) return [clean]
  return files.filter((f) => f.startsWith(clean + '/'))
}
export const countLines = (s: string) => (s ? s.split('\n').length : 0)
