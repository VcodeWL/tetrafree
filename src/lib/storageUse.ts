/* Сколько занято в localStorage. Лимит у WebView2/Chrome — около 5 млн символов на источник (ключи и значения). */
export const STORAGE_LIMIT = 5_000_000

export function storageUsed(): number {
  try {
    let n = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      n += k.length + (localStorage.getItem(k) || '').length
    }
    return n
  } catch {
    return 0
  }
}
export const storageLevel = (used: number, limit = STORAGE_LIMIT): 'ok' | 'warn' | 'full' =>
  used >= limit * 0.9 ? 'full' : used >= limit * 0.7 ? 'warn' : 'ok'
export const fmtMb = (n: number) => (n / 1e6).toFixed(n < 1e6 ? 2 : 1).replace('.', ',') + ' МБ'
