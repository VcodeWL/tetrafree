/* Все правки макета проходят здесь: меняем живой DOM → сериализуем → пишем файл проекта.
   Файл — единственный источник правды: холст, код и агент всегда видят одно и то же. */
import { useStore, toast } from '../store'
import { useDesign } from './store'
import { serialize, elAt, pathOf, kids, fromHtml, isBody, type Path } from './dom'

const D = () => useDesign.getState()
const S = () => useStore.getState()

let lastWritten = ''
export const getLastWritten = () => lastWritten
export const setLastWritten = (h: string) => {
  lastWritten = h
}

let lastKey = '',
  lastAt = 0
let labels: string[] = []
let vTimer: ReturnType<typeof setTimeout> | null = null
const VERSION_IDLE = 6000

export function flushVersion() {
  if (vTimer) clearTimeout(vTimer)
  vTimer = null
  if (!labels.length) return
  const st = S()
  const pid = st.projectId
  const page = D().page
  const uniq = Array.from(new Set(labels))
  labels = []
  if (!pid) return
  const n = st.commit(
    {
      title: 'Дизайн: ' + uniq[0].toLowerCase() + (uniq.length > 1 ? ` и ещё ${uniq.length - 1}` : ''),
      by: 'human',
      author: st.people.me.name,
      tag: 'build',
      feats: [],
      changes: uniq.map((l) => `${l} в ${page}`),
      fixes: [],
      details: ['Правки на холсте режима «Дизайн»'],
    },
    pid,
  )
  useDesign.setState({ saved: Date.now() })
  void n
}

/** Применить текущее состояние DOM к файлу. key — для склейки частых правок (набор текста, ползунки). */
export function commitDoc(label: string, key = '') {
  const d = D()
  const doc = d.doc
  const page = d.page
  if (!doc || !page) return
  const p = S().projects.find((x) => x.id === S().projectId)
  if (!p) return
  const html = serialize(doc)
  const cur = p.files[page]
  if (html === cur) {
    d.bump()
    return
  }
  const now = Date.now()
  if (!(key && key === lastKey && now - lastAt < 1500))
    useDesign.setState((s) => ({ undo: [...s.undo.slice(-99), cur ?? ''] }))
  lastKey = key
  lastAt = now
  useDesign.setState({ redo: [] })
  lastWritten = html
  S().writeFile(page, html)
  labels.push(label)
  if (vTimer) clearTimeout(vTimer)
  vTimer = setTimeout(flushVersion, VERSION_IDLE)
  useDesign.setState({ saved: now })
  d.bump()
}

export const getEl = (path: Path | null) => {
  const doc = D().doc
  return doc && doc.defaultView && path ? elAt(doc, path) : null
}

export function setStyle(el: HTMLElement, prop: string, val: string, key?: string) {
  if (val === '' || val == null) el.style.removeProperty(prop)
  else el.style.setProperty(prop, val)
  commitDoc('Стили', key ?? 'style:' + prop)
}
export function setStyles(el: HTMLElement, map: Record<string, string>, label = 'Стили') {
  for (const [k, v] of Object.entries(map)) {
    if (v === '') el.style.removeProperty(k)
    else el.style.setProperty(k, v)
  }
  commitDoc(label)
}
export function setText(el: HTMLElement, text: string) {
  el.textContent = text
  commitDoc('Текст', 'text')
}
export function setAttr(el: HTMLElement, name: string, val: string) {
  if (val === '') el.removeAttribute(name)
  else el.setAttribute(name, val)
  commitDoc('Атрибут ' + name, 'attr:' + name)
}

function select(path: Path | null) {
  useDesign.setState({ sel: path, editing: false })
}

