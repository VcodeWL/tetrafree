/* Командные проекты: приглашения по почте и облачная синхронизация.
   Облако хранит снимок проекта (файлы + документы, задачи, чаты, память). Слияние — трёхстороннее:
   файлы по хэшам относительно последней общей версии, конфликт не теряет данных (чужая версия сохраняется рядом).
   Текстовые файлы при одновременной правке сливаются построчно (diff3, как в git); маркеры конфликта ставятся только на пересечении правок.
   Лента версий и запуски деплоя общие; снимки версий (snapshot) остаются у автора. Удаления помечаются «надгробиями», чтобы не воскресать.
   Изменения доезжают по SSE-потоку почти мгновенно (запасной вариант — опрос раз в 5 с). */
import { useStore } from '../store'
import { create } from 'zustand'
import type { Project, Person, Version, TeamEntry, DeployRun } from '../types'
import { api, ApiError, useAccount, refreshInvites, clearInvite } from './account'
import { fnv, serverOnline, useBackend } from './backend'
import { authHeader, getToken } from './token'
import { merge3, hasMarkers } from './merge3'
import { emptyProject } from '../data/seed'
import { initialsOf } from './util'
import * as persistence from '../store/persistence'
import { convertMetaIds, mergeRecords, mergeValue, type TeamMeta } from './teamMetadata'
import { recoveryPath } from './syncRecovery'
import {
  createSyncJournal,
  normalizeDirs,
  mergeDirs,
  undoAncestor,
  journalReplayPolicy,
  type SyncIntent,
} from './syncJournal'

const S = () => useStore.getState()
const cpid = (p: Pick<Project, 'id' | 'cloud'>) => p.cloud?.pid || p.id
const myUid = () => useAccount.getState().user?.id

type Meta = TeamMeta
interface Base {
  rev: number
  files: Record<string, string>
  meta: string
  /** Wire-format ancestor, optional for older checkpoints. */
  metadata?: Meta
  dirs?: string[]
}
const baseKey = (pid: string) => 'tf-cloud:' + pid
const loadBase = (pid: string): Base | null => {
  try {
    return JSON.parse(localStorage.getItem(baseKey(pid)) || 'null')
  } catch {
    return null
  }
}
const saveBase = (pid: string, b: Base) => {
  try {
    localStorage.setItem(baseKey(pid), JSON.stringify(b))
  } catch {
    throw new Error('Не удалось сохранить облачный checkpoint: локальное хранилище недоступно')
  }
}
const hashes = (f: Record<string, string>) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fnv(v)]))

/* Тексты последней синхронизированной версии — «общий предок» для diff3. В памяти — все, в localStorage — только небольшие (до ~1.2 МБ). */
const txtKey = (pid: string) => 'tf-cloud-txt:' + pid
const txtMem = new Map<string, Record<string, string>>()
const getTxt = (pid: string): Record<string, string> | undefined => {
  if (!txtMem.has(pid)) {
    try {
      const v = JSON.parse(localStorage.getItem(txtKey(pid)) || 'null')
      if (v) txtMem.set(pid, v)
    } catch {
      /* битые данные */
    }
  }
  return txtMem.get(pid)
}
const setTxt = (pid: string, files: Record<string, string>) => {
  txtMem.set(pid, files)
  const keep: Record<string, string> = {}
  let used = 0
  for (const [k, v] of Object.entries(files))
    if (v.length <= 120_000 && used + v.length <= 1_200_000) {
      keep[k] = v
      used += v.length
    }
  try {
    localStorage.setItem(txtKey(pid), JSON.stringify(keep))
  } catch {
    /* квота */
  }
}

const toWire = (o: Meta, uid: string) => convertMetaIds(o, uid, 'to')
const fromWire = (o: Meta, uid: string) => convertMetaIds(o, uid, 'from')

const entryOf = (v: Version): TeamEntry => {
  const { snapshot, ...r } = v
  void snapshot
  return { ...r, id: v.id || 'l' + v.at.toString(36) + fnv(v.author + v.title) }
}
const byAt = <T extends { id: string }>(xs: T[], at: (x: T) => number) =>
  [...xs].sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : 1))
const mergeHistory = (a: TeamEntry[], b: TeamEntry[]) => {
  const m = new Map<string, TeamEntry>()
  for (const e of [...a, ...b]) m.set(e.id, e)
  return byAt([...m.values()], (e) => e.at).slice(-200)
}
const canonTomb = (t?: Record<string, number>) =>
  Object.fromEntries(Object.entries(t || {}).sort(([x], [y]) => (x < y ? -1 : 1)))
/** история версий команды: свои версии (кроме производных «Облако: …») + чужие, пришедшие по сети */
export const teamHistory = (p: Project): TeamEntry[] =>
  mergeHistory(
    p.cloud?.team || [],
    p.versions.filter((v) => !/^(Облако|Из облака):/.test(v.title)).map(entryOf),
  )

