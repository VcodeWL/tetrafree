/* Двусторонняя синхронизация проекта с папкой на диске (через локальный бэкенд).
   Для каждого файла помним «базовый» хеш — то, что было одинаково и там и там.
   Изменился только стор → пишем на диск. Изменился только диск → импортируем как версию «Правки с диска».
   Изменились оба → побеждает приложение (диск получит его версию), пользователь видит предупреждение. */
import { useStore, toast } from '../store'
import {
  useBackend,
  backendOnline,
  detectBackend,
  bBatch,
  bHashes,
  bRead,
  bCommit,
  bGit,
  bResolve,
  isAbsPath,
  fnv,
} from './backend'
import type { Project } from '../types'

import { folderLost } from './paths'
import { makeIgnore } from './ignore'

const S = () => useStore.getState()
const KEY = (pid: string) => 'tf-sync:' + pid
const baseline = new Map<string, Record<string, string>>()
const loadBase = (pid: string) => {
  if (!baseline.has(pid)) {
    try {
      baseline.set(pid, JSON.parse(localStorage.getItem(KEY(pid)) || '{}'))
    } catch {
      baseline.set(pid, {})
    }
  }
  return baseline.get(pid)!
}
/** пустые папки, которые приложение уже создало на диске (чтобы не слать повторно и уметь убрать) */
const dirKey = (pid: string) => 'tf-dirs:' + pid
const loadDirs = (pid: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(dirKey(pid)) || '[]'))
  } catch {
    return new Set()
  }
}
const saveDirs = (pid: string, s: Set<string>) => {
  try {
    localStorage.setItem(dirKey(pid), JSON.stringify([...s]))
  } catch {
    /* квота */
  }
}
const saveBase = (pid: string) => {
  try {
    localStorage.setItem(KEY(pid), JSON.stringify(baseline.get(pid) || {}))
  } catch {
    /* квота */
  }
}

/** Забыть, что было «одинаковым» на диске и в приложении (после смены папки или осознанного восстановления) */
export function forgetBase(pid: string) {
  baseline.set(pid, {})
  saveBase(pid)
}
const lostWarned = new Set<string>()
/** путь → хеш версии (или 'rm'), которую не удалось записать на диск */
const badPaths = new Map<string, Record<string, string>>()

let seen = new WeakMap<object, true>()
const busy = new Set<string>()
const queued = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let poll: ReturnType<typeof setInterval> | null = null
let started = false
const committed = new Map<string, number>()

export function syncEnabled() {
  return backendOnline() && S().settings.backendSync !== false
}

