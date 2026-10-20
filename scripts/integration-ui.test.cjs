// Bounded actual-source integration fixtures. No browser/network/native runtime.
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto')
const root = path.resolve(__dirname, '..'),
  ts = require('typescript')
const used = new Map()
function source(file) {
  const s = fs.readFileSync(path.join(root, file), 'utf8')
  used.set(file, crypto.createHash('sha256').update(s).digest('hex'))
  return s
}
function execute(src, imports = {}, globals = {}) {
  const mod = { exports: {} }
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(
    (n) => {
      assert.ok(n in imports, 'unexpected dependency ' + n)
      return imports[n]
    },
    mod,
    mod.exports,
    ...Object.values(globals),
  )
  return mod.exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setImmediate(r))
const el = (type, props, ...children) => ({ type, props: props || {}, children })
function find(n, p) {
  if (Array.isArray(n)) return n.map((x) => find(x, p)).find(Boolean)
  if (!n || typeof n !== 'object') return
  if (p(n)) return n
  return find(n.children, p)
}
function text(n) {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(text).join('')
  return n && typeof n === 'object' ? text(n.children) : ''
}
function mainFixture() {
  const order = [],
    rendered = [],
    hydrate = deferred(),
    detect = deferred(),
    prepare = deferred(),
    timers = []
  const react = {
    createElement: el,
    lazy: () => Symbol('Auth'),
    StrictMode: Symbol('StrictMode'),
    Suspense: Symbol('Suspense'),
    useState: (v) => [v, () => {}],
  }
  const imports = {
    react,
    'react-dom/client': { createRoot: () => ({ render: (v) => rendered.push(v), unmount() {} }) },
    './App': { App: Symbol('App') },
    './store': {
      useStore: {},
      hydrateStore: () => {
        order.push('hydrate')
        return hydrate.promise
      },
    },
    './store/persistence': { recoverySnapshots: {} },
    './lib/backend': {
      detectBackend: () => {
        order.push('detect')
        return detect.promise
      },
    },
    './lib/vault': {
      prepareVaultRecovery: () => {
        order.push('prepare')
        return prepare.promise
      },
      startVault: () => order.push('vault'),
    },
    './lib/account': {
      initAccount: () => order.push('account'),
      setAccountRecoveryMode: (v) => order.push('recoveryMode:' + v),
    },
  }
  for (const [file, name, label] of [
    ['./lib/sync', 'startSync', 'sync'],
    ['./lib/docsync', 'startDocSync', 'docsync'],
    ['./lib/team', 'startCloud', 'cloud'],
    ['./agent/ci', 'startScheduler', 'scheduler'],
    ['./lib/autobackup', 'startAutoBackup', 'backup'],
  ])
    imports[file] = { [name]: () => order.push(label) }
  for (const css of ['@xterm/xterm/css/xterm.css', './styles/app.css', './styles/components.css'])
    imports[css] = {}
  imports.react = { ...react, default: react }
  imports['react-dom/client'] = { default: imports['react-dom/client'] }
  execute(
    source('src/main.tsx')
      .replaceAll('import.meta.env.DEV', 'false')
      .replaceAll('import.meta.hot', 'undefined'),
    imports,
    {
      React: react,
      document: { getElementById: () => ({}) },
      setTimeout: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimeout: () => {},
    },
  )
  return { order, rendered, hydrate, detect, prepare, timers, react }
}
test('main defers all writers and App through hydrate, detect and prepare; timeout remains read-only', async () => {
  const f = mainFixture()
  assert.deepEqual(f.order, ['hydrate'])
  f.timers[0]()
  assert.equal(f.rendered[0].type.name, 'Recovery')
  f.hydrate.resolve()
  await tick()
  assert.deepEqual(f.order, ['hydrate', 'detect'])
  f.detect.resolve()
  await tick()
  assert.deepEqual(f.order, ['hydrate', 'detect', 'prepare'])
  f.prepare.resolve()
  await tick()
  assert.deepEqual(f.order, [
    'hydrate',
    'detect',
    'prepare',
    'sync',
    'docsync',
    'account',
    'cloud',
    'scheduler',
    'backup',
    'vault',
  ])
  assert.equal(f.rendered.at(-1).type, f.react.StrictMode)
})
for (const stage of ['hydrate', 'detect', 'prepare'])
  test('main ' + stage + ' rejection never mounts App or starts writers', async () => {
    const f = mainFixture()
    if (stage !== 'hydrate') {
      f.hydrate.resolve()
      await tick()
    }
    if (stage === 'prepare') {
      f.detect.resolve()
      await tick()
    }
    f[stage].reject(new Error('benign fixture failure'))
    await tick()
    assert.equal(f.rendered.at(-1).type.name, 'Recovery')
    assert.ok(
      !f.order.some((x) =>
        ['sync', 'docsync', 'account', 'cloud', 'scheduler', 'backup', 'vault'].includes(x),
      ),
    )
    assert.equal(f.order.includes('recoveryMode:true'), stage === 'prepare')
  })
