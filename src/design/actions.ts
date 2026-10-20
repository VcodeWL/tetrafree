/* Все правки макета проходят здесь: меняем живой DOM → сериализуем → пишем файл проекта.
   Файл — единственный источник правды: холст, код и агент всегда видят одно и то же. */
import { useStore, toast } from '../store'
import { useDesign, type DesignHistoryEntry } from './store'
import { captureFileTree, type FilePreimage } from '../lib/filePreimage'
import { mutateFileTree } from '../store/slices/files'
import { freePath } from '../lib/trash'
import { download } from '../lib/util'
import { serialize, elAt, pathOf, kids, fromHtml, isBody, type Path } from './dom'

const D = () => useDesign.getState()
const S = () => useStore.getState()

let lastWritten = ''
export const getLastWritten = () => lastWritten
export const setLastWritten = (h: string) => {
  lastWritten = h
}

let lastKey = '',
  lastAt = 0,
  lastOwner = ''
interface VersionBatch {
  pid: string
  page: string
  labels: Set<string>
  timer: ReturnType<typeof setTimeout>
}
const batches = new Map<string, VersionBatch>()
const VERSION_IDLE = 6000
const ownerKey = (pid: string, page: string) => JSON.stringify([pid, page])
const resetCoalescing = () => {
  lastKey = ''
  lastAt = 0
  lastOwner = ''
}

function flushBatch(owner: string) {
  const batch = batches.get(owner)
  if (!batch) return
  clearTimeout(batch.timer)
  batches.delete(owner)
  resetCoalescing()
  const st = S()
  if (!st.projects.some((p) => p.id === batch.pid)) return
  const labels = [...batch.labels]
  st.commit(
    {
      title: 'Дизайн: ' + labels[0].toLowerCase() + (labels.length > 1 ? ` и ещё ${labels.length - 1}` : ''),
      by: 'human',
      author: st.people.me.name,
      tag: 'build',
      feats: [],
      changes: labels.map((label) => `${label} в ${batch.page}`),
      fixes: [],
      details: ['Правки на холсте режима «Дизайн»'],
    },
    batch.pid,
  )
  if (D().pid === batch.pid && D().page === batch.page) useDesign.setState({ saved: Date.now() })
}
export function flushVersion() {
  for (const owner of [...batches.keys()]) flushBatch(owner)
  resetCoalescing()
}
function queueVersion(pid: string, page: string, label: string) {
  const owner = ownerKey(pid, page)
  const previous = batches.get(owner)
  if (previous) clearTimeout(previous.timer)
  const labels = previous?.labels || new Set<string>()
  labels.add(label)
  batches.set(owner, { pid, page, labels, timer: setTimeout(() => flushBatch(owner), VERSION_IDLE) })
}

// Capture the document's provenance when Canvas connects it, not at a later blur/undo.
interface DocumentOwner {
  pid: string
  page: string
  expected: FilePreimage
}
const documents = new WeakMap<Document, DocumentOwner>()
function bindDocument(doc: Document, pid: string, page: string) {
  if (!documents.has(doc)) documents.set(doc, { pid, page, expected: captureFileTree(useStore, pid, page) })
  return documents.get(doc)!
}
useDesign.subscribe((state, previous) => {
  if (state.doc && state.doc !== previous.doc && state.pid && state.page)
    bindDocument(state.doc, state.pid, state.page)
})

/** A failed stale DOM save keeps all local HTML durably in the source project's trash. */
function recoverDocument(pid: string, page: string, html: string) {
  let recovered = ''
  useStore.setState((s) => {
    const p = s.projects.find((project) => project.id === pid)
    if (!p) return
    const trash = p.trash || []
    const existing = trash.find(
      (item) => item.content === html && (item.path === page || item.path.startsWith(page + ' (')),
    )
    if (existing) {
      recovered = existing.path
      return
    }
    recovered = freePath((name) => name in p.files || trash.some((item) => item.path === name), page)
    p.trash = [{ path: recovered, content: html, at: Date.now() }, ...trash]
  })
  toast({
    title: recovered
      ? 'Холст устарел — правки сохранены в корзине'
      : 'Исходный проект удалён — сохрани правки холста',
    desc: recovered || page,
    tone: 'warn',
    icon: 'warn',
    action: {
      label: 'Скачать HTML',
      run: () => download(page.split('/').pop() || 'правки.html', html, 'text/html'),
    },
  })
}

