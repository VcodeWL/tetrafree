import { put as putTrash, freePath } from '../../lib/trash'
import { checkPath } from '../../lib/paths'
import { matchesFileTree, type FilePreimage } from '../../lib/filePreimage'
import type { Project } from '../../types'
import { ME } from '../../data/seed'
import { uid } from '../../lib/util'
import { tomb, find, pickFile } from '../helpers'
import type { SetState, Actions } from '../types'

export type FileMutation =
  | { kind: 'create'; path: string; content?: string }
  | { kind: 'mkdir'; path: string }
  | { kind: 'rename'; from: string; to: string; before: FilePreimage }
  | { kind: 'delete'; path: string; before: FilePreimage }
  | { kind: 'replace'; path: string; content: string; before: FilePreimage }
  | { kind: 'restore'; files: Record<string, string>; dirs: string[] }

function parents(p: Pick<Project, 'dirs'>, path: string) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    if (!p.dirs.includes(dir)) p.dirs.push(dir)
  }
}
function renameTree(p: Project, from: string, to: string) {
  const exists =
    from in p.files || p.dirs.includes(from) || Object.keys(p.files).some((f) => f.startsWith(from + '/'))
  if (!exists) throw new Error('Исходный путь уже удалён или переименован')
  if (from === to) return
  const error = checkPath(p, to, from)
  if (error) throw new Error(error)
  const mv = (x: string) => (x === from ? to : x.startsWith(from + '/') ? to + x.slice(from.length) : x)
  const changed = Object.entries(p.files).filter(([path]) => mv(path) !== path)
  // Stage moves before writing: never overwrite a destination while still traversing sources.
  for (const [path] of changed) delete p.files[path]
  for (const [path, text] of changed) p.files[mv(path)] = text
  p.dirs = [...new Set(p.dirs.map(mv))]
  parents(p, to)
}

/** Atomic guarded UI mutations. Ordinary writeFile remains an explicit overwrite API. */
export function mutateFileTree(set: SetState, pid: string, op: FileMutation) {
  set((s) => {
    const p = find(s, pid)
    if (!p) throw new Error('Исходный проект уже удалён')
    if (
      'before' in op &&
      (op.before.path !== (op.kind === 'rename' ? op.from : op.path) || !matchesFileTree(p, op.before))
    )
      throw new Error('Файлы изменились после открытия операции. Повтори действие на свежих данных.')
    if (op.kind === 'create' || op.kind === 'mkdir') {
      const error = checkPath(p, op.path)
      if (error) throw new Error(error)
      if (op.kind === 'create') p.files[op.path] = op.content ?? ''
      else p.dirs.push(op.path)
      parents(p, op.path)
    } else if (op.kind === 'rename') {
      renameTree(p, op.from, op.to)
      if (s.projectId === pid) {
        const mv = (x: string) =>
          x === op.from ? op.to : x.startsWith(op.from + '/') ? op.to + x.slice(op.from.length) : x
        if (s.activeFile) s.activeFile = mv(s.activeFile)
        for (const [path, text] of Object.entries(s.dirty)) {
          if (mv(path) !== path) {
            delete s.dirty[path]
            s.dirty[mv(path)] = text
          }
        }
      }
    } else if (op.kind === 'replace') {
      if (!(op.path in p.files)) throw new Error('Исходный файл уже удалён')
      p.files[op.path] = op.content
    } else if (op.kind === 'delete') {
      if (!Object.keys(op.before.files).length && !op.before.dirs.length)
        throw new Error('Исходный путь уже удалён')
      const under = (name: string) => name === op.path || name.startsWith(op.path + '/')
      for (const [path, content] of Object.entries(p.files).filter(([name]) => under(name))) {
        const trash = p.trash || []
        const recovered = freePath((name) => trash.some((item) => item.path === name), path)
        p.trash = [{ path: recovered, content, at: Date.now() }, ...trash]
        delete p.files[path]
        if (s.projectId === pid) delete s.dirty[path]
      }
      p.dirs = p.dirs.filter((name) => !under(name))
      if (s.projectId === pid && s.activeFile && under(s.activeFile)) s.activeFile = pickFile(p)
    } else {
      // Validate the entire restoration before the first write: no partially restored tree.
      for (const path of [...Object.keys(op.files), ...op.dirs]) {
        const error = checkPath(p, path)
        if (error) throw new Error(error)
      }
      Object.assign(p.files, op.files)
      p.dirs = [...new Set([...p.dirs, ...op.dirs])]
      for (const path of Object.keys(op.files)) parents(p, path)
    }
  })
}

export const filesActions = (
  set: SetState,
): Pick<
  Actions,
  | 'openFile'
  | 'setDirty'
  | 'toggleDir'
  | 'writeFile'
  | 'deleteFile'
  | 'renameFile'
  | 'addDir'
  | 'deletePath'
  | 'restoreTrash'
  | 'dropTrash'
  | 'renamePath'
  | 'commit'
  | 'rollback'
  | 'setViewVersion'
  | 'addComment'
  | 'toggleComment'
  | 'deleteComment'