function hooks() {
  let i = 0
  const slots = []
  const react = {
    createElement: el,
    lazy: () => Symbol('lazy'),
    useRef: (v) => {
      const at = i++
      return (slots[at] ||= { current: v })
    },
    useState: (init) => {
      const at = i++
      if (!slots[at]) slots[at] = { value: typeof init === 'function' ? init() : init }
      return [
        slots[at].value,
        (v) => {
          slots[at].value = typeof v === 'function' ? v(slots[at].value) : v
        },
      ]
    },
  }
  return {
    react,
    render: (fn) => {
      i = 0
      return fn()
    },
  }
}
function formFixture(throwSave = false) {
  const h = hooks(),
    initial = {
      id: 'p',
      name: 'Fixture',
      kind: 'custom',
      baseUrl: 'https://invalid.example/v1',
      apiKey: 'benign-key',
      models: [{ id: 'fixture-model', name: 'Fixture' }],
      on: true,
    }
  let saved = 0,
    ok = 0,
    back = 0
  const state = {
    providers: [structuredClone(initial)],
    model: 'p:fixture-model',
    saveProvider() {
      saved++
      if (throwSave) throw new Error('benign checkpoint refusal')
    },
    setModel() {},
    openModal() {
      back++
    },
  }
  const useStore = Object.assign((selector) => selector(state), { getState: () => state })
  const helper = execute(source('src/lib/providerDraft.ts'))
  const imports = {
    '../lib/providerDraft': helper,
    '../lib/clone': { clone: structuredClone },
    '../lib/vault': { isVaulted: () => false, vaultMode: null },
    react: h.react,
    '../store': { useStore, toast: () => ok++ },
    '../lib/paths': { cleanApiBase: (s) => s },
    '../data/seed': {},
    '../lib/util': {},
    '../components/ui/primitives': {},
    '../components/ui/Modal': {},
    '../components/ui/Icon': {},
    '../components/ui/DateField': {},
    '../lib/taskrel': {},
    '../agent/llm': {},
    '../agent/engine': {},
    '../lib/taskConstants': {},
    '../types': { TIERS: [] },
  }
  const { ProviderModal } = execute(source('src/modals/Forms.tsx'), imports, { React: h.react })
  const render = () => h.render(() => ProviderModal({ id: 'p' }))
  const button = () => find(render(), (n) => n.type === 'button' && n.props.className === 'btn pri')
  return { state, render, button, counters: () => ({ saved, ok, back }) }
}
test('Forms initial preimage survives re-render: remote provider clear cannot be overwritten', () => {
  const f = formFixture()
  f.button()
  f.state.providers[0] = { ...f.state.providers[0], apiKey: '' }
  f.button().props.onClick()
  assert.deepEqual(f.counters(), { saved: 0, ok: 0, back: 0 })
  assert.match(text(f.render()), /изменён в другом окне/)
  assert.equal(f.state.providers[0].apiKey, '')
})
test('Forms saveProvider throw is caught, no success toast/navigation', () => {
  const f = formFixture(true)
  f.button().props.onClick()
  assert.deepEqual(f.counters(), { saved: 1, ok: 0, back: 0 })
  assert.match(text(f.render()), /benign checkpoint refusal/)
})
test('Forms unchanged provider positive control still saves and announces success', () => {
  const f = formFixture()
  f.button().props.onClick()
  assert.deepEqual(f.counters(), { saved: 1, ok: 1, back: 1 })
})
function appNode(predicate) {
  const s = source('src/App.tsx'),
    tree = ts.createSourceFile('App.tsx', s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result
  function visit(n) {
    if (predicate(n, tree)) result = n
    ts.forEachChild(n, visit)
  }
  visit(tree)
  assert.ok(result)
  return result.getText(tree)
}
function appEffect(marker, globals) {
  const code = appNode(
    (n, t) =>
      ts.isCallExpression(n) &&
      n.expression.getText(t) === 'useEffect' &&
      n.arguments[0]?.getText(t).includes(marker),
  )
  return execute(code, {}, globals)
}
test('App generic automation route ignores unknown outcome/private supplied fields and removes listener', () => {
  const listeners = new Map(),
    notifications = []
  let cleanup
  appEffect('tetrafree:automation-notification', {
    useEffect: (fn) => {
      cleanup = fn()
    },
    window: {
      addEventListener: (k, f) => listeners.set(k, f),
      removeEventListener: (k) => listeners.delete(k),
    },
    osNotify: (...args) => notifications.push(args),
  })
  const on = listeners.get('tetrafree:automation-notification')
  for (const outcome of ['succeeded', 'failed', 'cancelled', 'interrupted', 'blocked', 'unknown'])
    on({ detail: { outcome, title: 'benign private title', prompt: 'benign private text' } })
  assert.equal(notifications.length, 5)
  assert.ok(notifications.every((n) => !JSON.stringify(n).includes('private')))
  assert.equal(notifications[1][0], 'Автоматизация не выполнена')
  assert.equal(notifications[4][0], 'Автоматизация не выполнена')
  cleanup()
  assert.equal(listeners.size, 0)
})
test('App desktop mount hook returns lifecycle disposer', () => {
  let mounted = 0,
    disposed = 0,
    cleanup
  appEffect('startDesktopLifecycle', {
    useEffect: (fn) => {
      cleanup = fn()
    },
    startDesktopLifecycle: () => {
      mounted++
      return () => disposed++
    },
  })
  assert.equal(mounted, 1)
  cleanup()
  assert.equal(disposed, 1)
})
test('App primary route keeps Auth reachable while blocking Launcher/Workspace until recovery clears', () => {
  const jsx = appNode(
      (n, t) => ts.isConditionalExpression(n) && n.condition.getText(t) === "screen === 'auth'",
    ),
    react = { createElement: el }
  function route(screen, blocked) {
    return execute(
      'module.exports.route = ' + jsx,
      {},
      {
        React: react,
        screen,
        vaultRecovery: { blocked, checking: false, error: null },
        Auth: 'Auth',
        Launcher: 'Launcher',
        Workspace: 'Workspace',
        useStore: {},
        prepareVaultRecovery() {},
      },
    ).route
  }
  assert.equal(route('auth', true).type, 'Auth')
  assert.equal(route('workspace', true).type, 'main')
  assert.equal(route('launcher', true).type, 'main')
  assert.equal(route('workspace', false).type, 'Workspace')
  assert.equal(route('launcher', false).type, 'Launcher')
})
