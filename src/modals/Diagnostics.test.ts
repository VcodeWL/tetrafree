import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { diagnosticsJSON } from '../lib/diagnostics'

interface Node {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}
function find(tree: unknown, predicate: (n: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map((n) => find(n, predicate)).find(Boolean)
  if (!tree || typeof tree !== 'object') return
  const n = tree as Node
  return predicate(n) ? n : find(n.children, predicate)
}
function text(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' ? text((tree as Node).children) : ''
}
function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void
  const promise = new Promise<void>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
const secret = 'SYNTHETIC_PRIVATE_no_real_secret'
function fixture(
  options: {
    collect?: () => unknown
    clipboard?: (s: string) => Promise<void>
    missingClipboard?: boolean
    downloadThrows?: boolean
  } = {},
) {
  let cursor = 0,
    live = true,
    lateWrites = 0,
    collections = 0
  const slots: { value?: unknown; current?: unknown }[] = [],
    effects: (() => void)[] = [],
    cleanups: (() => void)[] = []
  const copied: string[] = [],
    downloads: unknown[][] = []
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({
      type,
      props: props || {},
      children,
    }),
    useState: (init: unknown) => {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof init === 'function' ? init() : init }
      return [
        slots[i].value,
        (v: unknown) => {
          if (!live) lateWrites++
          slots[i].value = typeof v === 'function' ? v(slots[i].value) : v
        },
      ]
    },
    useRef: (current: unknown) => {
      const i = cursor++
      return (slots[i] ||= { current })
    },
    useEffect: (fn: () => () => void) => {
      const i = cursor++
      if (!slots[i]) {
        slots[i] = {}
        effects.push(() => cleanups.push(fn()))
      }
    },
  }
  const imports: Record<string, unknown> = {
    react,
    '../components/ui/Modal': { Modal: 'Modal', MHead: 'MHead' },
    '../lib/diagnostics': { diagnosticsJSON },
    '../lib/util': {
      download: (...args: unknown[]) => {
        if (options.downloadThrows) throw new Error(secret)
        downloads.push(args)
      },
    },
  }
  const navigator = options.missingClipboard
    ? {}
    : {
        clipboard: {
          writeText: (s: string) => {
            copied.push(s)
            return options.clipboard ? options.clipboard(s) : Promise.resolve()
          },
        },
      }
  const src = fs.readFileSync(new URL('./Diagnostics.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const mod = { exports: {} as { DiagnosticsModal?: (props: { collect: () => unknown }) => Node } }
  new Function('require', 'module', 'exports', 'React', 'navigator', code)(
    (name: string) => {
      assert.ok(name in imports, name)
      return imports[name]
    },
    mod,
    mod.exports,
    react,
    navigator,
  )
  let raw: unknown = { projects: { count: 2 }, backend: { baseUrl: secret, version: secret }, token: secret }
  const collect = () => {
    collections++
    return options.collect ? options.collect() : raw
  }
  const render = () => {
    cursor = 0
    const tree = mod.exports.DiagnosticsModal!({ collect })
    effects.splice(0).forEach((fn) => fn())
    return tree
  }
  const button = (label: string) => find(render(), (n) => n.type === 'button' && text(n) === label)!
  const click = (label: string) => (button(label).props.onClick as () => void)()
  const preview = () => find(render(), (n) => n.type === 'textarea')?.props.value as string
  return {
    render,
    button,
    click,
    preview,
    copied,
    downloads,
    collections: () => collections,
    change: (v: unknown) => {
      raw = v
    },
    unmount: () => {
      live = false
      cleanups.forEach((fn) => fn())
    },
    lateWrites: () => lateWrites,
  }
}

test('preview is sanitized on mount; no clipboard/download/refresh side effects', () => {
  const f = fixture(),
    json = f.preview()
  assert.ok(!json.includes(secret))
  assert.equal(JSON.parse(json).projects.count, 2)
  assert.equal(f.collections(), 1)
  assert.equal(f.copied.length, 0)
  assert.equal(f.downloads.length, 0)
  assert.equal(find(f.render(), (n) => n.type === 'textarea')!.props.readOnly, true)
})
test('explicit copy/download export EXACT preview; changes to collector require explicit refresh', async () => {
  const f = fixture(),
    original = f.preview()
  f.change({ projects: { count: 9 }, error: secret })
  f.click('Копировать JSON')
  await tick()
  assert.deepEqual(f.copied, [original])
  f.click('Скачать JSON')
  assert.deepEqual(f.downloads, [['tetrafree-diagnostics.json', original, 'application/json']])
  assert.equal(f.collections(), 1)
  f.click('Обновить снимок')
  assert.equal(JSON.parse(f.preview()).projects.count, 9)
  assert.equal(f.collections(), 2)
  assert.ok(!text(f.render()).includes(secret))
})
test('clipboard rejection/missing API never reports success or exposes raw exceptions', async () => {
  for (const options of [
    { clipboard: () => Promise.reject(new Error(secret)) },
    { missingClipboard: true },
  ]) {
    const f = fixture(options)
    f.click('Копировать JSON')
    await tick()
    assert.match(text(f.render()), /Не удалось скопировать/)
    assert.ok(!text(f.render()).includes('Диагностика скопирована'))
    assert.ok(!text(f.render()).includes(secret))
    assert.equal(f.button('Копировать JSON').props.disabled, false)
  }
})
test('double copy is single-flight and download/refresh disabled while pending', async () => {
  const d = deferred(),
    f = fixture({ clipboard: () => d.promise })
  const onClick = f.button('Копировать JSON').props.onClick as () => void
  onClick()
  onClick()
  assert.equal(f.copied.length, 1)
  assert.equal(f.button('Скачать JSON').props.disabled, true)
  f.click('Обновить снимок')
  assert.equal(f.collections(), 1)
  f.click('Скачать JSON')
  assert.equal(f.downloads.length, 0)
  d.resolve()
  await tick()
  assert.match(text(f.render()), /Диагностика скопирована/)
})
test('late clipboard resolve or rejection after unmount never writes UI state', async () => {
  for (const fail of [false, true]) {
    const d = deferred(),
      f = fixture({ clipboard: () => d.promise })
    f.click('Копировать JSON')
    f.unmount()
    if (fail) d.reject(new Error(secret))
    else d.resolve()
    await tick()
    assert.equal(f.lateWrites(), 0)
  }
})
test('collector failure disables export and never displays exception; refresh can recover', () => {
  let fail = true
  const f = fixture({
    collect: () => {
      if (fail) throw new Error(secret)
      return { projects: { count: 1 } }
    },
  })
  assert.match(text(f.render()), /Экспорт отключён/)
  assert.ok(!text(f.render()).includes(secret))
  assert.equal(f.button('Копировать JSON').props.disabled, true)
  f.click('Копировать JSON')
  f.click('Скачать JSON')
  assert.equal(f.copied.length, 0)
  assert.equal(f.downloads.length, 0)
  fail = false
  f.click('Обновить снимок')
  assert.equal(JSON.parse(f.preview()).projects.count, 1)
})
test('download preparation failure is generic, never a false success', () => {
  const f = fixture({ downloadThrows: true })
  f.click('Скачать JSON')
  assert.match(text(f.render()), /Не удалось подготовить JSON/)
  assert.ok(!text(f.render()).includes('JSON подготовлен к скачиванию.'))
  assert.ok(!text(f.render()).includes(secret))
})