function exportMeta(p: Project, bounded = true): Meta {
  const chats = p.chats.map((c) => ({
    ...c,
    running: false,
    messages: (bounded ? c.messages.slice(-80) : c.messages).map((m) => {
      const x = { ...m } as Record<string, unknown>
      delete x.live
      return x as unknown as typeof m
    }),
  }))
  const runs = p.deploy.runs.map((r) => ({ ...r, log: bounded ? r.log.slice(-200) : r.log }))
  return toWire(
    {
      desc: p.desc,
      icon: p.icon,
      template: p.template,
      tools: p.tools,
      docs: p.docs,
      tasks: p.tasks,
      taskSeq: p.taskSeq,
      memory: p.memory,
      chats,
      history: teamHistory(p),
      deploy: { auto: p.deploy.auto, runs },
      comments: byAt(p.comments || [], (c) => c.at),
      tomb: canonTomb(p.cloud?.tomb),
    },
    myUid() || 'me',
  )
}

/** поля проекта из чужой меты (для нового проекта у приглашённого) */
function fromMeta(meta: Meta): Partial<Project> {
  return {
    desc: meta.desc,
    icon: meta.icon,
    template: meta.template,
    tools: meta.tools,
    docs: meta.docs || [],
    tasks: meta.tasks || [],
    taskSeq: meta.taskSeq || 1,
    memory: meta.memory || [],
    chats: meta.chats || [],
    ...(meta.deploy ? { deploy: { auto: meta.deploy.auto, runs: meta.deploy.runs } } : {}),
    ...(meta.comments ? { comments: meta.comments } : {}),
  }
}

export interface InviteResult {
  link?: string
  mail: 'dev' | 'smtp'
  mailError?: string | null
}
export async function inviteByEmail(p: Project, email: string): Promise<InviteResult> {
  const uid = myUid()
  if (!uid) throw new ApiError('Войди в аккаунт, чтобы приглашать людей', 401)
  const pid = cpid(p) === p.id && !p.cloud ? `${p.id}-${Math.random().toString(36).slice(2, 8)}` : cpid(p)
  const r = await api<{
    invite: { id: string }
    mail: 'dev' | 'smtp'
    mailError: string | null
    link?: string
  }>('POST', '/api/invites', {
    pid,
    name: p.name,
    email,
    files: p.files,
    dirs: p.dirs,
    meta: p.cloud ? undefined : exportMeta(p),
  })
  if (!p.cloud) {
    S().up((x) => {
      x.cloud = { pid, rev: 1, owner: true, ownerId: uid }
    }, p.id)
    const metadata = exportMeta(p)
    await persistence.flushPersistence()
    const current = S().projects.find((x) => x.id === p.id)
    if (
      current?.cloud?.pid === pid &&
      current.files === p.files &&
      JSON.stringify(exportMeta(current)) === JSON.stringify(metadata)
    ) {
      saveBase(pid, {
        rev: 1,
        files: hashes(p.files),
        meta: fnv(JSON.stringify(metadata)),
        metadata,
        dirs: normalizeDirs(p.dirs),
      })
      setTxt(pid, { ...p.files })
    }
  }
  return { link: r.link, mail: r.mail, mailError: r.mailError }
}

export async function listInvites(pid: string) {
  return (
    await api<{ invites: { id: string; email: string; status: string; at: number; exp: number }[] }>(
      'GET',
      '/api/invites?pid=' + encodeURIComponent(pid),
    )
  ).invites
}
export const revokeInvite = (id: string) => api('DELETE', '/api/invites/' + id)

export interface Peer {
  uid: string
  name: string
  hue: number
  file: string
  line: number
  at: number
}
/** кто сейчас в каком файле: projectId → участники (без меня) */
export const usePeers = create<{
  by: Record<string, Peer[]>
  live: Record<string, boolean>
  sync: Record<string, { at: number; error?: string; syncing?: boolean }>
}>(() => ({ by: {}, live: {}, sync: {} }))
interface Member {
  id: string
  name: string
  email: string
  hue: number
  owner: boolean
  online: boolean
  where: string
  file?: string
  line?: number
  lastSeen: number
}
function applyMembers(cp: string, members: Member[]) {
  const uid = myUid()
  useStore.setState((s) => {
    const p = s.projects.find((x) => x.cloud?.pid === cp)
    if (!p) return
    const ids: string[] = []
    for (const m of members) {
      const id = m.id === uid ? 'me' : m.id
      ids.push(id)
      if (id === 'me') continue
      const prev = s.people[id]
      const person: Person = {
        ...(prev || {}),
        id,
        name: m.name,
        initials: initialsOf(m.name),
        email: m.email,
        hue: m.hue,
        status: m.online ? 'online' : 'offline',
        role: m.where ? 'сейчас: ' + m.where : prev?.role,
      }
      s.people[id] = person
    }
    if (!ids.includes('me')) ids.unshift('me')
    p.members = ids
    const pe = members
      .filter((m) => m.id !== uid && m.online)
      .map((m) => ({
        uid: m.id,
        name: m.name,
        hue: m.hue,
        file: m.file || '',
        line: m.line || 0,
        at: m.lastSeen,
      }))
    const lid = p.id
    queueMicrotask(() => usePeers.setState((x) => ({ by: { ...x.by, [lid]: pe } })))
    if (p.cloud && !p.cloud.owner) p.creator = p.cloud.ownerId
  })
}