export function removeEl(el: HTMLElement) {
  const doc = D().doc
  if (!doc || isBody(el, doc)) return
  const parent = el.parentElement!
  const sibs = kids(parent)
  const i = sibs.indexOf(el)
  const next = sibs[i + 1] || sibs[i - 1] || parent
  el.remove()
  select(isBody(next, doc) ? null : pathOf(next, doc))
  commitDoc('Удаление элемента')
}
export function duplicateEl(el: HTMLElement) {
  const doc = D().doc
  if (!doc || isBody(el, doc)) return
  const c = el.cloneNode(true) as HTMLElement
  el.after(c)
  select(pathOf(c, doc))
  commitDoc('Дубликат элемента')
}
export function moveEl(el: HTMLElement, dir: -1 | 1) {
  const doc = D().doc
  if (!doc || isBody(el, doc)) return
  const sibs = kids(el.parentElement!)
  const i = sibs.indexOf(el)
  const t = sibs[i + dir]
  if (!t) return
  if (dir < 0) t.before(el)
  else t.after(el)
  select(pathOf(el, doc))
  commitDoc('Перемещение элемента')
}
export function moveTo(el: HTMLElement, target: HTMLElement, pos: 'before' | 'after' | 'inside') {
  const doc = D().doc
  if (!doc || el === target || el.contains(target)) return
  if (pos === 'before') target.before(el)
  else if (pos === 'after') target.after(el)
  else target.append(el)
  select(pathOf(el, doc))
  commitDoc('Перемещение элемента')
}
export function insertBlock(html: string, after: HTMLElement | null) {
  const doc = D().doc
  if (!doc) return
  const el = fromHtml(doc, html)
  if (!el) return
  if (after && !isBody(after, doc)) after.after(el)
  else (doc.querySelector('main') || doc.body).append(el)
  select(pathOf(el, doc))
  commitDoc('Новый элемент')
  return el
}
export function selectParent() {
  const d = D()
  const el = getEl(d.sel)
  const doc = d.doc
  if (!el || !doc) return
  const p = el.parentElement
  select(!p || isBody(p, doc) ? null : pathOf(p, doc))
}

/* ---------- история ---------- */
export function undo() {
  const d = D()
  const page = d.page
  if (!page || !d.undo.length) return
  const cur = S().projects.find((x) => x.id === S().projectId)?.files[page] ?? ''
  const prev = d.undo[d.undo.length - 1]
  useDesign.setState({ undo: d.undo.slice(0, -1), redo: [...d.redo, cur] })
  lastKey = ''
  S().writeFile(page, prev)
}
export function redo() {
  const d = D()
  const page = d.page
  if (!page || !d.redo.length) return
  const cur = S().projects.find((x) => x.id === S().projectId)?.files[page] ?? ''
  const next = d.redo[d.redo.length - 1]
  useDesign.setState({ redo: d.redo.slice(0, -1), undo: [...d.undo, cur] })
  lastKey = ''
  S().writeFile(page, next)
}

export function createPage(name: string) {
  const st = S()
  const p = st.projects.find((x) => x.id === st.projectId)
  if (!p) return null
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-|-$/g, '') || 'page'
  let path = `site/${slug}.html`,
    i = 2
  while (path in p.files) path = `site/${slug}-${i++}.html`
  const src = p.files['site/index.html']
  const html = src
    ? src
        .replace(
          /<main>[\s\S]*<\/main>/,
          `<main>\n    <section class="hero"><h1>${name.trim() || 'Новая страница'}</h1><p>Начни с этого блока: двойной клик по тексту — править, «+» — добавить элемент.</p></section>\n  </main>`,
        )
        .replace(/<title>[^<]*<\/title>/, `<title>${name.trim() || 'Новая страница'}</title>`)
    : `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>${name}</title></head><body style="font:16px/1.6 system-ui;padding:48px"><h1>${name}</h1></body></html>\n`
  st.writeFile(path, html)
  st.commit({
    title: 'Новая страница ' + path,
    by: 'human',
    author: st.people.me.name,
    tag: 'build',
    feats: ['Страница ' + path],
    changes: [],
    fixes: [],
    details: [],
  })
  toast({ title: 'Страница создана', desc: path, icon: 'check', tone: 'ok' })
  return path
}
