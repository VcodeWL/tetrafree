/* Component harness: actual engine/Turn/autorun/backend, mocked store/provider/tools.
   No process is spawned, no filesystem outside the temporary test bundle is modified. */
import { build } from 'esbuild'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export const tick = () => new Promise<void>((r) => setImmediate(r))
export async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'tetrafree-agent-unit-'))
  const root = resolve('src')
  const mock: Record<string, string> = {
    [join(root, 'store')]:
      `export const useStore = { getState: () => globalThis.__agentHarness.state, subscribe: (fn) => globalThis.__agentHarness.subscribe(fn) };
      export const getChat = (pid,id) => useStore.getState().projects.find(p=>p.id===pid)?.chats.find(c=>c.id===id);
      export const toast = (...args) => globalThis.__agentHarness.toasts.push(args);`,
    [join(root, 'agent/llm')]: `export const streamChat = (o) => globalThis.__agentHarness.stream(o);`,
    [join(root, 'agent/prompt')]:
      `export const systemPrompt = () => 'unit system'; export const history = (msgs,exclude) => msgs.filter(m=>m.id!==exclude && m.kind==='human').map(m=>({role:'user',content:m.text}));`,
    [join(root, 'agent/ci')]: `export const fireTrigger = () => {};`,
    [join(root, 'agent/loop')]:
      `export const loopStop = () => {}; export const loopPassEnded = () => {}; export const setLoopRunner = () => {};`,
    [join(root, 'lib/osnotify')]:
      `export const osNotify = (...args) => globalThis.__agentHarness.notices?.push(args);`,
    [join(root, 'lib/gitctx')]:
      `export const wantsGit = () => false; export const gitContext = async () => '';`,
    [join(root, 'lib/mcp')]:
      `export const loadMcp = async () => globalThis.__agentHarness.bootstrap?.() ?? ({tools:{},notes:{}}); export const mcpSection = () => '';`,
    [join(root, 'agent/mcptool')]:
      `export const mcpAction = (...args) => globalThis.__agentHarness.mcp(...args);`,
    [join(root, 'agent/webtools')]:
      `export const webFetchTool = (...args) => globalThis.__agentHarness.web(...args); export const webSearchTool = webFetchTool; export const takeShotTool = webFetchTool;`,
  }
  try {
    const outfile = join(dir, 'unit.mjs')
    await build({
      stdin: {
        contents: `export {live,useLive} from './src/agent/live'; export * from './src/agent/automationControl'; export * from './src/agent/automationJournal'; export * from './src/agent/engine'; export {Turn} from './src/agent/turn'; export * from './src/agent/queue'; export * from './src/agent/autorun'; export * from './src/agent/automations'; export * from './src/lib/backend'; export {setToken} from './src/lib/token';`,
        resolveDir: resolve('.'),
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      plugins: [
        {
          name: 'agent-unit-mocks',
          setup(b) {
            b.onResolve({ filter: /^\./ }, (a) => {
              const path = resolve(a.resolveDir, a.path).replace(/\.ts$/, '')
              if (mock[path]) return { path, namespace: 'unit-mock' }
            })
            b.onLoad({ filter: /.*/, namespace: 'unit-mock' }, (a) => ({
              contents: mock[a.path],
              loader: 'js',
            }))
            b.onLoad({ filter: /\/agent\/engine\.ts$/ }, async (a) => ({
              contents:
                (await readFile(a.path, 'utf8')) +
                '\nexport {runTurn, syncSegs, verifyCommand, refreshTurn};',
              loader: 'ts',
            }))
          },
        },
      ],
    })
    // External zustand/react resolve relative to a repository-local import URL.
    const local = join(resolve('src/agent/test-helpers'), `.unit-${process.pid}-${Date.now()}.mjs`)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(local, await readFile(outfile))
    try {
      return await import(pathToFileURL(local).href)
    } finally {
      await rm(local, { force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
