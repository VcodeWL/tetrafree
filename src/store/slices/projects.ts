import { purge as purgeTrash } from '../../lib/trash'
import type { Project } from '../../types'
import { emptyProject, ME } from '../../data/seed'
import { blankSite } from '../../data/site'
import { uid, slug } from '../../lib/util'
import { find, uniqName, pickFile } from '../helpers'
import type { SetState, Actions } from '../types'

/** Файлы шаблона: минимум, с которого можно сразу работать (и что-то запустить) */
export function templateFiles(template: string, name: string): Record<string, string> {
  const readme = `# ${name}\n\nПроект создан в TetraFree. Шаблон: ${template}.\n`
  switch (template) {
    case 'Сайт':
      return { 'README.md': readme, 'site/index.html': blankSite(name) }
    case 'Node.js':
      return {
        'README.md': readme,
        'package.json': JSON.stringify(
          {
            name,
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { start: 'node index.js', test: 'node --test' },
          },
          null,
          2,
        ),
        'index.js': `export function main() {\n  console.log('hello from ${name}')\n}\n\nmain()\n`,
      }
    case 'Python':
      return {
        'README.md': readme,
        'main.py': `def main():\n    print("hello from ${name}")\n\n\nif __name__ == "__main__":\n    main()\n`,
      }
    default:
      return { 'README.md': readme }
  }
}

export const projectsActions = (
  set: SetState,
): Pick<
  Actions,
  | 'openProject'
  | 'createProject'
  | 'renameProject'
  | 'deleteProject'
  | 'duplicateProject'
  | 'up'
  | 'importProject'
  | 'restoreProject'
> => ({
  openProject: (id) =>
    set((s) => {
      const p = find(s, id)
      if (!p) return
      p.openedAt = Date.now()
      if (p.trash) p.trash = purgeTrash(p.trash)
      s.projectId = id
      s.lastProject = id
      s.screen = 'workspace'
      s.mode = 'dev'
      s.sideOpen = false
      s.center = p.chats.length ? { kind: 'chat', id: p.chats[0].id } : { kind: 'empty' }
      s.activeFile = pickFile(p)
      s.rightTab = 'code'
      if (s.viewVersion[id] === undefined) s.viewVersion[id] = null
      s.dirty = {}
    }),
  createProject: ({ name, path, template, adopt }) => {
    const id = 'p' + uid()
    const clean = slug(name) || name
    set((s) => {
      const files: Record<string, string> = adopt ? {} : templateFiles(template, clean)
      const p = emptyProject({
        id,
        name: clean,
        path,
        template: adopt ? 'Существующая папка' : template,
        tools: [],
        desc: adopt ? 'Существующая папка' : `Новый проект · ${template}`,
        icon:
          template === 'Python'
            ? 'py'
            : template === 'Node.js'
              ? 'node'
              : template === 'Сайт'
                ? 'browser'
                : 'sparkle',
        files,
      })
      p.dirs = [
        ...new Set(
          Object.keys(files)
            .filter((f) => f.includes('/'))
            .map((f) => f.split('/')[0]),
        ),
      ]
      if (!adopt)
        p.versions = [
          {
            n: 1,
            title: 'Каркас проекта',
            at: Date.now(),
            by: 'human',
            author: ME,
            tag: 'build',
            feats: ['Каркас проекта'],
            changes: [`Шаблон: ${template}`],
            fixes: [],
            details: Object.keys(files),
            snapshot: { ...p.files },
          },
        ]
      s.projects.unshift(p)
      s.projectId = id
      s.lastProject = id
      s.screen = 'workspace'
      s.center = { kind: 'empty' }
      s.mode = 'dev'
      s.activeFile = pickFile(p)
      s.viewVersion[id] = null
      s.modal = null
    })
    return id
  },
  renameProject: (id, name) =>
    set((s) => {
      const p = find(s, id)
      if (p) {
        p.name = uniqName(s.projects, slug(name) || p.name, id)
        /* папка на диске остаётся где была: переименование меняет только название в приложении */
      }
    }),
  deleteProject: (id) =>
    set((s) => {
      s.projects = s.projects.filter((p) => p.id !== id)
      if (s.projectId === id) {
        s.projectId = null
        s.screen = 'launcher'
      }
    }),
  duplicateProject: (id) =>
    set((s) => {
      const p = find(s, id)
      if (!p) return
      const c: Project = structuredClone(p)
      c.id = 'p' + uid()
      c.name = uniqName(s.projects, p.name + '-copy')
      c.path = p.path ? p.path.replace(/[^\\/]+$/, c.name) : ''
      c.createdAt = Date.now()
      c.openedAt = Date.now()
      c.lanes = []
      c.chats.forEach((ch) => {
        ch.running = false
      })
      s.projects.splice(s.projects.indexOf(p) + 1, 0, c)
    }),
  up: (fn, pid) =>
    set((s) => {
      const p = find(s, pid)
      if (p) fn(p)
    }),
  importProject: (pr) =>
    set((s) => {
      const name = uniqName(s.projects, pr.name)
      s.projects.unshift({
        ...pr,
        id: 'p' + uid(),
        name,
        openedAt: Date.now(),
        lanes: [],
        chats: pr.chats.map((c) => ({ ...c, running: false })),
      })
    }),
  restoreProject: (pr, index) =>
    set((s) => {
      if (!s.projects.some((x) => x.id === pr.id))
        s.projects.splice(Math.min(index, s.projects.length), 0, pr)
    }),
})
