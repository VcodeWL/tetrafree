import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

interface Node {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}
function find(tree: unknown, p: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map((n) => find(n, p)).find(Boolean)
  if (!tree || typeof tree !== 'object') return
  const node = tree as Node
  return p(node) ? node : find(node.children, p)
}
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' ? text((tree as Node).children) : ''
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve!: (value: { ok: boolean; message: string }) => void
  const promise = new Promise<{ ok: boolean; message: string }>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function fixture() {
  let cursor = 0,
    live = true,
    lateWrites = 0,
    reads = 0,
    pauses = 0,
    intervals = 0
  const slots: { value?: unknown; current?: unknown; deps?: unknown[] }[] = [],
    effects: (() => void)[] = [],
    cleanups: (() => void)[] = []
  const equal = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
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
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const i = cursor++
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        slots[i] = { deps }
        effects.push(() => {
          const cleanup = fn()
          if (cleanup) cleanups.push(cleanup)
        })
      }
    },
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      const i = cursor++
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
      return slots[i].value
    },
  }
  const action = {
    label: 'Снять очередь',
    kind: 'cancel',
    confirm: 'Подтвердить удаление?',
    run: () => {
      calls++
      return Promise.resolve({ ok: true, message: 'Готово' })
    },
  }
  let calls = 0
  const rows = [
    {
      id: 'A',
      projectId: 'A',
      project: 'Alpha',
      title: 'Queue A',
      kind: 'queue',
      status: 'waiting',
      detail: 'Очередь',
      progress: '1',
      actions: [action],
    },
    {
      id: 'B',
      projectId: 'B',
      project: 'Beta',
      title: 'Queue B',
      kind: 'queue',
      status: 'waiting',
      detail: 'Очередь',
      progress: '1',
      actions: [],
    },
  ]
  const imports: Record<string, unknown> = {
    react,
    '../components/ui/Modal': { Modal: 'Modal', MHead: 'MHead' },
    '../components/ui/Icon': { Icon: 'Icon' },
    '../store': {
      useStore: {
        getState: () => ({
          projectId: 'A',
          projects: [
            { id: 'A', name: 'Alpha' },
            { id: 'B', name: 'Beta' },
          ],
        }),
      },
    },
    '../agent/automationJournal': {
      automationIdentity: async (pid: string) => pid,
      useAutomationJournal: (select: (s: unknown) => unknown) => select({ unavailable: false }),
    },
    '../agent/automationControl': {
      useAutomationControl: (select: (s: unknown) => unknown) =>
        select({ paused: true, storageError: false }),
      pauseAutomations: () => {
        pauses++
      },
      resumeAutomations: () => {
        pauses++
      },
    },
    '../agent/operations': {
      collectOperations: () => {
        reads++
        return { rows, truncated: false }
      },
      activeOperation: (r: { status: string }) => r.status === 'waiting',
      attentionOperation: () => false,
      terminalOperation: () => false,
      observeProgress: () => ({ next: new Map(), quiet: new Set() }),
    },
    '../lib/util': { ago: () => '' },
  }
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL('./Operations.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const window = {
    setInterval: () => {
      intervals++
      return 1
    },
    clearInterval: () => {
      intervals--
    },
  }
  new Function('require', 'module', 'exports', 'window', 'React', code)(
    (name: string) => {
      assert.ok(name in imports, name)
      return imports[name]
    },
    mod,
    mod.exports,
    window,
    react,
  )
  const api = mod.exports as { OperationsModal: () => unknown }
  const render = () => {
    cursor = 0
    const tree = api.OperationsModal()
    while (effects.length) effects.shift()!()
    return tree
  }
  const click = (tree: unknown, label: string) => {
    const node = find(tree, (n) => n.type === 'button' && text(n.children) === label)
    assert.ok(node, label)
    return (node.props.onClick as () => unknown)()
  }
  const scope = (tree: unknown, id: string) => {
    const node = find(tree, (n) => n.props['aria-label'] === 'Проекты операций')
    assert.ok(node)
    ;(node.props.onChange as (e: unknown) => void)({ target: { value: id } })
  }
  return {
    render,
    click,
    scope,
    action,
    rows,
    get calls() {
      return calls
    },
    get reads() {
      return reads
    },
    get pauses() {
      return pauses
    },
    get lateWrites() {
      return lateWrites
    },
    get intervals() {
      return intervals
    },
    unmount() {
      live = false
      for (const cleanup of cleanups) cleanup()
    },
  }
}

test('operations mount and polling projection do not dispatch, resume or cancel; cleanup removes interval', async () => {
  const f = fixture()
  let tree = f.render()
  await tick()
  tree = f.render()
  assert.ok(text(tree).includes('Alpha'))
  assert.ok(!text(tree).includes('Queue B'))
  assert.equal(f.calls, 0)
  assert.equal(f.pauses, 0)
  assert.equal(f.intervals, 1)
  f.click(tree, 'Обновить')
  f.render()
  assert.ok(f.reads >= 2)
  assert.equal(f.calls, 0)
  f.unmount()
  assert.equal(f.intervals, 0)
})
test('destructive action requires explicit confirmation; cancel does not execute', async () => {
  const f = fixture()
  let tree = f.render()
  f.click(tree, 'Снять очередь')
  tree = f.render()
  assert.equal(f.calls, 0)
  assert.ok(find(tree, (n) => n.props['aria-label'] === 'Подтверждение действия'))
  f.click(tree, 'Не выполнять')
  tree = f.render()
  assert.equal(f.calls, 0)
  assert.equal(
    find(tree, (n) => n.props['aria-label'] === 'Подтверждение действия'),
    undefined,
  )
  f.click(tree, 'Снять очередь')
  tree = f.render()
  await f.click(tree, 'Подтвердить действие')
  assert.equal(f.calls, 1)
  await tick()
  assert.ok(text(f.render()).includes('Готово'))
  f.unmount()
})
test('confirmation captures action but scope change discards confirmation without dispatch', () => {
  const f = fixture()
  let tree = f.render()
  f.click(tree, 'Снять очередь')
  tree = f.render()
  f.scope(tree, 'B')
  tree = f.render()
  assert.equal(f.calls, 0)
  assert.equal(
    find(tree, (n) => n.props['aria-label'] === 'Подтверждение действия'),
    undefined,
  )
  assert.ok(text(tree).includes('Queue B'))
  f.unmount()
})
test('pending action is single flight; late result does not write state after unmount', async () => {
  const f = fixture(),
    d = deferred()
  f.action.run = () => {
    return d.promise
  }
  let tree = f.render()
  f.click(tree, 'Снять очередь')
  tree = f.render()
  const pending = f.click(tree, 'Подтвердить действие')
  f.unmount()
  d.resolve({ ok: true, message: 'LATE' })
  await pending
  assert.equal(f.lateWrites, 0)
})
test('late result from previous scope does not show success in another project', async () => {
  const f = fixture(),
    d = deferred()
  f.action.run = () => d.promise
  let tree = f.render()
  f.click(tree, 'Снять очередь')
  tree = f.render()
  const pending = f.click(tree, 'Подтвердить действие')
  tree = f.render()
  f.scope(tree, 'B')
  f.render()
  d.resolve({ ok: true, message: 'OLD_SCOPE_SUCCESS' })
  await pending
  assert.ok(!text(f.render()).includes('OLD_SCOPE_SUCCESS'))
  f.unmount()
})
