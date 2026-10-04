import { put as putTrash, freePath } from '../../lib/trash'
import { ME } from '../../data/seed'
import { uid } from '../../lib/util'
import { tomb, find, pickFile } from '../helpers'
import type { SetState, Actions } from '../types'

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
      p.files[to] = p.files[from]
      delete p.files[from]
      if (s.activeFile === from) s.activeFile = to
    }),
  addDir: (path) =>
    set((s) => {
      const p = find(s)
      if (!p) return
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
      const mv = (x: string) => (x === from ? to : x.startsWith(from + '/') ? to + x.slice(from.length) : x)
      const isDir = p.dirs.includes(from) || Object.keys(p.files).some((f) => f.startsWith(from + '/'))
      for (const f of Object.keys(p.files)) {
        const n = isDir ? mv(f) : f === from ? to : f
        if (n !== f) {
          p.files[n] = p.files[f]
          delete p.files[f]
          if (s.dirty[f] !== undefined) {
            s.dirty[n] = s.dirty[f]
            delete s.dirty[f]
          }
        }
      }
      if (isDir) p.dirs = p.dirs.map(mv)
      const parts = to.split('/')
      parts.pop()
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/')
        if (!p.dirs.includes(d)) p.dirs.push(d)
      }
      if (s.activeFile) s.activeFile = isDir ? mv(s.activeFile) : s.activeFile === from ? to : s.activeFile
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
