import type { Project } from '../types'
import { docMd } from './docmd'
import { makeZip, readZip } from './zip'
import { emptyProject } from '../data/seed'
import { uid, slug } from './util'

/* Экспорт: файлы репозитория + .tetra (история, чаты, память, доки, задачи). Секреты провайдеров не попадают. */
export function exportProject(p: Project): Blob {
  const files: Record<string, string> = { ...p.files }
  const put = (k: string, v: string) => {
    if (!(k in p.files)) files[k] = v
  }
  p.docs.forEach((d) => {
    put(`docs/notes/${slug(d.title) || d.id}.md`, docMd(d))
  })
  p.tasks.forEach((t) => {
    put(
      `tasks/T-${t.key}.yaml`,
      `id: T-${t.key}\ntitle: ${JSON.stringify(t.title)}\nstatus: ${t.status}\npriority: ${t.priority}\nassignee: ${t.assignee ? (t.assignee.kind === 'agent' ? '"@' + t.assignee.name + '"' : t.assignee.id) : 'null'}\n${t.due ? 'due: ' + t.due + '\n' : ''}`,
    )
  })
  const generated = Object.keys(files).filter((f) => !(f in p.files))
  const meta = {
    format: 'tetrafree-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    generated,
    project: { ...p, files: undefined, lanes: [] },
  }
  files['.tetra/project.json'] = JSON.stringify(meta, null, 2)
  return makeZip(files)
}

export async function importProjectFile(file: File): Promise<Project> {
  const files = await readZip(await file.arrayBuffer())
  const metaRaw = files['.tetra/project.json']
  delete files['.tetra/project.json']
  if (metaRaw) {
    const meta = JSON.parse(metaRaw)
    if (meta.format !== 'tetrafree-project') throw new Error('Неизвестный формат архива')
    const pr = meta.project as Project
    if (!pr || typeof pr !== 'object') throw new Error('Архив повреждён: нет данных проекта')
    ;((meta.generated as string[]) || []).forEach((f) => {
      delete files[f]
    })
    return { ...pr, files, dirs: dirsOf(files), memory: pr.memory || [] }
  }
  /* обычный архив папки: создаём проект из файлов */
  const root = commonRoot(Object.keys(files))
  const clean: Record<string, string> = {}
  Object.entries(files).forEach(([k, v]) => {
    clean[k.slice(root.length)] = v
  })
  const name = slug(root.replace(/\/$/, '') || file.name.replace(/\.zip$/i, ''))
  const p = emptyProject({
    id: 'p' + uid(),
    name,
    desc: 'Импортировано из архива ' + file.name,
    files: clean,
  })
  p.dirs = dirsOf(p.files)
  p.versions = [
    {
      n: 1,
      title: 'Импорт из архива',
      at: Date.now(),
      by: 'human',
      author: 'me',
      tag: 'build',
      feats: [],
      changes: [`Импортировано файлов: ${Object.keys(clean).length}`],
      fixes: [],
      details: [file.name],
      snapshot: { ...p.files },
    },
  ]
  return p
}
function dirsOf(files: Record<string, string>) {
  const s = new Set<string>()
  Object.keys(files).forEach((f) => {
    const parts = f.split('/')
    for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/'))
  })
  return [...s]
}
function commonRoot(paths: string[]) {
  const first = paths[0]?.split('/')[0]
  return first && paths.every((p) => p.startsWith(first + '/')) ? first + '/' : ''
}