export async function acceptInvite(tokenOrId: string) {
  const uid = myUid()
  if (!uid) throw new ApiError('Войди в аккаунт', 401)
  const r = await api<{
    team: {
      id: string
      name: string
      rev: number
      files: Record<string, string>
      dirs: string[]
      meta: Meta | null
      ownerId: string
    }
    members: Member[]
  }>('POST', `/api/invites/${encodeURIComponent(tokenOrId)}/accept`)
  const t = r.team
  const s = S()
  let local = s.projects.find((p) => p.cloud?.pid === t.id)
  if (!local) {
    const meta = t.meta ? fromWire(t.meta, uid) : null
    const name = s.projects.some((p) => p.name === t.name) ? `${t.name} (команда)` : t.name
    const now = Date.now()
    const id = s.projects.some((p) => p.id === t.id)
      ? `${t.id}-${Math.random().toString(36).slice(2, 6)}`
      : t.id
    const proj: Project = emptyProject({
      id,
      name,
      files: t.files,
      dirs: t.dirs,
      creator: t.ownerId,
      members: ['me'],
      ...(meta ? fromMeta(meta) : {}),
      versions: [
        {
          n: 1,
          title: 'Из облака: присоединился к проекту',
          at: now,
          by: 'human',
          author: s.people.me.name,
          tag: 'build',
          feats: [],
          changes: [],
          fixes: [],
          details: [],
          snapshot: { ...t.files },
        },
      ],
      cloud: {
        pid: t.id,
        rev: t.rev,
        owner: false,
        ownerId: t.ownerId,
        tomb: t.meta?.tomb || {},
        team: t.meta?.history || [],
      },
    })
    proj.files = { ...t.files }
    useStore.setState((x) => {
      x.projects.unshift(proj)
    })
    const checkpointProject = S().projects.find((x) => x.id === id)!
    await persistence.flushPersistence()
    if (S().projects.find((x) => x.id === id) === checkpointProject) {
      saveBase(t.id, {
        rev: t.rev,
        files: hashes(t.files),
        meta: fnv(JSON.stringify(t.meta ?? {})),
        ...(t.meta ? { metadata: t.meta } : {}),
        dirs: normalizeDirs(t.dirs),
      })
      setTxt(t.id, { ...t.files })
    }
    local = proj
  }
  applyMembers(
    t.id,
    r.members.map((m) => ({ ...m, owner: false, online: false, where: '', lastSeen: 0 })),
  )
  clearInvite()
  void refreshInvites()
  return local.id
}
export async function declineInvite(tokenOrId: string) {
  await api('POST', `/api/invites/${encodeURIComponent(tokenOrId)}/decline`)
  clearInvite()
  void refreshInvites()
}

export async function leaveProject(pid: string) {
  const uid = myUid()
  const pr = S().projects.find((x) => x.id === pid)
  if (!uid || !pr?.cloud) return
  await api('DELETE', `/api/team/${encodeURIComponent(cpid(pr))}/members/${encodeURIComponent(uid)}`)
  S().up((p) => {
    p.cloud = undefined
  }, pid)
}
export async function removeFromTeam(cp: string, uid: string) {
  await api('DELETE', `/api/team/${encodeURIComponent(cp)}/members/${encodeURIComponent(uid)}`)
}
export async function fetchMembers(cp: string) {
  const r = await api<{ members: Member[] }>('GET', `/api/team/${encodeURIComponent(cp)}/members`)
  applyMembers(cp, r.members)
  return r.members
}

/* ───────── синхронизация ───────── */
type CS = { at: number; error?: string; syncing?: boolean }
export const cloudState = new Map<string, CS>()
const setCS = (pid: string, v: CS) => {
  cloudState.set(pid, v)
  usePeers.setState((x) => ({ sync: { ...x.sync, [pid]: v } }))
}
const hasRunning = (p: Project) => p.chats.some((c) => c.running)

/** запуск деплоя: завершённое важнее «идёт»; зависшие чужие «идёт» (> 15 мин) считаем прерванными */
function mergeRuns(local: DeployRun[], remote: DeployRun[]): DeployRun[] {
  const m = new Map(local.map((x) => [x.id, x]))
  for (const r of remote) {
    const l = m.get(r.id)
    if (
      !l ||
      (l.status === 'running' && r.status !== 'running') ||
      (l.status === 'running' && r.status === 'running' && r.log.length > l.log.length)
    )
      m.set(r.id, r)
  }
  return [...m.values()]
    .map((r) =>
      r.status === 'running' && Date.now() - r.at > 15 * 60e3
        ? {
            ...r,
            status: 'failed' as const,
            log: [...r.log, 'прервано: устройство, запустившее пайплайн, не ответило'],
          }
        : r,
    )
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
    .slice(0, 40)
}

