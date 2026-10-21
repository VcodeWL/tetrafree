/* Клиент аккаунтов: вход, сессия, приглашения. Источник правды — сервер (server/auth.mjs). */
import { create } from 'zustand'
import { useBackend, detectBackend, serverOnline } from './backend'
import { authHeader, getToken, getTokenRevision, setToken } from './token'
import { useStore } from '../store'
import { resyncNow } from './sync'

export interface Acc {
  id: string
  name: string
  email: string
  verified: boolean
  twofa: boolean
  createdAt: number
  hue: number
  providers: string[]
  hasPassword: boolean
}
export interface AuthConfig {
  mail: 'dev' | 'smtp'
  oauth: string[]
  hasUsers: boolean
}
export interface InviteInfo {
  projectName: string
  by: string
  email: string
  emailMasked: string
  status: 'pending' | 'expired' | 'accepted' | 'declined' | 'revoked'
  exp: number
}
export interface MyInvite {
  id: string
  pid: string
  projectName: string
  email: string
  by: { id: string; name: string; email: string }
  at: number
  exp: number
  status: string
}
interface A {
  user: Acc | null
  config: AuthConfig | null
  checked: boolean
  inviteToken: string | null
  invites: MyInvite[]
}
export const useAccount = create<A>(() => ({
  user: null,
  config: null,
  checked: false,
  inviteToken: null,
  invites: [],
}))
const U = () => useAccount.getState()

export class ApiError extends Error {
  constructor(
    m: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(m)
  }
}

let recoveryMode = false
/** Startup recovery may permit sign-in, but never start disk/cloud work yet. */
export function setAccountRecoveryMode(on: boolean) {
  recoveryMode = on
}
let sessionEpoch = 0
let identityProof: { context: SessionContext; id: string } | null = null
export type SessionContext = { epoch: number; token: string | null; base: string; tokenRevision: number }
/** OAuth/MFA callers may capture this before starting a flow and pass it to applySession. */
export const captureSession = (): SessionContext => ({
  epoch: sessionEpoch,
  token: getToken(),
  tokenRevision: getTokenRevision(),
  base: useBackend.getState().base,
})
export const sessionIsCurrent = (context: SessionContext) =>
  context.epoch === sessionEpoch &&
  context.token === getToken() &&
  context.tokenRevision === getTokenRevision() &&
  context.base === useBackend.getState().base
/** Identity is trusted only for the exact server and token verified by the server. */
export function confirmedAccountId(): string | null {
  const proof = identityProof
  return proof && sessionIsCurrent(proof.context) && U().user?.id === proof.id ? proof.id : null
}
const responseSessions = new WeakMap<object, SessionContext>()
useBackend.subscribe((next, prev) => {
  if (next.base !== prev.base) {
    identityProof = null
    sessionEpoch++
    useAccount.setState({ user: null, config: null, invites: [], checked: false })
  }
})

