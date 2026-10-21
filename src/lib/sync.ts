/* Двусторонняя синхронизация проекта с папкой на диске (через локальный бэкенд).
   Для каждого файла помним «базовый» хеш — то, что было одинаково и там и там.
   Изменился только стор → пишем на диск. Изменился только диск → импортируем как версию «Правки с диска».
   Изменились оба → сначала durable recovery-копия чужого текста, затем CAS-запись своей версии. */
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
  captureBackendContextRevision,
} from './backend'

import { folderLost } from './paths'
import { makeIgnore } from './ignore'
import { recoveryPath } from './syncRecovery'
import { getToken, getTokenRevision } from './token'
import {
  beginSyncHealth,
  resolvedSyncHealth,
  finishSyncHealth,
  invalidateSyncHealth,
  checkpointProject,
  captureSyncHealth,
} from './syncStatus'
export { captureSyncHealth } from './syncStatus'
import { createSyncJournal, journalReplayPolicy, type SyncIntent } from './syncJournal'

type DiskLocal = Record<string, string>
interface DiskAck {
  files: Record<string, string>
  attempted?: string[]
}
const diskJournal = createSyncJournal<DiskAck, DiskLocal>()
const diskJournalKey = (pid: string, scope: string) => 'tf-sync-intent:' + pid + ':' + fnv(scope)
const resetIntents = new Set<string>()
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
    throw new Error('Не удалось сохранить disk checkpoint: локальное хранилище недоступно')
  }
}

const generations = new Map<string, number>()
/** Забыть, что было «одинаковым» на диске и в приложении (после смены папки или осознанного восстановления) */
export function forgetBase(pid: string) {
  invalidateSyncHealth(pid)
  resetIntents.add(pid)
  generations.set(pid, (generations.get(pid) || 0) + 1)
  baseline.set(pid, {})
  saveBase(pid)
}
const lostWarned = new Set<string>()
const synced = new Map<string, string>()
const syncIdentity = (pid: string) =>
  JSON.stringify([
    S().projects.find((p) => p.id === pid)?.path,
    useBackend.getState().base,
    captureBackendContextRevision(),
    getTokenRevision(),
    generations.get(pid) || 0,
  ])
