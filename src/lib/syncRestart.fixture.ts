/** Child-process fixture: real modules get fresh caches and hydrate the last committed app snapshot. No real IO/network. */
import type { TeamMeta } from './teamMetadata'
const input = JSON.parse(process.env.SYNC_RESTART_INPUT!) as {
  retries?: number
  runtimeHuman?: { path: string; text: string; desc?: string }
  kind: 'cloud' | 'disk'
  storage: [string, string][]
  durable: string
  server: { files: Record<string, string>; meta?: TeamMeta; dirs: string[]; rev: number }
}
const values = new Map(input.storage)
values.set('tetrafree', input.durable)
values.set(
  'tetrafree:authority',
  JSON.stringify({ backend: 'ls', revision: JSON.parse(input.durable).revision }),
)
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    },
    removeItem: (k: string) => {
      values.delete(k)
    },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size
    },
  },
})
async function run() {
  const store = await import('../store')
  await store.hydrateStore()
  const backend = await import('./backend'),
    { setToken } = await import('./token'),
    persistence = await import('../store/persistence')
  const { useAccount } = await import('./account')
  setToken('test-only-token')
  backend.useBackend.setState({
    status: 'online',
    base: input.kind === 'cloud' ? 'http://cloud.invalid' : 'http://sync.invalid',
    info: { local: true } as never,
  })
  useAccount.setState({ user: { id: 'uid', name: 'tester' } as never })
  persistence.registerPersistenceCheckpoint(async () => {})
  const p = store.useStore.getState().projects[0]
  if (input.runtimeHuman)
    store.useStore.getState().up((x) => {
      x.files[input.runtimeHuman!.path] = input.runtimeHuman!.text
      if (input.runtimeHuman!.desc !== undefined) x.desc = input.runtimeHuman!.desc
    }, p.id)
  let puts = 0,
    batches = 0
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = async (url, options) => {
    if (input.kind === 'cloud') {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body))
        input.server = { ...input.server, ...body, rev: input.server.rev + 1 }
        puts++
        return json({ rev: input.server.rev })
      }
      const since = Number(new URL(String(url)).searchParams.get('since'))
      return since === input.server.rev ? json({ same: true, rev: since }) : json(input.server)
    }
    if (String(url).includes('/hashes'))
      return json({
        dir: p.path,
        hashes: Object.fromEntries(Object.entries(input.server.files).map(([k, v]) => [k, backend.fnv(v)])),
      })
    const body = JSON.parse(String(options?.body))
    if (String(url).endsWith('/read'))
      return json({
        files: Object.fromEntries(body.paths.map((k: string) => [k, input.server.files[k] ?? null])),
      })
    if (String(url).endsWith('/batch')) {
      Object.assign(input.server.files, body.write)
      for (const k of body.remove) delete input.server.files[k]
      batches++
      return json({ dir: p.path, failed: [] })
    }
    throw new Error('Unexpected mock route ' + url)
  }
  for (let i = 0; i < (input.retries || 1); i++) {
    if (input.kind === 'cloud') await (await import('./team')).cloudNow(p.id)
    else {
      const sync = await import('./sync')
      await sync.reconcile(p.id)
      sync.stopSync()
    }
  }
  const local = store.useStore.getState().projects[0]
  console.log(
    JSON.stringify({
      files: local.files,
      desc: local.desc,
      dirs: local.dirs,
      server: input.server,
      puts,
      batches,
      warnings: store.useStore.getState().toasts.filter((t) => t.tone === 'warn').length,
    }),
  )
}
run().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
