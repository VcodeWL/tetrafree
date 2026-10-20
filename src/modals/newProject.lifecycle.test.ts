/* Runs real component bodies with controlled hooks/context/network, not React DOM or Windows.
   Sources are resolved relative to this file; no listeners, real git, disk sync or global browser state. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

type Props = Record<string, unknown>
interface Tree {
  type: unknown
  props: Props
  children: unknown[]
}
interface Slot {
  value?: unknown
  current?: unknown
  deps?: unknown[]
  cleanup?: (() => void) | void
}
interface Context {
  initial: unknown
  Provider: object
}
interface Notice {
  title: string
  tone?: string
  desc?: string
  action?: { label: string; run: () => unknown }
}
type Mode = 'new' | 'open' | 'clone'
type Summary = { pulled: number; truncated: boolean }
type CloneReply = { ok: boolean; reason?: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

function clock() {
  let id = 0
  const tasks = new Map<number, { fn: () => void; ms: number }>()
  return {
    setTimeout(fn: () => void, ms = 0) {
      tasks.set(++id, { fn, ms })
      return id
    },
    clearTimeout(key: number) {
      tasks.delete(key)
    },
    run(ms: number) {
      const ready = [...tasks].filter(([, task]) => task.ms === ms)
      for (const [key, task] of ready) {
        tasks.delete(key)
        task.fn()
      }
    },
    clear() {
      tasks.clear()
    },
  }
}

function hooks() {
  let cursor = 0
  const slots: Slot[] = []
  const effects: (() => void)[] = []
  const contexts = new Map<Context, unknown>()
  const contextHandles: Context[] = []
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    Fragment: 'fragment',
    createElement: (type: unknown, props: Props | null, ...children: unknown[]): Tree => ({
      type,
      props: props || {},
      children,
    }),
    createContext: (initial: unknown): Context => {
      const context = { initial, Provider: {} }
      contextHandles.push(context)
      return context
    },
    useContext: (context: Context) => (contexts.has(context) ? contexts.get(context) : context.initial),
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
    useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
      const i = cursor++
      if (slots[i] && same(slots[i].deps, deps)) return
      const old = slots[i]
      slots[i] = { deps }
      effects.push(() => {
        old?.cleanup?.()
        slots[i].cleanup = effect()
      })
    },
  }
  return {
    react,
    render(fn: (props: Props) => unknown, props: Props): Tree {
      cursor = 0
      const tree = fn(props) as Tree
      effects.splice(0).forEach((fn) => fn())
      return tree
    },
    // ModalBusy.Provider is discovered from the real Modal output, not a manually forced busy flag.
    inProvider<T>(provider: Tree, render: () => T): T {
      const providerContext = contextHandles.find((c) => c.Provider === provider.type)
      assert.ok(providerContext, 'Modal must return a known context provider')
      const had = contexts.has(providerContext),
        previous = contexts.get(providerContext)
      contexts.set(providerContext, provider.props.value)
      try {
        return render()
      } finally {
        if (had) contexts.set(providerContext, previous)
        else contexts.delete(providerContext)
      }
    },
    unmount() {
      slots.forEach((s) => s.cleanup?.())
      effects.length = 0
    },
  }
}

function find(tree: unknown, predicate: (node: Tree) => boolean): Tree | undefined {
  if (Array.isArray(tree)) return tree.map((node) => find(node, predicate)).find(Boolean)
  if (!tree || typeof tree !== 'object') return
  const node = tree as Tree
  return predicate(node) ? node : find(node.children, predicate)
}
function control(tree: Tree, id: string) {
  const node = find(tree, (node) => node.props.id === id)
  assert.ok(node, `missing control ${id}`)
  return node
}
function invoke(node: Tree, name: string, event: unknown = {}) {
  const fn = node.props[name]
  assert.equal(typeof fn, 'function', `missing ${name}`)
  return (fn as (event: unknown) => unknown)(event)
}
function primary(tree: Tree) {
  const button = find(tree, (node) => node.type === 'button' && node.props.className === 'btn pri')
  assert.ok(button, 'primary action must be present')
  return button
}

function load(
  path: string,
  react: ReturnType<typeof hooks>['react'],
  imports: Record<string, unknown>,
  globals: Record<string, unknown>,
) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} as Record<string, (props: Props) => Tree> }
  new Function('require', 'module', 'exports', 'React', ...Object.keys(globals), code)(
    (name: string) => {
      if (name === 'react') return react
      assert.ok(Object.prototype.hasOwnProperty.call(imports, name), `unconfigured dependency ${name}`)
      return imports[name]
    },
    mod,
    mod.exports,
    react,
    ...Object.values(globals),
  )
  return mod.exports
}

function projectFixture(
  options: {
    mode?: Mode
    reconcile?: () => Promise<Summary | null>
    clone?: () => Promise<CloneReply>
  } = {},
) {
  const h = hooks(),
    time = clock()
  const notices: Notice[] = [],
    creations: Props[] = [],
    syncCalls: unknown[][] = []
  const cloneCalls: unknown[][] = [],
    forgotten: string[] = []
  let closes = 0
  const project = { id: 'existing-project', name: 'existing', path: 'C:/work/existing' }
  const state = {
    projects: [project],
    closeModal: () => {
      closes++
    },
    createProject: (props: Props) => {
      creations.push(props)
      return 'created-project'
    },
    up: (update: (p: typeof project) => void, id: string) => {
      assert.equal(id, project.id)
      update(project)
    },
  }
  const useStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })
  const backendState = { info: { root: 'C:/work', sep: '/' }, lastError: 'Сверка недоступна' }
  const useBackend = Object.assign(
    (selector: (s: typeof backendState) => unknown) => selector(backendState),
    {
      getState: () => backendState,
    },
  )
  const reconcile = async (...args: unknown[]) => {
    syncCalls.push(args)
    return options.reconcile ? options.reconcile() : null
  }
  const components = load(
    './NewProject.tsx',
    h.react,
    {
      '../lib/paths': { repoName: () => 'demo' },
      '../store/slices/projects': { projectPathKey: (p?: string) => (p || '').toLowerCase() },
      '../components/ServerHelp': {},
      '../store': { useStore, toast: (notice: Notice) => notices.push(notice) },
      '../components/ui/Icon': {},
      '../components/ui/Modal': {},
      '../components/ui/primitives': {},
      '../lib/util': { slug: (s: string) => s, nFiles: String },
      '../lib/backend': {
        backendOnline: () => true,
        useBackend,
        bCheckFolder: async (dir: string) => ({ ok: true, dir, exists: options.mode === 'open', entries: 0 }),
        bClone: async (...args: unknown[]) => {
          cloneCalls.push(args)
          return options.clone ? options.clone() : { ok: true }
        },
      },
      '../lib/sync': { reconcile, forgetBase: (id: string) => forgotten.push(id) },
    },
    { localStorage: { getItem: () => 'C:/work', setItem() {} }, ...time },
  )
  return {
    ...h,
    notices,
    creations,
    syncCalls,
    cloneCalls,
    forgotten,
    project,
    closes: () => closes,
    render: () => h.render(components.NewProjectModal, { mode: options.mode || 'new' }),
    renderFolder: () => h.render(components.ProjectFolderModal, { id: project.id }),
    check: async () => {
      time.run(250)
      await settle()
    },
    clear: () => {
      h.unmount()
      time.clear()
    },
  }
}

async function readyProject(options: Parameters<typeof projectFixture>[0] = {}) {
  const f = projectFixture(options)
  let tree = f.render()
  const id = options.mode === 'clone' ? 'np-url' : options.mode === 'open' ? 'np-folder' : 'np-name'
  const value =
    options.mode === 'clone'
      ? 'https://example.invalid/team/demo.git'
      : options.mode === 'open'
        ? 'C:/work/demo'
        : 'demo'
  invoke(control(tree, id), 'onChange', { target: { value } })
  tree = f.render()
  assert.equal(primary(tree).props.disabled, true, 'must await folder check')
  await f.check()
  tree = f.render()
  assert.equal(primary(tree).props.disabled, false, 'valid checked input must enable action')
  return { f, tree }
}

for (const mode of ['new', 'open', 'clone'] as const) {
  test(`F04: ${mode} warns on null reconcile, never emits false success; retry retains created pid`, async () => {
    const { f, tree } = await readyProject({ mode })
    try {
      invoke(primary(tree), 'onClick')
      await settle()
      assert.equal(f.creations.length, 1, 'local project must remain created')
      assert.deepEqual(f.syncCalls, [['created-project', { quiet: true }]])
      assert.equal(f.notices.length, 1)
      assert.equal(f.notices[0].tone, 'warn')
      assert.match(f.notices[0].title, /не синхронизирована/)
      assert.equal(f.notices[0].desc, 'Сверка недоступна')
      assert.equal(
        f.notices.some((n) => n.tone === 'ok'),
        false,
      )
      assert.ok(f.notices[0].action, 'warning must expose retry')
      await f.notices[0].action.run()
      assert.deepEqual(f.syncCalls[1], ['created-project'])
    } finally {
      f.clear()
    }
  })
}

test('F04: ProjectFolder warns on null reconcile and retries original id, without false success', async () => {
  const f = projectFixture()
  try {
    let tree = f.renderFolder()
    const picker = find(tree, (node) => typeof node.props.onPick === 'function')
    assert.ok(picker)
    invoke(picker, 'onPick', 'C:/work/relocated')
    f.renderFolder()
    await settle()
    tree = f.renderFolder()
    assert.equal(primary(tree).props.disabled, false)
    invoke(primary(tree), 'onClick')
    await settle()
    assert.equal(f.project.path, 'C:/work/relocated')
    assert.deepEqual(f.forgotten, ['existing-project'])
    assert.deepEqual(f.syncCalls, [['existing-project', { quiet: true }]])
    assert.equal(f.notices.length, 1)
    assert.equal(f.notices[0].tone, 'warn')
    assert.match(f.notices[0].title, /ещё не синхронизированы/)
    assert.equal(
      f.notices.some((n) => n.tone === 'ok'),
      false,
    )
    assert.ok(f.notices[0].action)
    await f.notices[0].action.run()
    assert.deepEqual(f.syncCalls[1], ['existing-project'])
    assert.equal(f.closes(), 1)
  } finally {
    f.clear()
  }
})

for (const ok of [true, false]) {
  test(`F05: clone response ok=${ok} after unmount cannot create project or start reconcile`, async () => {
    const clone = deferred<CloneReply>()
    const { f, tree } = await readyProject({ mode: 'clone', clone: () => clone.promise })
    try {
      invoke(primary(tree), 'onClick')
      assert.equal(f.cloneCalls.length, 1, 'clone must actually be pending')
      assert.equal(f.render().props.busy, true)
      assert.equal(f.creations.length, 0)
      f.unmount()
      clone.resolve({ ok, reason: ok ? undefined : 'Не удалось клонировать' })
      await settle()
      assert.equal(f.creations.length, 0)
      assert.equal(f.syncCalls.length, 0)
      assert.equal(f.notices.length, 0)
      assert.equal(f.closes(), 0)
    } finally {
      f.clear()
    }
  })
}

test('F05 positive control: a mounted clone can still create and sync successfully', async () => {
  const clone = deferred<CloneReply>()
  const { f, tree } = await readyProject({
    mode: 'clone',
    clone: () => clone.promise,
    reconcile: async () => ({ pulled: 1, truncated: false }),
  })
  try {
    invoke(primary(tree), 'onClick')
    clone.resolve({ ok: true })
    await settle()
    assert.equal(f.creations.length, 1)
    assert.equal(f.syncCalls.length, 1)
    assert.equal(f.notices.length, 1)
    assert.equal(f.notices[0].tone, 'ok')
    assert.match(f.notices[0].title, /Клонировано/)
  } finally {
    f.clear()
  }
})

function modalFixture() {
  const h = hooks()
  let closes = 0
  const state = {
    closeModal: () => {
      closes++
    },
    palette: false,
  }
  const useStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })
  const components = load(
    '../components/ui/Modal.tsx',
    h.react,
    {
      '../../hooks/useFocus': { useModalFocus() {} },
      '../../store': { useStore },
      './Icon': {},
    },
    { window: { addEventListener() {}, removeEventListener() {} }, document: { querySelector: () => null } },
  )
  return { ...h, components, closes: () => closes }
}

test('F05: real busy Modal provider disables MHead close, including custom onClose', () => {
  const f = modalFixture()
  let customCloses = 0
  try {
    const provider = f.render(f.components.Modal, { busy: true, label: 'Clone' })
    assert.equal(provider.props.value, true, 'Modal must propagate its busy prop')
    for (const onClose of [
      undefined,
      () => {
        customCloses++
      },
    ]) {
      const header = f.inProvider(provider, () => f.components.MHead({ title: 'Clone', onClose }))
      const close = find(header, (node) => node.props['aria-label'] === 'Закрыть')
      assert.ok(close)
      assert.equal(close.props.disabled, true)
      // A disabled DOM button does not dispatch user clicks. Do not invoke its raw handler.
    }
    assert.equal(customCloses, 0)
    assert.equal(f.closes(), 0)
  } finally {
    f.unmount()
  }
})

test('F05 positive controls: idle Modal and standalone MHead still allow close', () => {
  const f = modalFixture()
  try {
    const provider = f.render(f.components.Modal, { busy: false, label: 'Idle' })
    assert.equal(provider.props.value, false)
    for (const header of [
      f.inProvider(provider, () => f.components.MHead({ title: 'Idle' })),
      f.components.MHead({ title: 'Standalone' }),
    ]) {
      const close = find(header, (node) => node.props['aria-label'] === 'Закрыть')
      assert.ok(close)
      assert.equal(close.props.disabled, false)
      invoke(close, 'onClick')
    }
    assert.equal(f.closes(), 2)
  } finally {
    f.unmount()
  }
})

test('F05: rejected clone after unmount stays silent and cannot create project or start reconcile', async () => {
  const clone = deferred<CloneReply>()
  const { f, tree } = await readyProject({ mode: 'clone', clone: () => clone.promise })
  try {
    invoke(primary(tree), 'onClick')
    assert.equal(f.cloneCalls.length, 1, 'clone must actually be pending')
    assert.equal(f.render().props.busy, true)
    f.unmount()
    clone.reject(new Error('Контролируемый поздний отказ клонирования'))
    await settle()
    assert.equal(f.creations.length, 0)
    assert.equal(f.syncCalls.length, 0)
    assert.equal(f.notices.length, 0)
    assert.equal(f.closes(), 0)
  } finally {
    f.clear()
  }
})
