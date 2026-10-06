/* Командные проекты: приглашения по почте и облачная синхронизация.
   Облако хранит снимок проекта (файлы + документы, задачи, чаты, память). Слияние — трёхстороннее:
   файлы по хэшам относительно последней общей версии, конфликт не теряет данных (чужая версия сохраняется рядом).
   Текстовые файлы при одновременной правке сливаются построчно (diff3, как в git); маркеры конфликта ставятся только на пересечении правок.
   Лента версий и запуски деплоя общие; снимки версий (snapshot) остаются у автора. Удаления помечаются «надгробиями», чтобы не воскресать.
   Изменения доезжают по SSE-потоку почти мгновенно (запасной вариант — опрос раз в 5 с). */
import { useStore } from '../store'
import { create } from 'zustand'
import type { Project, Person, Version, TeamEntry, LineComment, DeployRun, Task } from '../types'
import { api, ApiError, useAccount, refreshInvites, clearInvite } from './account'
import { fnv, serverOnline, useBackend } from './backend'
import { authHeader, getToken } from './token'
import { merge3, hasMarkers } from './merge3'
import { emptyProject } from '../data/seed'
import { initialsOf } from './util'

const S = () => useStore.getState()
const cpid = (p: Pick<Project, 'id' | 'cloud'>) => p.cloud?.pid || p.id
const myUid = () => useAccount.getState().user?.id

