/* Токен сессии (Bearer) хранится только на этом устройстве */
const K = 'tf-token'
let cur: string | null = null
try {
  cur = localStorage.getItem(K)
} catch {
  /* приватный режим */
}
let revision = 0
/** Runtime authority version, no credentials. A → B → A is two changes; same token is a no-op. */
export const getTokenRevision = () => revision
export const getToken = () => cur
export function setToken(t: string | null) {
  if (cur !== t) revision++
  cur = t
  try {
    if (t) localStorage.setItem(K, t)
    else localStorage.removeItem(K)
  } catch {
    /* ignore */
  }
}
export const authHeader = (): Record<string, string> => (cur ? { authorization: 'Bearer ' + cur } : {})
