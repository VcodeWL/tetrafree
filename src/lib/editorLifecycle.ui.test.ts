/* Controlled hook/callback fixture, not a browser/React DOM test. Runs the real component bodies. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { editorSession } from './editorSession'
import * as merge from './merge3'
import * as folds from './folds'
import * as trash from './trash'
import * as chatDraft from './chatDraft'

interface Tree {
  type: string
  props: Record<string, unknown>
  children: unknown[]
}
function find(tree: unknown, type: string): Tree | undefined {
  if (Array.isArray(tree)) return tree.map((x) => find(x, type)).find(Boolean)
  if (!tree || typeof tree !== 'object') return
  const node = tree as Tree
  if (node.type === type) return node
  return find(node.children, type)
}
function callback(node: Tree, name: string) {
  return node.props[name] as (event: object) => void
}
function clock() {
  let id = 0
  const tasks = new Map<number, () => void>()
  return {
    setTimeout: (fn: () => void) => {
      tasks.set(++id, fn)
      return id
    },
    clearTimeout: (key: number) => tasks.delete(key),
    run: () => {
      const batch = [...tasks.values()]
      tasks.clear()
      batch.forEach((fn) => fn())
    },
    count: () => tasks.size,
    addEventListener() {},
    removeEventListener() {},
  }
}
function harness(path: string, exportName: string, imports: Record<string, unknown>, time = clock()) {
  let cursor = 0
  const slots: {
    value?: unknown
    current?: unknown
    deps?: unknown[]
    effect?: boolean
    cleanup?: (() => void) | void
  }[] = []
  const pending: (() => void)[] = []
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const react = {
    Fragment: 'fragment',
    memo: (fn: unknown) => fn,
    createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Tree => ({
      type,
      props: props || {},
      children,
    }),
    useState: (initial: unknown) => {
      const i = cursor++
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [
        slots[i].value,
        (v: unknown) => {
          slots[i].value = typeof v === 'function' ? v(slots[i].value) : v
        },
      ]
    },
    useRef: (value: unknown) => {
      const i = cursor++
      return (slots[i] ||= { current: value })
    },
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
      return slots[i].value
    },
    useCallback: (fn: unknown, deps: unknown[]) => react.useMemo(() => fn, deps),
    useEffect: (fn: () => (() => void) | void, deps: unknown[]) => {
      const i = cursor++
      if (slots[i] && same(slots[i].deps, deps)) return
      const old = slots[i]
      slots[i] = { deps, effect: true, cleanup: undefined }
      pending.push(() => {
        old?.cleanup?.()
        slots[i].cleanup = fn()
      })
    },
    useLayoutEffect: (fn: () => (() => void) | void, deps: unknown[]) => react.useEffect(fn, deps),
  }
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const mod = { exports: {} as Record<string, (...props: unknown[]) => unknown> }
  const load = (name: string) => (name === 'react' ? react : imports[name] || {})
  new Function(
    'require',
    'module',
    'exports',
    'React',
    'window',
    'document',
    'setTimeout',
    'clearTimeout',
    code + (exportName === 'TextBox' ? '\nmodule.exports.TextBox = TextBox;' : ''),
  )(
    load,
    mod,
    mod.exports,
    react,
    time,
    { activeElement: null, execCommand: () => false },
    time.setTimeout,
    time.clearTimeout,
  )
  return {
    time,
    render: (...props: unknown[]) => {
      cursor = 0
      const tree = mod.exports[exportName](...props)
      pending.splice(0).forEach((fn) => fn())
      return tree
    },
    unmount: () =>
      slots.forEach((slot) => {
        if (slot?.effect) slot.cleanup?.()
      }),
  }
}
function design(files: Record<string, string>, path: string) {
  const session = editorSession({
    read: () => files[path],
    write: (v) => {
      files[path] = v
    },
    recover: () => assert.fail('unexpected recovery'),
  })
  return harness('../design/CodeEditor.tsx', 'CodeEditor', {
    '../lib/useScopedFile': { useScopedFile: () => session },
    '../lib/merge3': merge,
    './store': { useDesign: (select: (s: unknown) => unknown) => select({ sel: null, rev: 0 }) },
  })
}

test('UI03: real Design handlers flush B input to B on unmount before debounce', () => {
  const files = { a: 'A', b: 'B' }
  const a = design(files, 'a')
  a.render({ pid: 'P', path: 'a', value: 'A' })
  a.unmount()
  const b = design(files, 'b')
  const props = { pid: 'P', path: 'b', value: 'B' }
  callback(find(b.render(props), 'textarea')!, 'onChange')({ target: { value: 'B_TYPED' } })
  b.render(props)
  b.unmount()
  b.time.run()
  assert.deepEqual(files, { a: 'A', b: 'B_TYPED' })
})
test('UI04: real A pending cleanup then B untouched cleanup never sends B text to A', () => {
  const files = { a: 'A', b: 'B' }
  const a = design(files, 'a')
  const props = { pid: 'P', path: 'a', value: 'A' }
  callback(find(a.render(props), 'textarea')!, 'onChange')({ target: { value: 'A_TYPED' } })
  a.render(props)
  a.unmount()
  const b = design(files, 'b')
  b.render({ pid: 'P', path: 'b', value: 'B' })
  b.unmount()
  a.time.run()
  b.time.run()
  assert.deepEqual(files, { a: 'A_TYPED', b: 'B' })
})
test('Design latest refs: debounce followed by new input then cleanup only writes latest input', () => {
  const files = { a: 'A' }
  const a = design(files, 'a')
  const props = { pid: 'P', path: 'a', value: 'A' }
  callback(find(a.render(props), 'textarea')!, 'onChange')({ target: { value: 'ONE' } })
  a.render(props)
  a.time.run()
  assert.equal(files.a, 'ONE')
  const current = { ...props, value: 'ONE' }
  callback(find(a.render(current), 'textarea')!, 'onChange')({ target: { value: 'TWO' } })
  a.render(current)
  a.unmount()
  a.time.run()
  assert.equal(files.a, 'TWO')
})
test('D08: actual Inspector TextBox commits before switching doc and creates no delayed timer', () => {
  const docA = {},
    docB = {}
  const el = { ownerDocument: docA, textContent: 'A' }
  const saved = { a: 'A', b: 'B' }
  let current = docA
  const box = harness('../design/Inspector.tsx', 'TextBox', {
    './store': { useDesign: { getState: () => ({ doc: current }) } },
    './actions': {
      setText: (target: typeof el, text: string) => {
        target.textContent = text
        if (current === docA) saved.a = text
        else saved.b = text
      },
    },
  })
  callback(
    find(box.render({ el, initial: 'A', multi: true }), 'textarea')!,
    'onChange',
  )({ target: { value: 'A LAST EDIT' } })
  current = docB
  box.unmount()
  box.time.run()
  assert.deepEqual(saved, { a: 'A LAST EDIT', b: 'B' })
  assert.equal(box.time.count(), 0)
})

test('UI06/07: actual workspace key handlers save and finish; Russian layout comments work', () => {
  const files = { 'README.md': 'hello' }
  let finished = 0
  const session = editorSession({
    read: () => files['README.md'],
    write: (v) => {
      files['README.md'] = v
    },
    recover: () => assert.fail('unexpected recovery'),
  })
  const store = Object.assign((select: (s: unknown) => unknown) => select({ people: {} }), {
    getState: () => ({}),
  })
  // Keep the real mount-consumption/cleanup contract; this keyboard fixture has no pending goto.
  const navigation = { exports: {} }
  const navigationCode = ts.transpileModule(
    readFileSync(new URL('../store/navigation.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText
  new Function('require', 'module', 'exports', navigationCode)(
    (name: string) => {
      if (name === '../lib/chatDraft') return chatDraft
      assert.equal(name, './index', 'unexpected navigation dependency')
      return { useStore: store }
    },
    navigation,
    navigation.exports,
  )
  const editState = { pending: false }
  const editor = harness('../workspace/CodeEditor.tsx', 'CodeSurface', {
    '../store/navigation': navigation.exports,
    '../lib/useScopedFile': { useScopedFile: () => session },
    '../lib/merge3': merge,
    '../lib/folds': folds,
    '../store': { useStore: store },
    '../lib/a11y': { rowKeys: () => () => {} },
    '../lib/layout': { useLayout: () => false },
    '../lib/team': { usePeers: () => undefined },
    '../lib/editstate': {
      useEdit: { getState: () => editState },
      editPending: () => {
        editState.pending = true
      },
      editSaved: () => {
        editState.pending = false
      },
      editIdle: () => {
        editState.pending = false
      },
    },
  })
  const props = {
    p: { id: 'P', comments: [] },
    file: 'README.md',
    lang: 'md',
    content: 'hello',
    editing: true,
    onFinish: () => finished++,
  }
  let ta = find(editor.render(props), 'textarea')!
  callback(ta, 'onChange')({ target: { value: 'typed' } })
  ta = find(editor.render(props), 'textarea')!
  let prevented = 0,
    blurred = 0
  const target = {
    value: 'typed',
    selectionStart: 0,
    selectionEnd: 5,
    focus() {},
    blur() {
      blurred++
    },
    setRangeText(text: string) {
      this.value = text
    },
    dispatchEvent() {},
    setSelectionRange() {},
  }
  const event = (code: string, key: string, ctrlKey = true) => ({
    code,
    key,
    ctrlKey,
    metaKey: false,
    currentTarget: target,
    preventDefault: () => prevented++,
  })
  callback(ta, 'onKeyDown')(event('KeyS', 'ы'))
  assert.equal(files['README.md'], 'typed')
  callback(ta, 'onKeyDown')(event('Slash', '.'))
  assert.equal(target.value, '<!-- typed -->')
  callback(ta, 'onKeyDown')(event('Escape', 'Escape', false))
  assert.equal(finished, 1)
  assert.equal(blurred, 1)
  assert.equal(prevented, 3)
  editor.unmount()
})
test('identity wiring: both parents use pid/path keys and workspace exposes finish callback', () => {
  const studio = readFileSync(new URL('../design/Studio.tsx', import.meta.url), 'utf8')
  const pane = readFileSync(new URL('../workspace/RightPane.tsx', import.meta.url), 'utf8')
  assert.match(studio, /key=\{JSON\.stringify\(\[p\.id, page\]\)\}/)
  assert.match(pane, /key=\{JSON\.stringify\(\[p\.id, file\]\)\}/)
  assert.match(pane, /onFinish=\{\(\) => setEditing\(false\)\}/)
})

test('UI02: real scoped hook preserves original trash and all pending edits, including over FILE_MAX', () => {
  const project = {
    id: 'A',
    files: { 'README.md': 'ORIGINAL' } as Record<string, string>,
    trash: [] as { path: string; content: string; at: number }[],
  }
  const subscribers = new Set<() => void>()
  const toasts: { title: string; action: { run: () => void } }[] = []
  let downloaded = ''
  const state = {
    projects: [project],
    writeFile: (path: string, text: string, pid: string) => {
      assert.equal(pid, 'A')
      project.files[path] = text
      subscribers.forEach((fn) => fn())
    },
    toast: (value: (typeof toasts)[number]) => toasts.push(value),
  }
  const store = {
    getState: () => state,
    setState: (fn: (s: typeof state) => void) => {
      fn(state)
      subscribers.forEach((cb) => cb())
    },
    subscribe: (fn: () => void) => {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
  }
  const hook = harness('./useScopedFile.ts', 'useScopedFile', {
    '../store': { useStore: store },
    './editorSession': { editorSession },
    './trash': trash,
    './util': {
      download: (_path: string, text: string) => {
        downloaded = text
      },
    },
  })
  const session = hook.render('A', 'README.md') as ReturnType<typeof editorSession>
  project.trash.push({ path: 'README.md', content: 'ORIGINAL', at: Date.now() })
  delete project.files['README.md']
  subscribers.forEach((fn) => fn())
  project.files['README.md'] = 'RECREATED'
  const pending = 'X'.repeat(400_001)
  session.save('ORIGINAL', pending)
  assert.equal(project.files['README.md'], 'RECREATED')
  assert.deepEqual(
    project.trash.map((x) => x.content),
    [pending, 'ORIGINAL'],
  )
  assert.notEqual(project.trash[0].path, 'README.md')
  assert.match(toasts[0].title, /корзине/)
  toasts[0].action.run()
  assert.equal(downloaded, pending)
  hook.unmount()
  assert.equal(subscribers.size, 0)
})