interface Meta {
  desc: string
  icon: Project['icon']
  template: string
  tools: string[]
  docs: Project['docs']
  tasks: Project['tasks']
  taskSeq: number
  memory: Project['memory']
  chats: Project['chats']
  history?: TeamEntry[]
  deploy?: { auto: boolean; runs: DeployRun[] }
  comments?: LineComment[]
  tomb?: Record<string, number>
}
interface Base {
  rev: number
  files: Record<string, string>
  meta: string
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
    /* квота */
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

/** локальные id → серверные (me → uid) и обратно */
const toWire = <T>(o: T, uid: string): T => JSON.parse(JSON.stringify(o), (_k, v) => (v === 'me' ? uid : v))
const fromWire = <T>(o: T, uid: string): T => JSON.parse(JSON.stringify(o), (_k, v) => (v === uid ? 'me' : v))

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

function exportMeta(p: Project): Meta {
  const chats = p.chats.map((c) => ({
    ...c,
    running: false,
    messages: c.messages.slice(-80).map((m) => {
      const x = { ...m } as Record<string, unknown>
      delete x.live
      return x as unknown as typeof m
    }),
  }))
  const runs = p.deploy.runs.map((r) => ({ ...r, log: r.log.slice(-200) }))
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
    saveBase(pid, { rev: 1, files: hashes(p.files), meta: fnv(JSON.stringify(exportMeta(p))) })
    setTxt(pid, { ...p.files })
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
    saveBase(t.id, { rev: t.rev, files: hashes(t.files), meta: fnv(JSON.stringify(t.meta ?? {})) })
    setTxt(t.id, { ...t.files })
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

type Stamp<T> = (x: T) => number
function mergeSet<T extends { id: string }>(
  local: T[],
  remote: T[],
  stamp: Stamp<T>,
  tomb: Record<string, number>,
): T[] {
  const m = new Map(local.map((x) => [x.id, x]))
  for (const r of remote) {
    const l = m.get(r.id)
    if (!l || stamp(r) > stamp(l)) m.set(r.id, r)
  }
  return [...m.values()].filter((x) => !(tomb[x.id] > stamp(x)))
}
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

/** вливаем чужую мету в проект. unchanged — у меня с прошлой синхронизации ничего не менялось, можно просто взять чужое */
function applyMeta(p: Project, rm: Meta, unchanged: boolean) {
  /* мета пришла по сети: у клиента старой версии каких-то полей может не быть — не падаем, а берём пустые */
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
  const running = new Set(p.chats.filter((c) => c.running).map((c) => c.id))
  const localChats = p.chats
  const docStamp: Stamp<Project['docs'][0]> = (x) => x.updatedAt || 0
  const taskStamp: Stamp<Task> = (x) => x.updatedAt || 0
  const memStamp: Stamp<Project['memory'][0]> = (x) => x.at
  const chatStamp: Stamp<Project['chats'][0]> = (x) => x.lastAt
  if (unchanged && !running.size) {
    const keep = <T extends { id: string }>(xs: T[], st: Stamp<T>) => xs.filter((x) => !(tomb[x.id] > st(x)))
    p.docs = keep(rm.docs, docStamp)
    p.tasks = keep(rm.tasks, taskStamp)
    p.memory = keep(rm.memory, memStamp)
    p.chats = keep(rm.chats, chatStamp)
    p.desc = rm.desc
    p.comments = rm.comments || p.comments
    if (rm.deploy) p.deploy.auto = rm.deploy.auto
  } else {
    p.docs = mergeSet(p.docs, rm.docs, docStamp, tomb)
    p.tasks = mergeSet(p.tasks, rm.tasks, taskStamp, tomb)
    p.memory = mergeSet(p.memory, rm.memory, memStamp, tomb)
    const rc = new Map(rm.chats.map((c) => [c.id, c]))
    p.chats = mergeSet(localChats, rm.chats, chatStamp, tomb).map((c) => {
      const l = localChats.find((x) => x.id === c.id)
      const r = rc.get(c.id)
      if (!l || !r || running.has(c.id)) return running.has(c.id) && l ? l : c
      const msgs = [...new Map([...l.messages, ...r.messages].map((m) => [m.id, m])).values()].sort(
        (a, b) => (a.at || 0) - (b.at || 0),
      )
      return {
        ...(chatStamp(r) > chatStamp(l) ? r : l),
        lastAt: Math.max(l.lastAt, r.lastAt),
        messages: msgs,
      }
    })
    p.comments = mergeSet(p.comments || [], rm.comments || [], (c) => c.at, tomb)
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
}

/** один проход: забрать чужое → слить → отправить своё. true — сервер ушёл вперёд, нужно повторить сразу */
async function tickOnce(pid: string): Promise<boolean> {
  const p0 = S().projects.find((p) => p.id === pid)
  const uid = myUid()
  if (!p0?.cloud || !uid || !getToken() || !serverOnline()) return false
  const cp = p0.cloud.pid
  setCS(pid, { ...(cloudState.get(pid) || { at: 0 }), syncing: true })
  let retry = false
  try {
    let base = loadBase(cp) || {
      rev: p0.cloud.rev,
      files: hashes(p0.files),
      meta: fnv(JSON.stringify(exportMeta(p0))),
    }
    let bt = getTxt(cp) ?? (loadBase(cp) ? undefined : { ...p0.files })
    const r = await api<{
      same?: true
      rev: number
      files?: Record<string, string>
      dirs?: string[]
      meta?: Meta | null
      by?: { id: string; name: string }
    }>('GET', `/api/team/${encodeURIComponent(cp)}?since=${base.rev}`)
    let rev = base.rev
    if (!r.same && r.files) {
      /* ← чужие изменения */
      const remoteFiles = r.files
      const bh = base.files
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
            p.files[k + '.cloud'] = remoteFiles[k]
            copies.push(k)
          } /* нет общего предка — сохраняем обе версии */
        }
        for (const d of r.dirs || []) if (!p.dirs.includes(d)) p.dirs.push(d)
      }, pid)
      const rm = r.meta ? fromWire(r.meta, uid) : null
      if (rm) {
        const cur = S().projects.find((p) => p.id === pid)!
        const unchanged = fnv(JSON.stringify(exportMeta(cur))) === base.meta
        S().up((p) => applyMeta(p, rm, unchanged), pid)
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
      base = { rev, files: hashes(remoteFiles), meta: r.meta ? fnv(JSON.stringify(r.meta)) : base.meta }
      bt = remoteFiles
    }
    /* → наши изменения */
    const p = S().projects.find((x) => x.id === pid)!
    if (hasRunning(p)) {
      saveBase(cp, base)
      if (bt) setTxt(cp, bt)
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
    if (!sameFiles || mh !== base.meta) {
      try {
        const put = await api<{ rev: number }>('PUT', `/api/team/${encodeURIComponent(cp)}`, {
          baseRev: rev,
          files: out,
          dirs: p.dirs,
          meta,
        })
        rev = put.rev
        base = { rev, files: fh, meta: mh }
        bt = out
      } catch (e) {
        if ((e as ApiError).status !== 409) throw e
        retry = true /* на сервере новее — забираем и сливаем прямо сейчас */
      }
    }
    saveBase(cp, base)
    if (bt) setTxt(cp, bt)
    if (p.cloud?.rev !== rev)
      S().up((x) => {
        if (x.cloud) x.cloud.rev = rev
      }, pid)
    setCS(pid, { at: Date.now() })
  } catch (e) {
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
      p.docs,
      p.tasks,
      p.memory,
      p.chats.length,
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