/** Merge each field/ID-bearing child against its own ancestor. Missing wire messages are not deletes. */
function applyMeta(p: Project, rm: Meta, ancestor?: Meta): number {
  rm = {
    ...rm,
    docs: rm.docs || [],
    tasks: rm.tasks || [],
    memory: rm.memory || [],
    chats: rm.chats || [],
    taskSeq: rm.taskSeq || 0,
    desc: rm.desc ?? p.desc,
  }
  const tomb: Record<string, number> = { ...(p.cloud?.tomb || {}) }
  for (const [k, v] of Object.entries(rm.tomb || {})) tomb[k] = Math.max(tomb[k] || 0, v)
  for (const k in tomb) if (tomb[k] < Date.now() - 90 * 864e5) delete tomb[k]
  if (p.cloud) p.cloud.tomb = tomb
  let conflicts = 0
  const docs = mergeRecords(p.docs, rm.docs, ancestor?.docs, tomb, (x) => x.updatedAt || 0)
  p.docs = docs.records
  conflicts += docs.conflicts
  const tasks = mergeRecords(p.tasks, rm.tasks, ancestor?.tasks, tomb, (x) => x.updatedAt || 0)
  p.tasks = tasks.records
  conflicts += tasks.conflicts
  const memory = mergeRecords(p.memory, rm.memory, ancestor?.memory, tomb, (x) => x.at)
  p.memory = memory.records
  conflicts += memory.conflicts
  const chats = mergeRecords(p.chats, rm.chats, ancestor?.chats, tomb, (x) => x.lastAt)
  p.chats = chats.records.map((c) => ({ ...c, messages: byAt(c.messages, (m) => m.at || 0) }))
  conflicts += chats.conflicts
  const comments = mergeRecords(p.comments || [], rm.comments || [], ancestor?.comments, tomb, (x) => x.at)
  p.comments = comments.records
  conflicts += comments.conflicts
  const scalarConflicts: Record<string, unknown> = {}
  for (const key of ['desc', 'icon', 'template', 'tools'] as const) {
    if (rm[key] === undefined) continue
    const merged = mergeValue(p[key], rm[key], ancestor?.[key])
    if (merged.conflict) scalarConflicts[key] = rm[key]
    else Object.assign(p, { [key]: merged.value })
  }
  if (rm.deploy) {
    const auto = mergeValue(p.deploy.auto, rm.deploy.auto, ancestor?.deploy?.auto)
    if (auto.conflict) scalarConflicts['deploy.auto'] = rm.deploy.auto
    else p.deploy.auto = auto.value as boolean
  }
  if (Object.keys(scalarConflicts).length) {
    const path = recoveryPath('metadata', 'cloud.json', Object.keys(p.files), p.dirs)
    p.files[path] = JSON.stringify({ reason: 'Конфликт полей проекта', remote: scalarConflicts }, null, 2)
    conflicts++
  }
  p.taskSeq = Math.max(p.taskSeq, rm.taskSeq)
  /* две задачи с одним номером (создали одновременно) — более поздней даём новый */
  const seen = new Set<number>()
  for (const t of [...p.tasks].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))) {
    if (seen.has(t.key)) {
      t.key = p.taskSeq++
      t.updatedAt = Date.now()
    }
    seen.add(t.key)
  }
  if (rm.deploy) p.deploy.runs = mergeRuns(p.deploy.runs, rm.deploy.runs)
  if (p.cloud) p.cloud.team = mergeHistory(p.cloud.team || [], rm.history || [])
  return conflicts
}

interface CloudLocal {
  files: Record<string, string>
  dirs: string[]
  meta: Meta
}
interface CloudAck {
  base: Base
  texts?: Record<string, string>
}
const cloudJournal = createSyncJournal<CloudAck, CloudLocal>()
const cloudJournalKey = (cp: string) => 'tf-cloud-intent:' + cp
const localCloud = (p: Project): CloudLocal => ({
  files: { ...p.files },
  dirs: normalizeDirs(p.dirs),
  meta: exportMeta(p, false),
})
function recoverCloudLocal(p: Project, intent: SyncIntent<CloudAck, CloudLocal>, uid: string) {
  const desired = intent.local,
    meta = fromWire(desired.meta, uid)
  Object.assign(p, fromMeta(meta))
  p.files = { ...desired.files }
  p.dirs = [...desired.dirs]
  if (p.cloud) {
    p.cloud.tomb = { ...(meta.tomb || {}) }
    p.cloud.team = meta.history || p.cloud.team
  }
}
function preserveAmbiguousCloud(p: Project, intent: SyncIntent<CloudAck, CloudLocal>) {
  const text = JSON.stringify(
    {
      reason:
        'Возраст snapshot или новые runtime-правки не разрешают replay. Live не изменён; проверь сохранённый local intent.',
      desired: intent.local,
      prior: intent.prior,
    },
    null,
    2,
  )
  if (!Object.values(p.files).includes(text))
    p.files[recoveryPath('metadata', 'journal-recovery.json', Object.keys(p.files), p.dirs)] = text
}

