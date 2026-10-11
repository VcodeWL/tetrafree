/* Запуск компонентов из реестров прямо в браузере: TSX/JSX компилируется Babel'ом, пакеты берутся с esm.sh, стили — Tailwind v4 (браузерная сборка).
   Один и тот же скрипт показывает предпросмотр в окне и работает внутри страницы сайта (блок в режиме «Дизайн»).
   Нужен интернет. Это быстрый способ посмотреть и собрать макет; для настоящего сайта компонент добавляют в проект файлами. */

export interface RunData {
  files: Record<string, string>
  entry: string
  deps: Record<string, string>
  /** CSS самих компонентов (keyframes, @theme и т. п.) */
  css: string
  dark?: boolean
  /** true — полный сброс стилей Tailwind (предпросмотр); false — только внутри блока (чтобы не трогать страницу) */
  preflight: boolean
  /** у компонента нет готового примера: подставить текст в props `text` и `children` */
  sample?: boolean
  /** id элемента, куда рисовать */
  mount: string
}

const TOKENS_LIGHT = `--radius:.625rem;--background:oklch(1 0 0);--foreground:oklch(.145 0 0);--card:oklch(1 0 0);--card-foreground:oklch(.145 0 0);--popover:oklch(1 0 0);--popover-foreground:oklch(.145 0 0);--primary:oklch(.205 0 0);--primary-foreground:oklch(.985 0 0);--secondary:oklch(.97 0 0);--secondary-foreground:oklch(.205 0 0);--muted:oklch(.97 0 0);--muted-foreground:oklch(.556 0 0);--accent:oklch(.97 0 0);--accent-foreground:oklch(.205 0 0);--destructive:oklch(.577 .245 27.325);--border:oklch(.922 0 0);--input:oklch(.922 0 0);--ring:oklch(.708 0 0)`
const TOKENS_DARK = `--background:oklch(.145 0 0);--foreground:oklch(.985 0 0);--card:oklch(.205 0 0);--card-foreground:oklch(.985 0 0);--popover:oklch(.205 0 0);--popover-foreground:oklch(.985 0 0);--primary:oklch(.922 0 0);--primary-foreground:oklch(.205 0 0);--secondary:oklch(.269 0 0);--secondary-foreground:oklch(.985 0 0);--muted:oklch(.269 0 0);--muted-foreground:oklch(.708 0 0);--accent:oklch(.269 0 0);--accent-foreground:oklch(.985 0 0);--destructive:oklch(.704 .191 22.216);--border:oklch(1 0 0 / 10%);--input:oklch(1 0 0 / 15%);--ring:oklch(.556 0 0)`
const COLORS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
]

/** Текст для <style type="text/tailwindcss">: подключение Tailwind, цвета shadcn (только внутри .tf-ui-scope) и стили компонентов */
export function twCss(css: string, preflight: boolean): string {
  return `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
${preflight ? '@import "tailwindcss/preflight.css" layer(base);\n' : ''}@import "tailwindcss/utilities.css" layer(utilities);
@custom-variant dark (&:is(.dark *, .dark));
@theme inline {
${COLORS.map((c) => `  --color-${c}: var(--${c});`).join('\n')}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
.tf-ui-scope{${TOKENS_LIGHT}}
.tf-ui-scope.dark,.dark .tf-ui-scope{${TOKENS_DARK}}
${preflight ? '' : '@layer base{.tf-ui-scope *,.tf-ui-scope ::before,.tf-ui-scope ::after{box-sizing:border-box;border:0 solid}.tf-ui-scope button,.tf-ui-scope input,.tf-ui-scope select,.tf-ui-scope textarea{font:inherit;color:inherit;background:transparent}.tf-ui-scope button{cursor:pointer}.tf-ui-scope :where(h1,h2,h3,h4,h5,h6,p,figure,blockquote,pre,dl,dd,hr){margin:0}.tf-ui-scope :where(h1,h2,h3,h4,h5,h6){font-size:inherit;font-weight:inherit}.tf-ui-scope{line-height:1.5}.tf-ui-scope img,.tf-ui-scope svg,.tf-ui-scope video{display:block;max-width:100%}}\n'}${css}`
}

/** Исполняется в браузере (в окне предпросмотра или на странице сайта), поэтому это строка, а не функция проекта:
    так сборщик ничего в ней не подменит. Внутри нет обратных кавычек и «${». */