/** Commit with document-bound identity and a transaction-time preimage check. */
export function commitDoc(label: string, key = '', doc = D().doc) {
  const d = D()
  const pid = d.pid || S().projectId
  if (!doc || !pid || !d.page) return
  const source = documents.get(doc) || bindDocument(doc, pid, d.page)
  const { page } = source
  const project = S().projects.find((p) => p.id === source.pid)
  const html = serialize(doc)
  const cur = project?.files[page]
  if (html === cur && source.expected.unchanged()) {
    d.bump()
    return
  }
  const active = d.doc === doc && d.pid === source.pid && d.page === page
  const top = d.undo[d.undo.length - 1]
  const adjacent = top?.pid === source.pid && top.page === page && top.expected.unchanged()
  try {
    mutateFileTree(useStore.setState, source.pid, {
      kind: 'replace',
      path: page,
      content: html,
      before: source.expected,
    })
  } catch {
    recoverDocument(source.pid, page, html)
    resetCoalescing()
    return
  }
  const expected = captureFileTree(useStore, source.pid, page)
  source.expected = expected
  const now = Date.now(),
    owner = ownerKey(source.pid, page)
  if (active) {
    const coalesce =
      adjacent &&
      key &&
      key === lastKey &&
      owner === lastOwner &&
      now - lastAt < 1500 &&
      top?.pid === source.pid &&
      top.page === page &&
      top.after === cur
    const entry: DesignHistoryEntry = coalesce
      ? { ...top, after: html, expected }
      : { pid: source.pid, page, before: cur!, after: html, expected, lineage: adjacent ? top.lineage : {} }
    useDesign.setState({
      undo: [...(coalesce ? d.undo.slice(0, -1) : d.undo.slice(-99)), entry],
      redo: [],
      saved: now,
    })
    lastWritten = html
  }
  lastKey = key
  lastAt = now
  lastOwner = owner
  queueVersion(source.pid, page, label)
  if (active) d.bump()
}

export const getEl = (path: Path | null) => {
  const doc = D().doc
  return doc && doc.defaultView && path ? elAt(doc, path) : null
}

export function setStyle(el: HTMLElement, prop: string, val: string, key?: string) {
  if (val === '' || val == null) el.style.removeProperty(prop)
  else el.style.setProperty(prop, val)
  commitDoc('Стили', key ?? 'style:' + prop, el.ownerDocument)
}
export function setStyles(el: HTMLElement, map: Record<string, string>, label = 'Стили') {
  for (const [k, v] of Object.entries(map)) {
    if (v === '') el.style.removeProperty(k)
    else el.style.setProperty(k, v)
  }
  commitDoc(label, '', el.ownerDocument)
}
export function setText(el: HTMLElement, text: string) {
  el.textContent = text
  commitDoc('Текст', 'text', el.ownerDocument)
}
export function setAttr(el: HTMLElement, name: string, val: string) {
  if (val === '') el.removeAttribute(name)
  else el.setAttribute(name, val)
  commitDoc('Атрибут ' + name, 'attr:' + name, el.ownerDocument)
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
function traverseHistory(direction: 'undo' | 'redo') {
  const d = D(),
    entries = d[direction]
  const entry = entries[entries.length - 1]
  if (!entry) return
  const pid = d.pid || S().projectId
  if (entry.pid !== pid || entry.page !== d.page || S().projectId !== pid) {
    toast({ title: 'История относится к другой странице или проекту', tone: 'warn', icon: 'warn' })
    return
  }
  const output = direction === 'undo' ? entry.before : entry.after
  try {
    mutateFileTree(useStore.setState, pid, {
      kind: 'replace',
      path: entry.page,
      content: output,
      before: entry.expected,
    })
  } catch {
    toast({
      title: 'Нельзя отменить или повторить: файл изменён снаружи или удалён',
      tone: 'warn',
      icon: 'warn',
    })
    return
  }
  const expected = captureFileTree(useStore, pid, entry.page)
  const remaining = entries.slice(0, -1)
  const next = remaining[remaining.length - 1]
  // A known inverse operation creates a fresh revision; rebase only the adjacent local step.
  if (
    next?.pid === pid &&
    next.page === entry.page &&
    next.lineage === entry.lineage &&
    (direction === 'undo' ? next.after : next.before) === output
  )
    remaining[remaining.length - 1] = { ...next, expected }
  const other = direction === 'undo' ? 'redo' : 'undo'
  useDesign.setState({ [direction]: remaining, [other]: [...d[other], { ...entry, expected }] })
  resetCoalescing()
  // Let Studio reload the DOM; the old document's preimage is intentionally not advanced.
  queueVersion(pid, entry.page, direction === 'undo' ? 'Отмена правки' : 'Повтор правки')
}
export function undo() {
  traverseHistory('undo')
}
export function redo() {
  traverseHistory('redo')
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