export function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body)
}
/** Relevance check occurs before HTTP errors can expire a newer verification result. */
async function request<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  relevant: () => boolean = () => true,
): Promise<T> {
  if (!serverOnline()) throw new ApiError('Сервер недоступен. Запусти `npm run dev` или `npm run server`.', 0)
  const context = captureSession()
  let r: Response
  try {
    r = await fetch(context.base + path, {
      method,
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Нет связи с сервером', 0)
  }
  const j = await r.json().catch(() => ({}))
  if (!sessionIsCurrent(context) || !relevant()) throw new ApiError('Ответ устаревшей сессии отклонён', 0)
  if (!r.ok) {
    if (r.status === 401 && getToken() && !path.startsWith('/api/auth/login')) expireSession()
    throw new ApiError(j.error?.message || 'Ошибка ' + r.status, r.status, j.error || j)
  }
  if (j && typeof j === 'object') responseSessions.set(j, context)
  return j as T
}

/** сессия истекла или отозвана на другом устройстве */
function expireSession() {
  identityProof = null
  sessionEpoch++
  setToken(null)
  const expired = captureSession()
  useAccount.setState({ user: null, invites: [], checked: true })
  if (!sessionIsCurrent(expired)) return
  const s = useStore.getState()
  if (s.authed) {
    s.signOut()
    if (!sessionIsCurrent(expired)) return
    s.toast({
      title: 'Сессия завершена',
      desc: 'Войди снова — например, если пароль сменили или сессию отозвали на другом устройстве.',
      icon: 'lock',
    })
  }
}

/** применяем результат входа: токен, профиль, стор, синхронизация с диском */
export function applySession(res: { token: string; user: Acc }, context = responseSessions.get(res)) {
  if (context && !sessionIsCurrent(context)) throw new ApiError('Результат входа устарел', 0)
  sessionEpoch++
  setToken(res.token)
  identityProof = null
  const applied = captureSession()
  const s = useStore.getState()
  // Publish the root profile BEFORE any subscriber can observe a confirmed account proof.
  s.signIn(res.user.name, res.user.email, res.user.hue)
  if (!sessionIsCurrent(applied)) throw new ApiError('Результат входа устарел', 0)
  identityProof = { context: applied, id: res.user.id }
  useAccount.setState({ user: res.user })
  // A subscriber may synchronously log out, change backend, or apply another login.
  if (!sessionIsCurrent(applied) || U().user?.id !== res.user.id) return
  if (!recoveryMode) void resyncNow()
}

export async function logout() {
  // Dispatch with the old token, then invalidate locally immediately; a slow logout cannot erase a new login.
  const request =
    getToken() && serverOnline() ? api('POST', '/api/auth/logout').catch(() => {}) : Promise.resolve()
  identityProof = null
  sessionEpoch++
  setToken(null)
  const cleared = captureSession()
  useAccount.setState({ user: null, invites: [], checked: true })
  if (sessionIsCurrent(cleared)) useStore.getState().signOut()
  await request
}

let configRequest = 0
let verificationRequest = 0
export const loadConfig = async () => {
  const context = captureSession()
  const ticket = ++configRequest
  const current = () => ticket === configRequest && sessionIsCurrent(context)
  try {
    const c = await request<AuthConfig>('GET', '/api/auth/config', undefined, current)
    if (!current()) return null
    useAccount.setState({ config: c })
    return c
  } catch {
    return null
  }
}

/** Latest-started verification owns profile/expiry within an otherwise unchanged session. */
export async function verifySession() {
  const context = captureSession()
  const ticket = ++verificationRequest
  const current = () => ticket === verificationRequest && sessionIsCurrent(context)
  if (!serverOnline()) {
    if (current()) useAccount.setState({ checked: true })
    return
  }
  await loadConfig()
  if (!current()) return
  const s = useStore.getState()
  if (!getToken()) {
    identityProof = null
    useAccount.setState({ user: null, invites: [] })
    if (!current()) return
    if (s.authed && !s.settings.localMode && U().config?.hasUsers) s.signOut()
    if (current()) useAccount.setState({ checked: true })
    return
  }
  try {
    const m = await request<{ user: Acc }>('GET', '/api/auth/me', undefined, current)
    if (!current()) return
    const me = useStore.getState().people.me
    // Proof publication must not expose a profile from before this server response.
    if (!s.authed || me.email !== m.user.email || me.name !== m.user.name) {
      identityProof = null
      s.signIn(m.user.name, m.user.email, m.user.hue)
      if (!current()) return
    }
    identityProof = { context, id: m.user.id }
    useAccount.setState({ user: m.user, checked: true })
    if (current() && confirmedAccountId() === m.user.id) void refreshInvites()
  } catch {
    if (current()) useAccount.setState({ checked: true })
  }
}

let invitesRequest = 0
export async function refreshInvites() {
  const context = captureSession()
  const ticket = ++invitesRequest
  const current = () => ticket === invitesRequest && sessionIsCurrent(context)
  if (!getToken() || !serverOnline()) return
  try {
    const r = await request<{ invites: MyInvite[] }>('GET', '/api/invites', undefined, current)
    if (current()) useAccount.setState({ invites: r.invites })
  } catch {
    /* не критично */
  }
}

/** параметры из ссылки: подтверждение почты, сброс пароля, приглашение, OAuth */
export interface UrlIntent {
  verify?: { email: string; code: string }
  reset?: { email: string; code: string }
  oauth?: string
  oauthError?: string
}
export function readUrlIntent(): UrlIntent {
  const q = new URLSearchParams(location.search)
  const out: UrlIntent = {}
  if (q.get('verify')) out.verify = { email: q.get('verify')!, code: q.get('code') || '' }
  if (q.get('reset')) out.reset = { email: q.get('reset')!, code: q.get('code') || '' }
  if (q.get('oauth')) out.oauth = q.get('oauth')!
  if (q.get('oauth_error')) out.oauthError = q.get('oauth_error')!
  if (q.get('invite')) {
    try {
      sessionStorage.setItem('tf-invite', q.get('invite')!)
    } catch {
      /* ignore */
    }
  }
  if ([...q.keys()].some((k) => ['verify', 'reset', 'oauth', 'oauth_error', 'invite', 'code'].includes(k)))
    history.replaceState(null, '', location.pathname)
  try {
    const t = sessionStorage.getItem('tf-invite')
    if (t) useAccount.setState({ inviteToken: t })
  } catch {
    /* ignore */
  }
  return out
}
export function clearInvite() {
  try {
    sessionStorage.removeItem('tf-invite')
  } catch {
    /* ignore */
  }
  useAccount.setState({ inviteToken: null })
}

export function initAccount() {
  const intent = readUrlIntent()
  ;(window as unknown as { __tfIntent?: UrlIntent }).__tfIntent = intent
  void detectBackend().then(() => verifySession())
  useBackend.subscribe((b, prev) => {
    if (b.status === 'online' && (prev.status !== 'online' || b.base !== prev.base)) void verifySession()
  })
  setInterval(() => {
    if (!document.hidden && getToken()) void refreshInvites()
  }, 30000)
  /* сессию могли завершить в другой вкладке */
  window.addEventListener('storage', (e) => {
    if (e.key === 'tf-token' || e.key === null) {
      // A queued storage event may predate a newer local login. Read the durable current
      // value before adopting it; never roll the session back to the event's old payload.
      let durable: string | null
      try {
        durable = localStorage.getItem('tf-token')
      } catch {
        expireSession()
        return
      }
      if (durable !== e.newValue) return
      if (!durable) expireSession()
      else {
        sessionEpoch++
        setToken(durable)
        void verifySession()
      }
    }
  })
}