/** Один проход сверки. Возвращает сводку. */
export async function reconcile(pid: string, opts: { quiet?: boolean } = {}) {
  if (busy.has(pid)) {
    queued.add(pid)
    return null
  }
  let proj = S().projects.find((p) => p.id === pid)
  if (!proj || !syncEnabled()) return null
  busy.add(pid)
  useBackend.setState({ syncing: true })
  let failed: { path: string; code: string; error: string }[] = []
  const sum = { pushed: 0, pulled: 0, removed: 0, conflicts: 0, truncated: false }
  try {
    /* проект из версий до 2.0 не знает свою папку — спрашиваем у сервера и запоминаем */
    if (!isAbsPath(proj.path)) {
      const r = await bResolve(proj)
      S().up((p) => {
        p.path = r.dir
      }, pid)
      proj = S().projects.find((p) => p.id === pid)!
    }
    const { hashes: disk, truncated, ignore, skip } = await bHashes(proj)
    const ig = makeIgnore(ignore || '')
    const skipSet = new Set(skip || [])
    /* файлы, которые сервер не показывает (.gitignore, node_modules…): их отсутствие в списке диска не значит «удалён» */
    const hidden = (p: string) => p.split('/').some((x) => skipSet.has(x)) || ig(p, false)
    sum.truncated = !!truncated
    const base = loadBase(pid)
    if (folderLost(Object.keys(disk).length, Object.keys(base).length)) {
      useBackend.setState({ lastError: 'Папка проекта пуста или недоступна: ' + proj.path })
      if (!lostWarned.has(pid)) {
        lostWarned.add(pid)
        toast({
          title: 'Папка проекта пуста или недоступна',
          desc:
            proj.path + ' — ничего не удаляю. Если папка на месте, а файлы стёрты, их можно записать заново.',
          icon: 'warn',
          tone: 'warn',
          action: {
            label: 'Записать файлы заново',
            run: () => {
              forgetBase(pid)
              lostWarned.delete(pid)
              void reconcile(pid)
            },
          },
        })
      }
      return null
    }
    const files = proj.files
    const store: Record<string, string> = {}
    for (const k in files) store[k] = fnv(files[k])
    const write: Record<string, string> = {},
      remove: string[] = [],
      pull: string[] = [],
      dropLocal: string[] = []
    const next: Record<string, string> = {}
    const all = new Set([...Object.keys(disk), ...Object.keys(store), ...Object.keys(base)])
    all.forEach((path) => {
      if (!(path in store) && (path === '.gitignore' || path.endsWith('.DS_Store'))) return // служебные файлы бэкенда
      const d = disk[path],
        s = store[path],
        b = base[path]
      /* эту версию уже пытались записать/удалить — не вышло; ждём, пока файл изменят (иначе повтор каждые 2,5 с) */
      const bad = badPaths.get(pid)?.[path]
      if (bad !== undefined && (bad === 'rm' ? s === undefined : bad === s)) {
        if (bad === 'rm' && b !== undefined) next[path] = b
        return
      }
      /* папка слишком большая и прочитана не вся: отсутствие файла на диске ничего не значит */
      if ((truncated || hidden(path)) && d === undefined && b !== undefined) {
        next[path] = b
        return
      }
      if (d === s) {
        if (d) next[path] = d
        return
      }
      const storeSame = b !== undefined && s === b,
        diskSame = b !== undefined && d === b
      if (b === undefined) {
        if (d === undefined) {
          write[path] = files[path]
          next[path] = s
        } else if (s === undefined) {
          pull.push(path)
        } else {
          write[path] = files[path]
          next[path] = s
          sum.conflicts++
        }
      } else if (storeSame) {
        // изменился диск
        if (d === undefined) dropLocal.push(path)
        else pull.push(path)
      } else if (diskSame) {
        // изменился стор
        if (s === undefined) remove.push(path)
        else {
          write[path] = files[path]
          next[path] = s
        }
      } else {
        // оба
        sum.conflicts++
        if (s === undefined) remove.push(path)
        else {
          write[path] = files[path]
          next[path] = s
        }
      }
    })
    /* пустые папки из дерева приложения → на диск; убранные из дерева — удалить, если пусты */
    const pj = proj
    const hasFile = (d: string) => Object.keys(files).some((f) => f.startsWith(d + '/'))
    const emptyNow = pj.dirs.filter((d) => !hasFile(d))
    const madeDirs = loadDirs(pid)
    const mkdirs = emptyNow.filter((d) => !madeDirs.has(d))
    const rmdirs = [...madeDirs].filter((d) => !pj.dirs.includes(d))
    if (Object.keys(write).length || remove.length || mkdirs.length || rmdirs.length) {
      const r = await bBatch(proj, write, remove, { make: mkdirs, drop: rmdirs })
      failed = r.failed || []
      const bad: Record<string, string> = {}
      for (const f of failed) {
        if (f.path in write) {
          bad[f.path] = store[f.path]
          delete next[f.path]
        } else {
          bad[f.path] = 'rm'
          if (base[f.path] !== undefined) next[f.path] = base[f.path]
        }
      }
      badPaths.set(pid, { ...(badPaths.get(pid) || {}), ...bad })
      saveDirs(pid, new Set(emptyNow))
      sum.pushed = Object.keys(write).length
      sum.removed += remove.length
    } else if (madeDirs.size !== emptyNow.length || emptyNow.some((d) => !madeDirs.has(d)))
      saveDirs(pid, new Set(emptyNow))
    if (pull.length) {
      const r = await bRead(proj, pull)
      const got: Record<string, string> = {}
      for (const k of pull) {
        const v = r.files[k]
        if (typeof v === 'string') {
          got[k] = v
          next[k] = disk[k]
        }
      }
      if (Object.keys(got).length || dropLocal.length) {
        importExternal(pid, got, dropLocal)
        sum.pulled = Object.keys(got).length
        sum.removed += dropLocal.length
      }
    } else if (dropLocal.length) {
      importExternal(pid, {}, dropLocal)
      sum.removed += dropLocal.length
    }
    baseline.set(pid, next)
    saveBase(pid)
    /* git: коммит на каждую новую версию */
    const vs = S().projects.find((p) => p.id === pid)?.versions || []
    const last = vs[vs.length - 1]
    if (last && committed.get(pid) !== last.n) {
      if (committed.has(pid))
        void bCommit(proj, `v${last.n}: ${last.title}`)
          .then(() => mirrorPush(pid))
          .catch(() => {})
      committed.set(pid, last.n)
    }
    useBackend.setState({ lastSync: Date.now(), lastError: undefined })
    if (failed.length) {
      const why = (c: string) =>
        c === 'ENAMETOOLONG'
          ? 'слишком длинное имя'
          : c === 'EBUSY' || c === 'EPERM' || c === 'EACCES'
            ? 'нет доступа'
            : c
      const list = failed.slice(0, 3).map((f) => `${f.path.split('/').pop()} (${why(f.code)})`)
      useBackend.setState({ lastError: `Не записано на диск: ${failed.length} ф.` })
      toast({
        title: 'Не удалось записать на диск',
        desc:
          list.join(', ') +
          (failed.length > 3 ? ` и ещё ${failed.length - 3}` : '') +
          '. Остальные файлы записаны.',
        icon: 'warn',
        tone: 'warn',
      })
    }
    if (sum.conflicts && !opts.quiet)
      toast({
        title: 'Файлы менялись и здесь, и на диске',
        desc: 'Оставил версию из приложения. Старая — в Git и «Истории».',
        icon: 'warn',
        tone: 'warn',
      })
    return sum
  } catch (e) {
    useBackend.setState({ lastError: (e as Error).message })
    return null
  } finally {
    busy.delete(pid)
    useBackend.setState({ syncing: false })
    if (queued.delete(pid)) schedule(pid, 150)
  }
}

