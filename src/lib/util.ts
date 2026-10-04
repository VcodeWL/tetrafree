export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)

export function plural(n: number, f: [string, string, string]) {
  const a = Math.abs(n) % 100,
    b = a % 10
  if (a > 10 && a < 20) return f[2]
  if (b > 1 && b < 5) return f[1]
  if (b === 1) return f[0]
  return f[2]
}
export const nChats = (n: number) => `${n} ${plural(n, ['чат', 'чата', 'чатов'])}`
export const nMembers = (n: number) => `${n} ${plural(n, ['участник', 'участника', 'участников'])}`
export const nTasks = (n: number) => `${n} ${plural(n, ['задача', 'задачи', 'задач'])}`
export const nFiles = (n: number) => `${n} ${plural(n, ['файл', 'файла', 'файлов'])}`

const MIN = 60_000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR
export function ago(ts: number, now = Date.now()) {
  const d = now - ts
  if (d < 45_000) return 'сейчас'
  if (d < HOUR) {
    const m = Math.round(d / MIN)
    return `${m} мин назад`
  }
  if (d < DAY) {
    const h = Math.round(d / HOUR)
    return `${h} ч назад`
  }
  const days = Math.floor(d / DAY)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r, j) => {
    if (signal?.aborted) return j(new DOMException('aborted', 'AbortError'))
    const t = setTimeout(r, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        j(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })

export function initialsOf(name: string) {
  const parts = name
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
const TR: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}
/* имя папки/файла: латиница, цифры и дефисы — безопасно для git, шелла и любых ФС */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[а-яё]/g, (c) => TR[c] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project'

export function fmtBytes(n: number) {
  if (n < 1024) return n + ' Б'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ'
  return (n / 1024 / 1024).toFixed(1) + ' МБ'
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

export function copyText(t: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t).catch(() => fallbackCopy(t))
  fallbackCopy(t)
  return Promise.resolve()
}
function fallbackCopy(t: string) {
  const ta = document.createElement('textarea')
  ta.value = t
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    /* noop */
  }
  ta.remove()
}
export function download(name: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const langOf = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return (
    (
      {
        rs: 'rust',
        ts: 'ts',
        tsx: 'ts',
        js: 'ts',
        jsx: 'ts',
        md: 'md',
        yaml: 'yaml',
        yml: 'yaml',
        py: 'py',
        css: 'css',
        html: 'html',
        json: 'json',
        toml: 'yaml',
        sql: 'sql',
      } as Record<string, string>
    )[ext] || 'txt'
  )
}

/* локальная дата YYYY-MM-DD (toISOString даёт UTC и около полуночи показывает «вчера/завтра») */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
