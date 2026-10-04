/* Работа с DOM страницы в режиме «Дизайн»: пути, сериализация, стили, переменные :root, вставка блоков. */
export type Path = number[]

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BASE'])
export const kids = (el: Element) => Array.from(el.children).filter((c) => !SKIP.has(c.tagName))

export function elAt(doc: Document, path: Path): HTMLElement | null {
  let cur: Element = doc.body
  for (const i of path) {
    const k = kids(cur)[i]
    if (!k) return null
    cur = k
  }
  return cur as HTMLElement
}
export function pathOf(el: Element, doc: Document): Path {
  const out: Path = []
  let cur: Element | null = el
  while (cur && cur !== doc.body && cur.parentElement) {
    out.unshift(kids(cur.parentElement).indexOf(cur))
    cur = cur.parentElement
  }
  return cur === doc.body ? out : []
}
export const pathKey = (p: Path | null) => (p ? p.join('.') : '')
export const isBody = (el: Element | null, doc: Document) =>
  !el || el === doc.body || el === doc.documentElement

export function describe(el: Element) {
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '')
}
export function snippet(el: Element, n = 28) {
  const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}
const TAG_RU: Record<string, string> = {
  H1: 'Заголовок 1',
  H2: 'Заголовок 2',
  H3: 'Заголовок 3',
  H4: 'Заголовок 4',
  P: 'Текст',
  A: 'Ссылка',
  BUTTON: 'Кнопка',
  IMG: 'Картинка',
  UL: 'Список',
  OL: 'Список',
  LI: 'Пункт',
  SECTION: 'Секция',
  HEADER: 'Шапка',
  FOOTER: 'Подвал',
  NAV: 'Навигация',
  MAIN: 'Контент',
  INPUT: 'Поле',
  FORM: 'Форма',
  SPAN: 'Текст',
  B: 'Жирный',
  SMALL: 'Мелкий текст',
  HR: 'Разделитель',
  DETAILS: 'Раскрывашка',
  SUMMARY: 'Заголовок раскрывашки',
  BLOCKQUOTE: 'Цитата',
  ARTICLE: 'Статья',
  ASIDE: 'Врезка',
  VIDEO: 'Видео',
  SVG: 'Графика',
}
export const ruName = (el: Element) =>
  TAG_RU[el.tagName] ||
  (el.tagName === 'DIV' ? (kids(el).length ? 'Блок' : 'Блок') : el.tagName.toLowerCase())
export const isLeafText = (el: Element) =>
  kids(el).length === 0 && !['IMG', 'HR', 'INPUT', 'VIDEO', 'SVG', 'BR'].includes(el.tagName)

/** Текущий HTML → строка файла. Служебные атрибуты редактора убираются. */
export function serialize(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-tf-editor]').forEach((n) => n.remove())
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'))
  clone.querySelectorAll('[spellcheck]').forEach((n) => n.removeAttribute('spellcheck'))
  clone.querySelectorAll('[data-tf]').forEach((n) => n.removeAttribute('data-tf'))
  clone.querySelectorAll('[style=""]').forEach((n) => n.removeAttribute('style'))
  return '<!doctype html>\n' + clone.outerHTML + '\n'
}

/* ---------- стили ---------- */
export function rgbToHex(v: string): string {
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (!m)
    return /^#[0-9a-f]{6}$/i.test(v)
      ? v
      : /^#[0-9a-f]{3}$/i.test(v)
        ? '#' +
          v
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')
        : '#000000'
  const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x))
  if (a === 0) return '#000000'
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
}
export const isTransparent = (v: string) => !v || v === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(v)
export const px = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0
}
export function cs(el: Element) {
  return el.ownerDocument.defaultView!.getComputedStyle(el)
}

/* ---------- переменные :root ---------- */
export interface RootVar {
  name: string
  value: string
  kind: 'color' | 'size' | 'text'
}
export function rootVars(doc: Document): RootVar[] {
  const out: RootVar[] = []
  doc.querySelectorAll('style').forEach((s) => {
    if (s.hasAttribute('data-tf-editor')) return
    const m = (s.textContent || '').match(/:root\s*\{([^}]*)\}/)
    if (!m) return
    m[1].split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i < 0) return
      const name = d.slice(0, i).trim(),
        value = d.slice(i + 1).trim()
      if (!name.startsWith('--') || !value) return
      out.push({
        name,
        value,
        kind:
          /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/.test(value) || /^hsla?\(/.test(value)
            ? 'color'
            : /^-?[\d.]+(px|rem|em|%)$/.test(value)
              ? 'size'
              : 'text',
      })
    })
  })
  return out
}
export function setRootVar(doc: Document, name: string, value: string): boolean {
  let done = false
  doc.querySelectorAll('style').forEach((s) => {
    if (done || s.hasAttribute('data-tf-editor')) return
    const t = s.textContent || ''
    const re = new RegExp('(:root\\s*\\{[^}]*?' + name.replace(/[-]/g, '\\-') + '\\s*:)\\s*[^;}]+', '')
    if (re.test(t)) {
      s.textContent = t.replace(re, (_, a) => a + value)
      done = true
    }
  })
  return done
}

/* ---------- вставка блоков ---------- */
const PH =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#2a2a33"/><path d="M0 300l170-120 120 80 110-90 240 150v80H0z" fill="#3a3a46"/><circle cx="470" cy="100" r="34" fill="#4a4a58"/></svg>',
  )
export interface Block {
  key: string
  label: string
  html: string
}
export const BLOCKS: Block[] = [
  {
    key: 'h2',
    label: 'Заголовок',
    html: '<h2 style="font-size:28px;letter-spacing:-.02em">Новый заголовок</h2>',
  },
  { key: 'p', label: 'Текст', html: '<p>Текст абзаца. Дважды кликни, чтобы изменить.</p>' },
  {
    key: 'btn',
    label: 'Кнопка',
    html: '<a href="#" style="display:inline-block;padding:12px 22px;border-radius:var(--radius,10px);background:var(--accent,#8fa6ff);color:#0a0a0d;font-weight:650;text-decoration:none">Кнопка</a>',
  },
  {
    key: 'img',
    label: 'Картинка',
    html: `<img src="${PH}" alt="" style="max-width:100%;border-radius:14px">`,
  },
  {
    key: 'card',
    label: 'Карточка',
    html: '<div style="border:1px solid rgba(128,128,128,.3);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:6px"><b>Заголовок карточки</b><span style="opacity:.7">Короткое описание — измени текст двойным кликом.</span></div>',
  },
  {
    key: 'row',
    label: 'Ряд (flex)',
    html: '<div style="display:flex;gap:16px;align-items:center"><div style="flex:1;padding:16px;border:1px dashed rgba(128,128,128,.4);border-radius:10px">Колонка 1</div><div style="flex:1;padding:16px;border:1px dashed rgba(128,128,128,.4);border-radius:10px">Колонка 2</div></div>',
  },
  {
    key: 'hr',
    label: 'Разделитель',
    html: '<hr style="border:0;border-top:1px solid rgba(128,128,128,.3);width:100%">',
  },
]
export function fromHtml(doc: Document, html: string): HTMLElement {
  const t = doc.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}
