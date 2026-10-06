/* Применяет план docplan к стору: документы появляются на диске как docs/<название>.md и обратно. */
import { useStore } from '../store'
import { fnv } from './backend'
import { hasSynced, syncEnabled } from './sync'
import { docMd } from './docmd'
import { planDocs, type DocBase } from './docplan'
import { uid } from './util'
import { ME } from '../data/seed'

const KEY = (pid: string) => 'tf-docs:' + pid
const S = () => useStore.getState()
const load = (pid: string): { base: DocBase; init: boolean } => {
  try {
    const raw = localStorage.getItem(KEY(pid))
    if (raw) return { base: JSON.parse(raw), init: false }
  } catch {
    /* повреждено — начнём заново */
  }
  return { base: {}, init: true }
}

export function syncDocs(pid: string) {
  const p = S().projects.find((x) => x.id === pid)
  if (!p) return
  const { base, init } = load(pid)
  const plan = planDocs(p.docs, p.files, base, fnv, init)
  const changed =
    Object.keys(plan.write).length ||
    plan.remove.length ||
    plan.update.length ||
    plan.add.length ||
    Object.keys(plan.attach).length
  const added: Record<string, string> = {}
  const addedTitle: Record<string, { title: string; blocks: (typeof plan.add)[number]['blocks'] }> = {}
  S().up((q) => {
    for (const k of plan.remove) delete q.files[k]
    for (const [k, v] of Object.entries(plan.write)) {
      q.files[k] = v
      if (!q.dirs.includes('docs')) q.dirs.push('docs')
    }
    for (const [id, file] of Object.entries(plan.attach)) {
      const d = q.docs.find((x) => x.id === id)
      if (d) d.file = file
    }
    for (const u of plan.update) {
      const d = q.docs.find((x) => x.id === u.id)
      if (d) {
        d.title = u.title
        d.blocks = u.blocks
        d.updatedAt = Date.now()
      }
    }
    for (const a of plan.add) {
      const id = 'd' + uid()
      added[id] = a.file
      addedTitle[id] = a
      q.docs.push({
        id,
        title: a.title,
        createdBy: ME,
        updatedAt: Date.now(),
        blocks: a.blocks,
        file: a.file,
      })
    }
  }, pid)
  /* новые документы из чужих файлов: файл не трогаем, пока документ не правили */
  const files = S().projects.find((x) => x.id === pid)!.files
  for (const [id, file] of Object.entries(added))
    plan.base[id] = { file, h: fnv(files[file]), d: fnv(docMd(addedTitle[id])), t: addedTitle[id].title }
  try {
    localStorage.setItem(KEY(pid), JSON.stringify(plan.base))
  } catch {
    /* квота */
  }
  return changed
}

let started = false
const tries = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const seenDocs = new WeakMap<object, true>()
const seenFiles = new WeakMap<object, true>()
export function startDocSync() {
  if (started) return
  started = true
  const run = (pid: string) => {
    clearTimeout(timers.get(pid))
    timers.set(
      pid,
      setTimeout(() => {
        timers.delete(pid)
        /* пока файлы с диска не прочитаны, нельзя решать, что в docs/ «новое»: ждём первую сверку */
        if (syncEnabled() && !hasSynced(pid) && (tries.get(pid) ?? 0) < 20) {
          tries.set(pid, (tries.get(pid) ?? 0) + 1)
          return run(pid)
        }
        tries.delete(pid)
        syncDocs(pid)
      }, 700),
    )
  }
  useStore.subscribe((s) => {
    const p = s.projects.find((x) => x.id === s.projectId)
    if (!p) return
    const a = seenDocs.has(p.docs),
      b = seenFiles.has(p.files)
    if (a && b) return
    seenDocs.set(p.docs, true)
    seenFiles.set(p.files, true)
    run(p.id)
  })
}