export const RUNTIME_JS = String.raw`async function tfRuntime(D) {
  const W = window
  const S = (W.__tfui = W.__tfui || {})
  const R_URL = 'https://esm.sh/react@18.3.1'
  const el = document.getElementById(D.mount)
  const say = (m) => {
    try {
      parent.postMessage({ tfui: m }, '*')
    } catch (e) {}
  }
  const fail = (e) => {
    const pre = document.createElement('pre')
    pre.style.cssText = 'white-space:pre-wrap;font:12px/1.5 monospace;color:#b91c1c;padding:8px;margin:0'
    pre.textContent = 'Не удалось показать компонент: ' + String((e && e.message) || e)
    el.replaceChildren(pre)
    say({ state: 'error', msg: String((e && e.message) || e) })
  }
  try {
    const st = document.createElement('style')
    st.setAttribute('type', 'text/tailwindcss')
    st.textContent = D.tw
    document.head.appendChild(st)
    if (!S.tw) {
      const sc = document.createElement('script')
      sc.src = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'
      S.tw = new Promise((r) => {
        sc.onload = r
        sc.onerror = r
      })
      document.head.appendChild(sc)
    }
    const BABEL = 'https://esm.sh/@babel/standalone@7.26.10'
    S.babel = S.babel || import(BABEL)
    const Bm = await S.babel
    const T = Bm.transform ? Bm : Bm.default
    const code = {}
    for (const [p, src] of Object.entries(D.files)) {
      if (/\.css$/.test(p)) continue
      code[p] = T.transform(src, {
        filename: p,
        sourceType: 'module',
        presets: [['typescript', { isTSX: true, allExtensions: true }], ['react', { runtime: 'automatic' }]],
        plugins: ['transform-modules-commonjs'],
      }).code
    }
    const url = (s) => {
      if (s === 'react' || s.startsWith('react/')) return R_URL + s.slice(5)
      if (s === 'react-dom' || s.startsWith('react-dom/')) return 'https://esm.sh/react-dom@18.3.1' + s.slice(9) + '?deps=react@18.3.1'
      const root = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]
      const r = D.deps[root]
      return 'https://esm.sh/' + root + (r && r !== 'latest' ? '@' + r : '') + s.slice(root.length) + '?deps=react@18.3.1,react-dom@18.3.1'
    }
    const specs = new Set()
    for (const c of Object.values(code)) for (const m of c.matchAll(/require\(["']([^"']+)["']\)/g)) if (!m[1].startsWith('.')) specs.add(m[1])
    const ext = {}
    await Promise.all(
      [...specs].map(async (s) => {
        const ns = await import(url(s))
        ext[s] = Object.assign({}, ns, { __esModule: true })
      }),
    )
    const find = (from, spec) => {
      const b = from.split('/').slice(0, -1)
      for (const s of spec.split('/')) {
        if (s === '..') b.pop()
        else if (s !== '.') b.push(s)
      }
      const p = b.join('/')
      for (const e of ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js', '.css']) if (p + e in D.files) return p + e
      throw new Error('Нет модуля ' + spec + ' (из ' + from + ')')
    }
    const mods = {}
    const load = (p) => {
      if (mods[p]) return mods[p].exports
      const m = { exports: {} }
      mods[p] = m
      if (/\.css$/.test(p)) {
        const s2 = document.createElement('style')
        s2.textContent = D.files[p]
        document.head.appendChild(s2)
        return m.exports
      }
      new Function('exports', 'require', 'module', code[p])(m.exports, (s) => (s.startsWith('.') ? load(find(p, s)) : ext[s]), m)
      return m.exports
    }
    const mod = load(D.entry)
    const C = mod.default || Object.values(mod).find((v) => typeof v === 'function' || (v && typeof v === 'object' && v.$$typeof))
    if (!C) throw new Error('В файле нет компонента для показа')
    const R = await import(R_URL)
    const DOM_URL = 'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1'
    const { createRoot } = await import(DOM_URL)
    const Boundary = function (p) {
      R.Component.call(this, p)
      this.state = { e: null }
    }
    Boundary.prototype = Object.create(R.Component.prototype)
    Boundary.prototype.constructor = Boundary
    Boundary.getDerivedStateFromError = (e) => ({ e })
    Boundary.prototype.render = function () {
      return this.state.e
        ? R.createElement('pre', { style: { whiteSpace: 'pre-wrap', font: '12px/1.5 monospace', color: '#b91c1c', margin: 0 } }, 'Ошибка при показе: ' + String(this.state.e.message || this.state.e))
        : this.props.children
    }
    const host = document.createElement('div')
    el.replaceChildren(host)
    await S.tw
    createRoot(host).render(R.createElement(Boundary, null, R.createElement(C, D.sample ? { text: 'Привет, TetraFree', children: 'Привет, TetraFree' } : null)))
    say({ state: 'ready' })
  } catch (e) {
    fail(e)
  }
}`

const safeJson = (o: unknown) =>
  JSON.stringify(o)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

function script(d: RunData): string {
  const data = { ...d, tw: twCss(d.css, d.preflight) } as RunData & { tw: string }
  return `<script type="module">\n${RUNTIME_JS}\ntfRuntime(${safeJson(data)})\n</script>`
}

/** Страница для iframe предпросмотра */
export function previewDoc(d: Omit<RunData, 'mount' | 'preflight'>): string {
  const full: RunData = { ...d, mount: 'root', preflight: true }
  return `<!doctype html><html lang="ru" class="${d.dark ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:${d.dark ? '#0a0a0a' : '#fff'};color:${d.dark ? '#fafafa' : '#0a0a0a'};font-family:ui-sans-serif,system-ui,sans-serif}#root{box-sizing:border-box;min-height:100vh;padding:32px;display:flex;align-items:center;justify-content:center}</style></head><body><div id="root" class="tf-ui-scope${d.dark ? ' dark' : ''}"><span style="font:13px system-ui;opacity:.6">Загружаю компонент…</span></div>${script(full)}</body></html>`
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Блок для вставки на страницу в режиме «Дизайн» (виден на вкладке «Превью» и в опубликованном сайте) */
export function embedBlock(d: Omit<RunData, 'mount' | 'preflight'>, id: string, label: string): string {
  const mount = 'tf-ui-' + id
  return `<div class="tf-ui-scope${d.dark ? ' dark' : ''}" id="${mount}" data-tf-ui="${esc(label)}"><div style="padding:14px 16px;border:1px dashed currentColor;border-radius:10px;font:13px system-ui;opacity:.7">Компонент «${esc(label)}» — виден на вкладке «Превью»</div>${script({ ...d, mount, preflight: false })}</div>`
}