/** один проход: забрать чужое → слить → отправить своё. true — сервер ушёл вперёд, нужно повторить сразу */
async function tickOnce(pid: string): Promise<boolean> {
  const p0 = S().projects.find((p) => p.id === pid)
  const uid = myUid()
  if (!p0?.cloud || !uid || !getToken() || !serverOnline()) return false
  const cp = p0.cloud.pid
  const token = getToken(),
    backend = useBackend.getState().base
  const sameContext = () => {
    const p = S().projects.find((x) => x.id === pid)
    return (
      p?.cloud?.pid === cp &&
      myUid() === uid &&
      getToken() === token &&
      useBackend.getState().base === backend
    )
  }
  setCS(pid, { ...(cloudState.get(pid) || { at: 0 }), syncing: true })
  let retry = false
  try {
    // No checkpoint is not proof that the current edits are a common ancestor.
    const journalKey = cloudJournalKey(cp),
      scope = JSON.stringify([backend, uid, cp])
    const loaded = await cloudJournal.load(journalKey)
    if (!sameContext()) return false
    let intent = loaded.intent
    if (intent && intent.scope !== scope)
      throw new Error('Ack journal принадлежит другому контексту; требуется восстановление')
    if (intent && journalReplayPolicy(intent, loaded.recovered) === 'ambiguous') {
      if (!intent.recoveryBlocked) {
        intent = { ...intent, recoveryBlocked: true }
        await cloudJournal.save(journalKey, intent, true)
        if (!sameContext()) return false
      }
      S().up((p) => preserveAmbiguousCloud(p, intent!), pid)
      S().toast({
        title: 'Требуется проверка journal recovery',
        desc: 'Live оставлен без замены. Другая версия сохранена в metadata.journal-recovery.json. Облачный clean checkpoint не продвинут.',
        icon: 'warn',
        tone: 'warn',
      })
      await persistence.flushPersistence()
      throw new Error('Неоднозначное journal recovery: сохранил обе версии, автоматический replay остановлен')
    }
    if (loaded.recovered && intent && journalReplayPolicy(intent, loaded.recovered) === 'replay')
      S().up((p) => recoverCloudLocal(p, intent!, uid), pid)
    let base = intent?.ack.base || loadBase(cp) || { rev: 0, files: {}, meta: '' }
    let bt = intent?.ack.texts || getTxt(cp)
    const r = await api<{
      same?: true
      rev: number
      files?: Record<string, string>
      dirs?: string[]
      meta?: Meta | null
      by?: { id: string; name: string }
    }>('GET', `/api/team/${encodeURIComponent(cp)}?since=${intent?.phase === 'prepared' ? 0 : base.rev}`)
    if (!sameContext()) return false
    let rev = base.rev
    if (!r.same && r.files) {
      /* ← чужие изменения */
      const remoteFiles = r.files
      const beforeMerge = localCloud(S().projects.find((x) => x.id === pid)!)
      const requestLocal = intent?.phase === 'prepared' ? intent.prior : localCloud(p0)
      const bh = undoAncestor(base.files, hashes(requestLocal.files), hashes(beforeMerge.files)) as Record<
        string,
        string
      >
      const who = r.by?.name || 'участник'
      const applied: string[] = [],
        merged: string[] = [],
        conflicts: string[] = [],
        copies: string[] = []
      S().up((p) => {
        const keys = new Set([...Object.keys(p.files), ...Object.keys(remoteFiles), ...Object.keys(bh)])
        for (const k of keys) {
          const lh = p.files[k] === undefined ? undefined : fnv(p.files[k])
          const rh = remoteFiles[k] === undefined ? undefined : fnv(remoteFiles[k])
          const b = bh[k]
          if (rh === b) continue /* удалённо не менялось */
          if (lh === rh) continue /* уже одинаково */
          if (lh === b || lh === undefined) {
            /* я не трогал (или удалил, а там правили — правка важнее удаления) */
            if (remoteFiles[k] === undefined) delete p.files[k]
            else p.files[k] = remoteFiles[k]
            applied.push(k)
            continue
          }
          if (remoteFiles[k] === undefined)
            continue /* там удалили, а я правил — оставляю свою, она вернётся в облако */
          const old = bt?.[k]
          const m =
            old !== undefined && fnv(old) === b
              ? merge3(old, p.files[k], remoteFiles[k], { ours: 'мои правки', theirs: who })
              : null
          if (m) {
            p.files[k] = m.text
            ;(m.conflict ? conflicts : merged).push(k)
          } else {
            const copy = recoveryPath(
              k,
              'cloud',
              [...Object.keys(p.files), ...Object.keys(remoteFiles), ...Object.keys(bh)],
              [...p.dirs, ...(r.dirs || [])],
            )
            p.files[copy] = remoteFiles[k]
            copies.push(k)
          } /* нет общего предка — сохраняем обе версии */
        }
        p.dirs = mergeDirs(p.dirs, r.dirs || [], base.dirs, requestLocal.dirs)
        // A remotely removed empty directory cannot hide a surviving local file's parent.
        for (const file of Object.keys(p.files)) {
          const parts = file.split('/')
          parts.pop()
          for (let n = 1; n <= parts.length; n++) {
            const dir = parts.slice(0, n).join('/')
            if (!p.dirs.includes(dir)) p.dirs.push(dir)
          }
        }
      }, pid)
      const rm = r.meta ? fromWire(r.meta, uid) : null
      if (rm) {
        let metaConflicts = 0
        const ancestorWire = undoAncestor(base.metadata, requestLocal.meta, beforeMerge.meta) as
          Meta | undefined
        const ancestor = ancestorWire ? fromWire(ancestorWire, uid) : undefined
        S().up((p) => {
          metaConflicts = applyMeta(p, rm, ancestor)
        }, pid)
        if (metaConflicts)
          S().toast({
            title: 'Конфликт метаданных команды',
            desc: 'Независимые поля слиты; пересекающиеся правки сохранены конфликтными копиями. Проверь документы, задачи, память и чаты.',
            icon: 'warn',
            tone: 'warn',
          })
      }
      const st = S()
      if (applied.length || merged.length) {
        st.commit(
          {
            title: `Облако: правки от ${who}`,
            by: 'human',
            author: who,
            tag: 'build',
            feats: [],
            changes: [...applied, ...merged].slice(0, 12).map((k) => 'Изменён ' + k),
            fixes: [],
            details: merged.length ? ['Слито построчно с твоими правками: ' + merged.join(', ')] : [],
          },
          pid,
        )
        st.toast({
          title: `Облако: обновления от ${who}`,
          desc:
            [...applied, ...merged].slice(0, 3).join(', ') +
            (applied.length + merged.length > 3 ? ` и ещё ${applied.length + merged.length - 3}` : '') +
            (merged.length ? ' · слито с твоими правками' : ''),
          icon: 'refresh',
        })
      }
      if (conflicts.length)
        st.toast({
          title: 'Конфликт правок в одной строке',
          desc: `${conflicts.slice(0, 2).join(', ')}: оставили маркеры <<<<<<< ======= >>>>>>>. Выбери нужное — пока там маркеры, файл не уходит в облако.`,
          icon: 'warn',
          tone: 'warn',
        })
      if (copies.length)
        st.toast({
          title: 'Не удалось слить автоматически',
          desc: `${copies.slice(0, 2).join(', ')}: твоя версия осталась, чужая — рядом с суффиксом .cloud`,
          icon: 'warn',
          tone: 'warn',
        })
      rev = r.rev
      base = {
        rev,
        files: hashes(remoteFiles),
        meta: r.meta ? fnv(JSON.stringify(r.meta)) : base.meta,
        metadata: r.meta || base.metadata,
        dirs: normalizeDirs(r.dirs || []),
      }
      bt = remoteFiles
      const local = localCloud(S().projects.find((x) => x.id === pid)!)
      intent = {
        phase: 'accepted',
        scope,
        ack: { base, texts: bt },
        prior:
          intent?.prior ||
          (JSON.stringify(beforeMerge) !== JSON.stringify(requestLocal) ? requestLocal : local),
        local,
      }
      await cloudJournal.save(journalKey, intent)
      if (!sameContext()) return false
    }
    /* → наши изменения */
    const p = S().projects.find((x) => x.id === pid)!
    if (hasRunning(p)) {
      const metaAtCheckpoint = JSON.stringify(exportMeta(p))
      try {
        await persistence.flushPersistence()
      } catch (error) {
        if (intent && sameContext())
          await cloudJournal.save(journalKey, {
            ...intent,
            local: localCloud(S().projects.find((x) => x.id === pid)!),
          })
        throw error
      }
      if (!sameContext()) return false
      const latest = S().projects.find((x) => x.id === pid)!
      if (
        latest.files !== p.files ||
        latest.dirs !== p.dirs ||
        JSON.stringify(exportMeta(latest)) !== metaAtCheckpoint
      ) {
        if (intent) await cloudJournal.save(journalKey, { ...intent, local: localCloud(latest) })
        return true
      }
      saveBase(cp, base)
      if (bt) setTxt(cp, bt)
      if (intent) await cloudJournal.save(journalKey, null)
      return false
    }
    const out: Record<string, string> = { ...p.files }
    for (const k of Object.keys(out))
      if (hasMarkers(out[k]) && bt && bt[k] !== undefined && base.files[k] === fnv(bt[k]))
        out[k] = bt[k] /* файл с маркерами конфликта не отдаём */
    const meta = exportMeta(p)
    const mh = fnv(JSON.stringify(meta))
    const fh = hashes(out)
    const sameFiles =
      Object.keys(fh).length === Object.keys(base.files).length &&
      Object.entries(fh).every(([k, v]) => base.files[k] === v)
    const dirs = normalizeDirs(p.dirs)
    const sameDirs =
      base.dirs !== undefined && JSON.stringify(dirs) === JSON.stringify(normalizeDirs(base.dirs))
    if (!sameFiles || mh !== base.meta || !sameDirs) {
      const prior = localCloud(p)
      intent = { phase: 'prepared', scope, ack: { base, texts: bt }, prior, local: prior }
      await cloudJournal.save(journalKey, intent)
      if (!sameContext()) return false
      try {
        const put = await api<{ rev: number }>('PUT', `/api/team/${encodeURIComponent(cp)}`, {
          baseRev: rev,
          files: out,
          dirs,
          meta,
        })
        rev = put.rev
        base = { rev, files: fh, meta: mh, metadata: meta, dirs }
        bt = out
        if (!sameContext()) return false
        intent = {
          ...intent,
          phase: 'accepted',
          ack: { base, texts: bt },
          local: localCloud(S().projects.find((x) => x.id === pid)!),
        }
        await cloudJournal.save(journalKey, intent)
      } catch (e) {
        if (sameContext() && intent) {
          intent = { ...intent, local: localCloud(S().projects.find((x) => x.id === pid)!) }
          await cloudJournal.save(journalKey, intent)
        }
        if ((e as ApiError).status !== 409) throw e
        retry = true /* на сервере новее — забираем и сливаем прямо сейчас */
      }
    }
    try {
      await persistence.flushPersistence()
    } catch (error) {
      if (intent && sameContext())
        await cloudJournal.save(journalKey, {
          ...intent,
          local: localCloud(S().projects.find((x) => x.id === pid)!),
        })
      throw error
    }
    if (!sameContext()) return false
    const current = S().projects.find((x) => x.id === pid)!
    // Changes during PUT/flush are not the acknowledged generation. Re-fetch from the old checkpoint.
    if (
      current.files !== p.files ||
      JSON.stringify(exportMeta(current)) !== JSON.stringify(meta) ||
      JSON.stringify(normalizeDirs(current.dirs)) !== JSON.stringify(dirs)
    ) {
      if (intent) await cloudJournal.save(journalKey, { ...intent, local: localCloud(current) })
      return true
    }
    saveBase(cp, base)
    if (bt) setTxt(cp, bt)
    if (intent) await cloudJournal.save(journalKey, null)
    if (p.cloud?.rev !== rev)
      S().up((x) => {
        if (x.cloud) x.cloud.rev = rev
      }, pid)
    setCS(pid, { at: Date.now() })
  } catch (e) {
    if (!sameContext()) return false
    const err = e as ApiError
    if (err.status === 404) {
      S().up((x) => {
        x.cloud = undefined
      }, pid)
      S().toast({
        title: `«${p0.name}» больше не в облаке`,
        desc: 'Проект удалили или тебя убрали из участников. Локальная копия осталась.',
        icon: 'warn',
        tone: 'warn',
      })
    } else setCS(pid, { at: Date.now(), error: err.message })
  } finally {
    const c = cloudState.get(pid)
    if (c) setCS(pid, { ...c, syncing: false })
  }
  return retry
}