/** Была ли хоть одна успешная сверка проекта с диском (до неё файлы на диске ещё не видны приложению) */
export const hasSynced = (pid: string) => syncEnabled() && synced.get(pid) === syncIdentity(pid)
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
  const generation = generations.get(pid) || 0
  const backend = useBackend.getState().base,
    token = getToken(),
    tokenRevision = getTokenRevision(),
    backendEpoch = captureBackendContextRevision()
  let folder = proj.path
  const current = () => S().projects.find((p) => p.id === pid)
  const valid = () =>
    current()?.path === folder &&
    (generations.get(pid) || 0) === generation &&
    useBackend.getState().base === backend &&
    getToken() === token &&
    getTokenRevision() === tokenRevision &&
    captureBackendContextRevision() === backendEpoch &&
    syncEnabled()
  const assertContext = () => {
    if (!valid()) throw new Error('Контекст синхронизации изменился; checkpoint не продвинут')
  }
  busy.add(pid)
  const health = beginSyncHealth(pid)
  let completed = false,
    healthPending = false
  useBackend.setState({ syncing: true })
  let failed: { path: string; code: string; error: string }[] = []
  const sum = { pushed: 0, pulled: 0, removed: 0, conflicts: 0, truncated: false }
  try {
    /* проект из версий до 2.0 не знает свою папку — спрашиваем у сервера и запоминаем */
    if (!isAbsPath(proj.path)) {
      const r = await bResolve(proj)
      assertContext()
      S().up((p) => {
        p.path = r.dir
      }, pid)
      proj = S().projects.find((p) => p.id === pid)!
      folder = proj.path
      resolvedSyncHealth(pid, health)
    }
    const scope = JSON.stringify([backend, folder, pid]),
      journalKey = diskJournalKey(pid, scope)
    const loaded = await diskJournal.load(journalKey)
    assertContext()
    let intent: SyncIntent<DiskAck, DiskLocal> | null = loaded.intent
    if (resetIntents.has(pid)) {
      if (intent) {
        await diskJournal.save(journalKey + ':recovery:' + Date.now().toString(36), intent, true)
        await diskJournal.save(journalKey, null)
      }
      resetIntents.delete(pid)
      intent = null
    }
    if (intent && intent.scope !== scope)
      throw new Error('Disk ack journal принадлежит другой папке/backend; требуется восстановление')
    if (intent && journalReplayPolicy(intent, loaded.recovered) === 'ambiguous') {
      if (!intent.recoveryBlocked) {
        intent = { ...intent, recoveryBlocked: true }
        await diskJournal.save(journalKey, intent, true)
        assertContext()
      }
      const text = JSON.stringify(
        {
          reason: 'Возраст snapshot или новые runtime-правки не разрешают replay; live не заменён',
          desired: intent.local,
          prior: intent.prior,
        },
        null,
        2,
      )
      S().up((p) => {
        if (!Object.values(p.files).includes(text))
          p.files[recoveryPath('files', 'journal-recovery.json', Object.keys(p.files), p.dirs)] = text
      }, pid)
      toast({
        title: 'Требуется проверка disk journal',
        desc: 'Обе версии сохранены: live и files.journal-recovery.json. Автоматический replay и clean checkpoint остановлены.',
        icon: 'warn',
        tone: 'warn',
      })
      await checkpointProject(pid)
      throw new Error('Неоднозначное disk journal recovery; требуется явное восстановление')
    }
    if (loaded.recovered && intent && journalReplayPolicy(intent, loaded.recovered) === 'replay') {
      const desired = intent.local
      S().up((p) => {
        p.files = { ...desired }
      }, pid)
      proj = current()!
    }
    const { hashes: disk, truncated, ignore, skip } = await bHashes(proj)
    assertContext()
    const ig = makeIgnore(ignore || '')
    const skipSet = new Set(skip || [])
    /* файлы, которые сервер не показывает (.gitignore, node_modules…): их отсутствие в списке диска не значит «удалён» */
    const hidden = (p: string) => p.split('/').some((x) => skipSet.has(x)) || ig(p, false)
    sum.truncated = !!truncated
    const base = { ...(intent?.ack.files || loadBase(pid)) }
    const uncertain = new Set(intent?.ack.attempted || [])
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
              if (!valid()) return
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
      dropLocal: string[] = [],
      recover: string[] = []
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
        if (b !== undefined) next[path] = b
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
      const storeSame = b !== undefined && s === b && !uncertain.has(path),
        diskSame = b !== undefined && d === b
      if (b === undefined) {
        if (d === undefined) {
          write[path] = files[path]
          next[path] = s
        } else if (s === undefined) {
          if (uncertain.has(path)) {
            // A prepared first creation was undone locally; remote-only is not proof of untouched local.
            recover.push(path)
            remove.push(path)
            sum.conflicts++
          } else pull.push(path)
        } else {
          write[path] = files[path]
          next[path] = s
          sum.conflicts++
          recover.push(path)
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
        if (d !== undefined) recover.push(path)
        if (s === undefined) remove.push(path)
        else {
          write[path] = files[path]
          next[path] = s
        }
      }
    })
    if (recover.length) {
      const r = await bRead(proj, recover)
      assertContext()
      const copies: Record<string, string> = {}
      const occupied = [...Object.keys(current()!.files), ...Object.keys(disk), ...Object.keys(base)]
      for (const path of recover) {
        const text = r.files[path]
        // Scan/read mismatch, oversized/unreadable file: defer rather than destroy unknown bytes.
        if (typeof text !== 'string' || fnv(text) !== disk[path]) {
          delete write[path]
          const i = remove.indexOf(path)
          if (i >= 0) remove.splice(i, 1)
          delete next[path]
          if (base[path] !== undefined) next[path] = base[path]
          queued.add(pid)
          continue
        }
        const prefix = (path + '.disk-conflict').toLowerCase()
        const existing = Object.entries(current()!.files).find(([k, v]) => {
          const name = k.toLowerCase(),
            rest = name.slice(prefix.length)
          return (
            v === text &&
            name.startsWith(prefix) &&
            (!rest || /^\.\d+$/.test(rest)) &&
            (!(k in write) || write[k] === text) &&
            !remove.includes(k) &&
            !pull.includes(k) &&
            !dropLocal.includes(k)
          )
        })
        // A failed checkpoint must not grow another identical recovery file on every poll.
        if (existing) continue
        const copy = recoveryPath(path, 'disk-conflict', occupied, current()!.dirs)
        occupied.push(copy)
        copies[copy] = text
      }
      if (Object.keys(copies).length) {
        S().up((p) => Object.assign(p.files, copies), pid)
        // A failed/unavailable checkpoint blocks overwrite/delete: recovery must survive restart first.
        await checkpointProject(pid)
        assertContext()
      }
    }
    /* пустые папки из дерева приложения → на диск; убранные из дерева — удалить, если пусты */
    const pj = proj
    const hasFile = (d: string) => Object.keys(files).some((f) => f.startsWith(d + '/'))
    const emptyNow = pj.dirs.filter((d) => !hasFile(d))
    const madeDirs = loadDirs(pid)
    const mkdirs = emptyNow.filter((d) => !madeDirs.has(d))
    const rmdirs = [...madeDirs].filter((d) => !pj.dirs.includes(d))
    if (Object.keys(write).length || remove.length || mkdirs.length || rmdirs.length) {
      await checkpointProject(pid)
      assertContext()
      const expectedHashes = Object.fromEntries(
        [...Object.keys(write), ...remove].map((k) => [k, disk[k] ?? null]),
      )
      const prior = { ...files }
      intent = {
        phase: 'prepared',
        scope,
        ack: { files: base, attempted: [...Object.keys(write), ...remove] },
        prior,
        local: { ...current()!.files },
      }
      await diskJournal.save(journalKey, intent)
      assertContext()
      const r = await bBatch(proj, write, remove, { make: mkdirs, drop: rmdirs }, expectedHashes).catch(
        async (error: unknown) => {
          if (valid() && intent) {
            intent = { ...intent, local: { ...current()!.files } }
            await diskJournal.save(journalKey, intent)
          }
          throw error
        },
      )
      assertContext()
      failed = r.failed || []
      const acknowledged = { ...base },
        rejected = new Set(failed.map((f) => f.path))
      for (const [k, v] of Object.entries(write)) if (!rejected.has(k)) acknowledged[k] = fnv(v)
      for (const k of remove) if (!rejected.has(k)) delete acknowledged[k]
      intent = {
        ...intent,
        phase: 'accepted',
        ack: {
          files: acknowledged,
          attempted: failed.filter((f) => f.path in write || remove.includes(f.path)).map((f) => f.path),
        },
        local: { ...current()!.files },
      }
      await diskJournal.save(journalKey, intent)
      assertContext()
      const bad: Record<string, string> = {}
      for (const f of failed) {
        if (f.code === 'CONFLICT') {
          delete next[f.path]
          if (base[f.path] !== undefined) next[f.path] = base[f.path]
          delete badPaths.get(pid)?.[f.path]
          queued.add(pid)
          continue
        }
        if (f.path in write) {
          bad[f.path] = store[f.path]
          delete next[f.path]
          if (base[f.path] !== undefined) next[f.path] = base[f.path]
        } else {
          bad[f.path] = 'rm'
          if (base[f.path] !== undefined) next[f.path] = base[f.path]
        }
      }
      badPaths.set(pid, { ...(badPaths.get(pid) || {}), ...bad })
      const failedPaths = new Set(failed.map((f) => f.path))
      const successfulDirs = new Set(madeDirs)
      for (const d of mkdirs) if (!failedPaths.has(d)) successfulDirs.add(d)
      for (const d of rmdirs) if (!failedPaths.has(d)) successfulDirs.delete(d)
      saveDirs(pid, successfulDirs)
      sum.pushed = Object.keys(write).filter((k) => !failedPaths.has(k)).length
      sum.removed += remove.filter((k) => !failedPaths.has(k)).length
    } else if (madeDirs.size !== emptyNow.length || emptyNow.some((d) => !madeDirs.has(d)))
      saveDirs(pid, new Set(emptyNow))
    const got: Record<string, string> = {}
    if (pull.length) {
      const r = await bRead(proj, pull)
      assertContext()
      for (const k of pull) {
        const v = r.files[k]
        if (typeof v === 'string' && fnv(v) === disk[k]) got[k] = v
        else {
          if (base[k] !== undefined) next[k] = base[k]
          queued.add(pid)
        }
      }
    }
    // Always compare, including drop-only passes. Check inside the synchronous mutation too.
    assertContext()
    const beforeImport = current()!.files
    let imported = 0,
      dropped = 0
    const acceptedNames: string[] = [],
      droppedNames: string[] = []
    const untouched = (now: Record<string, string>, k: string) => now[k] === files[k]
    S().up((p) => {
      const accepted: Record<string, string> = {},
        drops: string[] = []
      for (const [k, v] of Object.entries(got)) {
        if (untouched(p.files, k)) {
          accepted[k] = v
          next[k] = fnv(v)
          imported++
          acceptedNames.push(k)
        } else {
          if (base[k] !== undefined) next[k] = base[k]
          queued.add(pid)
        }
      }
      for (const k of dropLocal) {
        if (untouched(p.files, k)) {
          drops.push(k)
          dropped++
          droppedNames.push(k)
        } else {
          next[k] = base[k]
          queued.add(pid)
        }
      }
      for (const [k, v] of Object.entries(accepted)) {
        p.files[k] = v
        const seg = k.split('/')
        seg.pop()
        for (let i = 1; i <= seg.length; i++) {
          const d = seg.slice(0, i).join('/')
          if (!p.dirs.includes(d)) p.dirs.push(d)
        }
      }
      for (const k of drops) delete p.files[k]
    }, pid)
    if (imported || dropped) recordExternal(pid, acceptedNames, droppedNames)
    sum.pulled = imported
    sum.removed += dropped
    const checkpointFiles = current()!.files
    if (intent || JSON.stringify(next) !== JSON.stringify(base)) {
      intent = {
        phase: 'accepted',
        scope,
        ack: { files: next, attempted: intent?.ack.attempted },
        prior: intent?.prior || (beforeImport !== files ? { ...files } : { ...checkpointFiles }),
        local: { ...checkpointFiles },
      }
      await diskJournal.save(journalKey, intent)
      assertContext()
    }
    try {
      await checkpointProject(pid)
    } catch (error) {
      if (intent && valid()) await diskJournal.save(journalKey, { ...intent, local: { ...current()!.files } })
      throw error
    }
    assertContext()
    if (current()!.files !== checkpointFiles) {
      if (intent) await diskJournal.save(journalKey, { ...intent, local: { ...current()!.files } })
      queued.add(pid)
      throw new Error('Файлы изменились во время checkpoint; baseline не продвинут')
    }
    // Store updates racing a disk write remain unacknowledged; retry from the previous base.
    for (const k of Object.keys(write))
      if (!failed.some((f) => f.path === k) && current()!.files[k] !== write[k]) {
        if (intent) await diskJournal.save(journalKey, { ...intent, local: { ...current()!.files } })
        queued.add(pid)
        throw new Error('Файлы изменились во время записи; ack сохранён отдельно от dirty local')
      }
    for (const k of remove)
      if (!failed.some((f) => f.path === k) && current()!.files[k] !== undefined) {
        if (intent) await diskJournal.save(journalKey, { ...intent, local: { ...current()!.files } })
        queued.add(pid)
        throw new Error('Удалённый файл восстановлен во время записи; ack сохранён отдельно от dirty local')
      }
    // Persist before replacing the in-memory baseline as well.
    localStorage.setItem(KEY(pid), JSON.stringify(next))
    baseline.set(pid, next)
    if (intent && !intent.ack.attempted?.length) await diskJournal.save(journalKey, null)
    /* git: коммит на каждую новую версию */
    const vs = S().projects.find((p) => p.id === pid)?.versions || []
    const last = vs[vs.length - 1]
    if (last && committed.get(pid) !== last.n) {
      if (committed.has(pid))
        void bCommit(proj, `v${last.n}: ${last.title}`)
          .then(() => {
            if (valid()) return mirrorPush(pid)
          })
          .catch(() => {})
      committed.set(pid, last.n)
    }
    synced.set(pid, syncIdentity(pid))
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
        desc: 'Чужой прочитанный текст сохранён в файлах .disk-conflict. Непрочитанные или изменившиеся файлы не перезаписывались. Git-восстановление не гарантируется.',
        icon: 'warn',
        tone: 'warn',
      })
    // Health is an observation, not a baseline mutation. A no-write pass may still
    // have raced a local edit: never stamp the newest file ref as verified blindly.
    const live = current()!
    healthPending =
      queued.has(pid) ||
      live.dirs !== proj.dirs ||
      [...new Set([...Object.keys(live.files), ...Object.keys(next)])].some(
        (k) => !hidden(k) && (live.files[k] === undefined ? undefined : fnv(live.files[k])) !== next[k],
      )
    completed = true
    return sum
  } catch (e) {
    if (valid()) useBackend.setState({ lastError: (e as Error).message })
    return null
  } finally {
    finishSyncHealth(
      pid,
      health,
      completed
        ? {
            failedFiles: failed.length,
            conflicts: sum.conflicts,
            truncated: sum.truncated,
            pending: healthPending,
          }
        : undefined,
    )
    busy.delete(pid)
    useBackend.setState({ syncing: busy.size > 0 })
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
  const identity = syncIdentity(pid),
    mirror = p.mirror
  const valid = () =>
    syncIdentity(pid) === identity && S().projects.find((x) => x.id === pid)?.mirror === mirror
  try {
    const r = await bGit<{ ok: boolean; reason?: string }>('push', p)
    if (!valid()) return
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

function recordExternal(pid: string, changed: string[], drop: string[]) {
  const st = S()
  const names = [...changed, ...drop]
  const n = st.commit(
    {
      title: 'Правки с диска',
      by: 'human',
      author: st.people.me.name,
      tag: 'build',
      feats: [],
      changes: [...changed.map((k) => 'Изменён ' + k), ...drop.map((k) => 'Удалён ' + k)],
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

/** Safe explicit retry; no baseline/journal reset, no duplicate request while this pid is running. */
export async function retryProjectSync(pid: string) {
  if (!captureSyncHealth(pid).canRetry) return null
  if (syncEnabled()) {
    badPaths.delete(pid) // Explicit retry permits unchanged files after permissions/disk space were repaired.
    return reconcile(pid)
  }
  try {
    await checkpointProject(pid)
  } catch {
    /* status reports failed checkpoint; no false disk ACK */
  }
  return null
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
    if (
      b.status === 'online' &&
      (prev.status !== 'online' || b.base !== prev.base || b.info?.local !== prev.info?.local)
    )
      kick()
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
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  queued.clear()
  if (poll) clearInterval(poll)
  poll = null
  started = false
  seen = new WeakMap()
}
