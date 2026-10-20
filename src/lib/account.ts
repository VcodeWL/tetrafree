/* Клиент аккаунтов: вход, сессия, приглашения. Источник правды — сервер (server/auth.mjs). */
import { create } from 'zustand'
import { useBackend, detectBackend, serverOnline } from './backend'
import { authHeader, getToken, setToken } from './token'
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
export type SessionContext = { epoch: number; token: string | null; base: string }
/** OAuth/MFA callers may capture this before starting a flow and pass it to applySession. */
export const captureSession = (): SessionContext => ({
  epoch: sessionEpoch,
  token: getToken(),
  base: useBackend.getState().base,
})
export const sessionIsCurrent = (context: SessionContext) =>
  context.epoch === sessionEpoch &&
  context.token === getToken() &&
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

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
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
  if (!sessionIsCurrent(context)) throw new ApiError('Ответ устаревшей сессии отклонён', 0)
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
  if (!getToken()) return
  identityProof = null
  sessionEpoch++
  setToken(null)
  useAccount.setState({ user: null, invites: [], checked: true })
  const s = useStore.getState()
  if (s.authed) {
    s.signOut()
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
  identityProof = { context: captureSession(), id: res.user.id }
  useAccount.setState({ user: res.user })
  const s = useStore.getState()
  s.signIn(res.user.name, res.user.email, res.user.hue)
  if (!recoveryMode) void resyncNow()
}

export async function logout() {
  // Dispatch with the old token, then invalidate locally immediately; a slow logout cannot erase a new login.
  const request =
    getToken() && serverOnline() ? api('POST', '/api/auth/logout').catch(() => {}) : Promise.resolve()
  identityProof = null
  sessionEpoch++
  setToken(null)
  useAccount.setState({ user: null, invites: [], checked: true })
  useStore.getState().signOut()
  await request
}

export const loadConfig = async () => {
  const context = captureSession()
  try {
    const c = await api<AuthConfig>('GET', '/api/auth/config')
    if (!sessionIsCurrent(context)) return null
    useAccount.setState({ config: c })
    return c
  } catch {
    return null
  }
}

/** при старте и когда сервер становится доступен: проверяем сохранённую сессию */
export async function verifySession() {
  const context = captureSession()
  if (!serverOnline()) {
    useAccount.setState({ checked: true })
    return
  }
  await loadConfig()
  if (!sessionIsCurrent(context)) return
  const s = useStore.getState()
  if (!getToken()) {
    identityProof = null
    useAccount.setState({ user: null, invites: [] })
    /* сервер есть, а входа нет — локальный профиль без токена больше не считаем входом, если на сервере уже есть аккаунты */
    if (s.authed && !s.settings.localMode && U().config?.hasUsers) {
      s.signOut()
    }
    useAccount.setState({ checked: true })
    return
  }
  try {
    const m = await api<{ user: Acc }>('GET', '/api/auth/me')
    if (!sessionIsCurrent(context)) return
    identityProof = { context, id: m.user.id }
    useAccount.setState({ user: m.user, checked: true })
    const me = s.people.me
    if (me.email !== m.user.email || me.name !== m.user.name) s.signIn(m.user.name, m.user.email, m.user.hue)
    void refreshInvites()
  } catch {
    if (!sessionIsCurrent(context)) return
    useAccount.setState({ checked: true })
  }
}

export async function refreshInvites() {
  const context = captureSession()
  if (!getToken() || !serverOnline()) return
  try {
    const r = await api<{ invites: MyInvite[] }>('GET', '/api/invites')
    if (sessionIsCurrent(context)) useAccount.setState({ invites: r.invites })
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
    if (e.key === 'tf-token') {
      if (!e.newValue) expireSession()
      else {
        sessionEpoch++
        setToken(e.newValue)
        void verifySession()
      }
    }
  })
}