const running = new Map<string, Promise<void>>()
const pending = new Set<string>()
/** синхронизировать сейчас. Вызовы во время идущего прохода не теряются — после него будет ещё один */
export function cloudNow(pid: string): Promise<void> {
  const cur = running.get(pid)
  if (cur) {
    pending.add(pid)
    return cur
  }
  const pr = (async () => {
    try {
      for (let i = 0; i < 6; i++) {
        pending.delete(pid)
        const again = await tickOnce(pid)
        if (!again && !pending.has(pid)) break
      }
    } finally {
      running.delete(pid)
    }
  })()
  running.set(pid, pr)
  return pr
}

/* ───────── присутствие и поток событий ───────── */
let myPos = { file: '', line: 0 }
let posTimer: ReturnType<typeof setTimeout> | null = null
const presenceBody = () => {
  const s = S()
  const cur = s.projects.find((p) => p.id === s.projectId)
  const c = s.center
  const where =
    c.kind === 'chat'
      ? 'чат «' + (cur?.chats.find((x) => x.id === c.id)?.title || '') + '»'
      : c.kind === 'doc'
        ? 'документ'
        : c.kind === 'tasks'
          ? 'задачи'
          : s.activeFile || ''
  return {
    where,
    file: s.screen === 'workspace' && s.rightOpen && s.rightTab === 'code' ? myPos.file : '',
    line: myPos.line,
  }
}
const sendPresence = () => {
  const cur = S().projects.find((p) => p.id === S().projectId)
  if (cur?.cloud && getToken())
    void api('POST', `/api/team/${encodeURIComponent(cur.cloud.pid)}/presence`, presenceBody()).catch(
      () => {},
    )
}
/** где сейчас курсор в редакторе (файл и строка с 1) */
export const currentCaret = () => myPos
/** редактор сообщает, где курсор: коллеги увидят метку на этой строке */
export function reportCaret(file: string, line: number) {
  if (myPos.file === file && myPos.line === line) return
  myPos = { file, line }
  if (!posTimer)
    posTimer = setTimeout(() => {
      posTimer = null
      sendPresence()
    }, 900)
}