> => ({
  openFile: (path) =>
    set((s) => {
      s.activeFile = path
      s.rightTab = 'code'
      s.rightOpen = true
      s.viewVersion[s.projectId!] = s.viewVersion[s.projectId!] ?? null
    }),
  setDirty: (path, content) =>
    set((s) => {
      if (content === null) delete s.dirty[path]
      else s.dirty[path] = content
    }),
  toggleDir: (dir) =>
    set((s) => {
      const k = s.projectId + ':' + dir
      s.closedDirs[k] = !s.closedDirs[k]
    }),

  writeFile: (path, content, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (!p) return
      if (!(path in p.files)) {
        const error = checkPath(p, path)
        if (error) throw new Error(error)
      }
      p.files[path] = content
      const parts = path.split('/')
      parts.pop()
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/')
        if (d && !p.dirs.includes(d)) p.dirs.push(d)
      }
    }),
  deleteFile: (path) =>
    set((s) => {
      const p = find(s)
      if (!p) return
      if (path in p.files) p.trash = putTrash(p.trash || [], { [path]: p.files[path] })
      delete p.files[path]
      delete s.dirty[path]
      if (s.activeFile === path) s.activeFile = pickFile(p)
    }),
  renameFile: (from, to) =>
    set((s) => {
      const p = find(s)
      if (!p || !(from in p.files)) return
      renameTree(p, from, to)
      if (s.activeFile === from) s.activeFile = to
    }),
  addDir: (path) =>
    set((s) => {
      const p = find(s)
      if (!p) return
      if (p.dirs.includes(path)) return
      const implicit = Object.keys(p.files).some((name) => name.startsWith(path + '/'))
      if (!implicit) {
        const error = checkPath(p, path)
        if (error) throw new Error(error)
      }
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/')
        if (!p.dirs.includes(d)) p.dirs.push(d)
      }
      s.closedDirs[p.id + ':' + path] = false
    }),
  deletePath: (path) =>
    set((s) => {
      const p = find(s)
      if (!p) return
      const under = (x: string) => x === path || x.startsWith(path + '/')
      p.trash = putTrash(p.trash || [], Object.fromEntries(Object.entries(p.files).filter(([f]) => under(f))))
      Object.keys(p.files)
        .filter(under)
        .forEach((f) => {
          delete p.files[f]
          delete s.dirty[f]
        })
      p.dirs = p.dirs.filter((d) => !under(d))
      if (s.activeFile && under(s.activeFile)) s.activeFile = pickFile(p)
    }),
  restoreTrash: (paths) => {
    const out: string[] = []
    set((s) => {
      const p = find(s)
      if (!p?.trash) return
      for (const it of p.trash.filter((x) => paths.includes(x.path))) {
        const to = freePath((q) => q in p.files, it.path)
        p.files[to] = it.content
        out.push(to)
        const parts = to.split('/')
        parts.pop()
        for (let i = 1; i <= parts.length; i++) {
          const d = parts.slice(0, i).join('/')
          if (d && !p.dirs.includes(d)) p.dirs.push(d)
        }
      }
      p.trash = p.trash.filter((x) => !paths.includes(x.path))
    })
    return out
  },
  dropTrash: (paths) =>
    set((s) => {
      const p = find(s)
      if (p?.trash) p.trash = paths ? p.trash.filter((x) => !paths.includes(x.path)) : []
    }),
  renamePath: (from, to) =>
    set((s) => {
      const p = find(s)
      if (!p || from === to) return
      renameTree(p, from, to)
      const mv = (x: string) => (x === from ? to : x.startsWith(from + '/') ? to + x.slice(from.length) : x)
      for (const [path, text] of Object.entries(s.dirty)) {
        if (mv(path) !== path) {
          delete s.dirty[path]
          s.dirty[mv(path)] = text
        }
      }
      if (s.activeFile) s.activeFile = mv(s.activeFile)
    }),
  commit: (v, pid) => {
    let n = 0
    set((s) => {
      const p = find(s, pid)
      if (!p) return
      n = (p.versions[p.versions.length - 1]?.n || 0) + 1
      p.versions.push({ ...v, id: uid('v'), n, at: Date.now(), snapshot: { ...p.files } })
      s.viewVersion[p.id] = null
    })
    return n
  },
  rollback: (n) => {
    let nn = 0
    set((s) => {
      const p = find(s)
      if (!p) return
      const src = p.versions.find((x) => x.n === n)
      if (!src) return
      nn = p.versions[p.versions.length - 1].n + 1
      p.files = { ...src.snapshot }
      p.versions.push({
        id: uid('v'),
        n: nn,
        title: `Откат к v${n} — «${src.title}»`,
        at: Date.now(),
        by: 'human',
        author: ME,
        tag: 'build',
        feats: [],
        changes: [`Проект возвращён к состоянию v${n}`],
        fixes: [],
        details: [
          `Создан новый снимок поверх текущего — как копия v${n}`,
          `Файлы восстановлены из v${n}`,
          `Ни одна версия не удалена: можно вернуться вперёд к v${nn - 1}`,
        ],
        snapshot: { ...src.snapshot },
      })
      s.viewVersion[p.id] = null
      s.dirty = {}
      if (s.activeFile && !(s.activeFile in p.files)) s.activeFile = pickFile(p)
    })
    return nn
  },
  setViewVersion: (n) =>
    set((s) => {
      if (s.projectId) s.viewVersion[s.projectId] = n
    }),
  addComment: (c) =>
    set((s) => {
      const p = find(s)
      if (p)
        (p.comments ||= []).push({
          id: uid('cm'),
          ...c,
          text: c.text.slice(0, 2000),
          by: ME,
          at: Date.now(),
        })
    }),
  toggleComment: (id) =>
    set((s) => {
      const c = find(s)?.comments?.find((x) => x.id === id)
      if (c) {
        c.done = !c.done
        c.at = Date.now()
      }
    }),
  deleteComment: (id) =>
    set((s) => {
      const p = find(s)
      if (p?.comments) {
        p.comments = p.comments.filter((x) => x.id !== id)
        tomb(p, id)
      }
    }),
})