const pushing = new Set<string>()
let mirrorWarned = ''
/** Зеркало: после коммита новой версии отправляем историю на удалённый репозиторий (если включено в проекте) */
async function mirrorPush(pid: string) {
  const p = S().projects.find((x) => x.id === pid)
  if (!p?.mirror || pushing.has(pid)) return
  pushing.add(pid)
  try {
    const r = await bGit<{ ok: boolean; reason?: string }>('push', p)
    if (r.ok) {
      mirrorWarned = ''
    } else if (r.reason !== mirrorWarned) {
      mirrorWarned = r.reason || 'ошибка'
      toast({
        title: 'Зеркало: не удалось отправить версию',
        desc: r.reason,
        icon: 'warn',
        tone: 'warn',
        action: { label: 'Репозиторий', run: () => S().openModal({ type: 'remote' }) },
      })
    }
  } catch {
    /* сервер недоступен — в следующий раз */
  } finally {
    pushing.delete(pid)
  }
}

function importExternal(pid: string, got: Record<string, string>, drop: string[]) {
  const st = S()
  st.up((p: Project) => {
    for (const [k, v] of Object.entries(got)) {
      p.files[k] = v
      const seg = k.split('/')
      seg.pop()
      for (let i = 1; i <= seg.length; i++) {
        const d = seg.slice(0, i).join('/')
        if (!p.dirs.includes(d)) p.dirs.push(d)
      }
    }
    for (const k of drop) delete p.files[k]
  }, pid)
  const names = [...Object.keys(got), ...drop]
  const n = st.commit(
    {
      title: 'Правки с диска',
      by: 'human',
      author: st.people.me.name,
      tag: 'build',
      feats: [],
      changes: [...Object.keys(got).map((k) => 'Изменён ' + k), ...drop.map((k) => 'Удалён ' + k)],
      fixes: [],
      details: ['Внешний редактор или команда в терминале изменили файлы в папке проекта'],
    },
    pid,
  )
  committed.set(pid, n)
  toast({
    title: 'Правки с диска подхвачены',
    desc: names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '') + ` → v${n}`,
    icon: 'refresh',
  })
}

function schedule(pid: string, ms = 300) {
  if (timers.has(pid)) clearTimeout(timers.get(pid)!)
  timers.set(
    pid,
    setTimeout(() => {
      timers.delete(pid)
      void reconcile(pid)
    }, ms),
  )
}

export const resyncNow = async () => {
  const pid = S().projectId
  return pid ? reconcile(pid) : null
}

/** Запускается один раз при старте приложения */
export function startSync() {
  if (started) return
  started = true
  void detectBackend().then((ok) => {
    if (ok) kick()
  })
  let prevPid = S().projectId
  useStore.subscribe((s) => {
    if (s.projectId !== prevPid) {
      prevPid = s.projectId
      if (prevPid && backendOnline()) schedule(prevPid, 50)
    }
    if (!backendOnline() || s.settings.backendSync === false) return
    for (const p of s.projects) {
      if (!seen.has(p.files)) {
        seen.set(p.files, true)
        if (p.id === s.projectId || baseline.has(p.id)) schedule(p.id)
      }
    }
  })
  useBackend.subscribe((b, prev) => {
    if (b.status === 'online' && prev.status !== 'online') kick()
  })
  poll = setInterval(() => {
    if (document.hidden || !syncEnabled()) return
    const pid = S().projectId
    if (pid && S().screen === 'workspace') void reconcile(pid, { quiet: true })
  }, 2500)
  window.addEventListener('focus', () => {
    const pid = S().projectId
    if (pid && syncEnabled()) void reconcile(pid)
  })
  setInterval(() => {
    if (!backendOnline() && !document.hidden) void detectBackend()
  }, 15000)
}
function kick() {
  const pid = S().projectId
  if (pid) void reconcile(pid)
}
/** Вызывается при открытии проекта: первая сверка */
export function syncProjectOpened(pid: string) {
  if (syncEnabled()) void reconcile(pid)
}
export const stopSync = () => {
  if (poll) clearInterval(poll)
  poll = null
  started = false
  seen = new WeakMap()
}
