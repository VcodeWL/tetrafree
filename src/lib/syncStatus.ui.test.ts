/** Controlled component/hook fixture executing real TSX; not browser/React DOM or native UX certification. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
interface Node {
  type: unknown
  props: Record<string, unknown>
}
function text(value: unknown): string {
  if (value == null || typeof value === 'boolean') return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(text).join(' ')
  return text((value as Node).props?.children)
}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return [node, ...nodes(node.props?.children)]
}
function fixture(file: string, name: string, health: Record<string, unknown>) {
  const state = {
    screen: 'workspace',
    projectId: 'active',
    projects: [{ id: 'active', openedAt: 1, path: 'C:/PRIVATE_PATH' }],
    settings: { budget: 0 },
    openModal() {},
  }
  const backend = {
    base: 'https://benign.invalid',
    status: 'online',
    info: { local: true },
    lastSync: Date.now(),
    lastError: 'PRIVATE_OTHER_PROJECT_ERROR',
    syncing: false,
  }
  let cursor = 0
  const slots: unknown[] = []
  const effects: (() => unknown)[] = []
  const react = {
    useState(initial: unknown) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (value: unknown) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        },
      ]
    },
    useRef(initial: unknown) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const i = cursor++,
        old = slots[i] as unknown[] | undefined
      if (!old || deps.some((v, n) => v !== old[n])) {
        slots[i] = deps
        effects.push(effect)
      }
    },
  }
  const useStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  })
  const make = (type: unknown, props: Record<string, unknown>) => ({ type, props })
  const imports: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx: make, jsxs: make, Fragment: 'fragment' },
    'framer-motion': { AnimatePresence: 'presence', motion: { div: 'motion-div' } },
    '../store': { useStore },
    '../lib/backend': {
      useBackend: Object.assign(() => backend, { getState: () => backend }),
      backendOnline: () => true,
      captureBackendContextRevision: () => 1,
    },
    '../lib/account': { useAccount: () => ({ user: null }) },
    '../lib/token': { getTokenRevision: () => 1 },
    '../lib/sync': { reconcile: async () => null, retryProjectSync: async () => null },
    '../lib/syncStatus': {
      captureSyncHealth: () => health,
      useSyncStatus: () => ({ revision: 0 }),
      syncHealthLabel: (h: Record<string, unknown>) => ({
        c: h.disk === 'checking' ? 'sync' : 'off',
        text: h.disk === 'checking' ? 'Сверяю с диском…' : 'Диск ещё не проверен',
        detail: 'Checkpoint не подтверждён; диск не проверен',
      }),
    },
    '../lib/util': {
      ago: () => 'только что',
      sleep: () => new Promise(() => {}),
      nFiles: (n: number) => String(n),
    },
    '../lib/git': { useGit: () => ({ pid: 'other', status: null }) },
    '../lib/editstate': { useEdit: () => ({ pid: 'other', pending: true, savedAt: Date.now() }) },
    '../lib/usage': { report: () => ({ month: { cost: 0 } }), fmtUsd: () => '' },
    './ui/Icon': { Icon: 'icon' },
    '../components/ui/Icon': { Icon: 'icon' },
    '../components/ui/primitives': { Logo: 'logo' },
  }
  const root = process.env.SYNC_UI_SOURCE_ROOT || process.cwd()
  const source = readFileSync(path.join(root, file), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const mod = { exports: {} as Record<string, () => Node> }
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', code)(
    (id: string) => {
      assert.ok(id in imports, 'unknown import ' + id)
      return imports[id]
    },
    mod,
    mod.exports,
    () => 0,
    () => {},
  )
  return {
    render() {
      cursor = 0
      return mod.exports[name]()
    },
    async effects() {
      effects.splice(0).forEach((effect) => effect())
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}
test('desired UI: StatusBar never uses another project global lastSync/error as active disk proof', async () => {
  const app = fixture('src/components/StatusBar.tsx', 'StatusBar', {
    disk: 'unchecked',
    checkpoint: 'unconfirmed',
    canRetry: true,
  })
  const view = app.render()
  assert.doesNotMatch(text(view), /синхронизировано|ошибка синхронизации/i)
  assert.match(text(view), /Диск ещё не проверен/)
  assert.doesNotMatch(text(view), /Изменения…|В проекте /)
  assert.match(text(view), /checkpoint не подтверждён/i)
  assert.ok(!nodes(view).some((node) => String(node.props.title).includes('PRIVATE_OTHER_PROJECT_ERROR')))
})
test('desired UI: Boot busy reconcile is normal background state, not warning', async () => {
  const app = fixture('src/screens/Boot.tsx', 'Boot', {
    disk: 'checking',
    checkpoint: 'unconfirmed',
    canRetry: false,
  })
  app.render()
  await app.effects()
  const view = app.render()
  const li = nodes(view).find((node) => node.type === 'li')
  assert.equal(li?.props.className, 'run')
  assert.match(text(view), /Проверка уже идёт в фоне/)
  assert.doesNotMatch(text(view), /PRIVATE_OTHER_PROJECT_ERROR/)
})

test('desired UI: another project editor pending/saved state is hidden', () => {
  const app = fixture('src/components/StatusBar.tsx', 'StatusBar', {
    disk: 'unchecked',
    checkpoint: 'unconfirmed',
    canRetry: true,
  })
  assert.doesNotMatch(text(app.render()), /Изменения…|В проекте /)
})