const sleep = (ms: number, sig: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms)
    sig.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        res()
      },
      { once: true },
    )
  })
async function watch(pid: string, cp: string, ac: AbortController) {
  let delay = 1000
  const setLive = (v: boolean) =>
    usePeers.setState((x) => (x.live[pid] === v ? x : { live: { ...x.live, [pid]: v } }))
  while (!ac.signal.aborted) {
    try {
      const r = await fetch(useBackend.getState().base + `/api/team/${encodeURIComponent(cp)}/events`, {
        headers: authHeader(),
        signal: ac.signal,
      })
      if (r.status === 404 || r.status === 401) {
        setLive(false)
        return
      }
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
      setLive(true)
      delay = 1000
      void cloudNow(pid)
      const rd = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await rd.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const line = ev.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let m: { t: string; uid?: string; file?: string; line?: number; at?: number; where?: string }
          try {
            m = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (m.t === 'rev') void cloudNow(pid)
          else if (m.t === 'members') void fetchMembers(cp).catch(() => {})
          else if (m.t === 'presence' && m.uid) {
            const person = S().people[m.uid]
            if (!person) {
              void fetchMembers(cp).catch(() => {})
              continue
            }
            const peer: Peer = {
              uid: m.uid,
              name: person.name,
              hue: person.hue ?? 0,
              file: m.file || '',
              line: m.line || 0,
              at: m.at || Date.now(),
            }
            usePeers.setState((x) => ({
              by: { ...x.by, [pid]: [...(x.by[pid] || []).filter((q) => q.uid !== m.uid), peer] },
            }))
          }
        }
      }
    } catch {
      /* обрыв — переподключимся */
    }
    setLive(false)
    if (ac.signal.aborted) return
    await sleep(delay, ac.signal)
    delay = Math.min(delay * 2, 15000)
  }
}

export function startCloud() {
  let n = 0
  setInterval(() => {
    if (document.hidden || !getToken() || !serverOnline()) return
    n++
    const s = S()
    for (const p of s.projects) if (p.cloud && (p.id === s.projectId || n % 4 === 0)) void cloudNow(p.id)
    const cur = s.projects.find((p) => p.id === s.projectId)
    if (cur?.cloud && s.screen === 'workspace') {
      sendPresence()
      if (n % 2 === 0) void fetchMembers(cur.cloud.pid).catch(() => {})
    }
  }, 5000)
  /* поток событий — только для открытого облачного проекта */
  let watching: { pid: string; cp: string; ac: AbortController } | null = null
  const rewatch = () => {
    const s = S()
    const p = s.screen === 'workspace' ? s.projects.find((x) => x.id === s.projectId) : undefined
    const want = p?.cloud && getToken() && serverOnline() ? { pid: p.id, cp: p.cloud.pid } : null
    if (watching && (!want || watching.pid !== want.pid || watching.cp !== want.cp)) {
      watching.ac.abort()
      usePeers.setState((x) => ({ live: { ...x.live, [watching!.pid]: false } }))
      watching = null
    }
    if (want && !watching) {
      const ac = new AbortController()
      watching = { ...want, ac }
      void watch(want.pid, want.cp, ac)
    }
  }
  /* после изменений в открытом облачном проекте — быстрый пуш */
  let t: ReturnType<typeof setTimeout> | null = null
  let prev: unknown[] | null = null
  useStore.subscribe((s) => {
    rewatch()
    const p = s.projects.find((x) => x.id === s.projectId)
    if (!p?.cloud) return
    const sig = [
      p.files,
      p.dirs,
      p.docs,
      p.tasks,
      p.memory,
      p.chats,
      p.comments,
      p.deploy.runs,
      p.versions.length,
    ]
    if (prev && sig.every((x, i) => x === prev![i])) return
    prev = sig
    if (t) clearTimeout(t)
    t = setTimeout(() => void cloudNow(p.id), 700)
  })
  setInterval(rewatch, 4000)
}
