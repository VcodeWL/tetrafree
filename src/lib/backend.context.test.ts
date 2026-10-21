/** Benign in-memory fetch boundary; no real server, shell or external traffic. */
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { bRead, bHashes, bExec, backendFetch, detectBackend, setBackendUrl, useBackend } from './backend'
import { setToken } from './token'
const originalFetch = globalThis.fetch
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } })
const online = (base = 'https://old.invalid') => {
  setToken('benign-old-token')
  useBackend.setState({ base, status: 'online', info: { local: true } as never })
}
const health = () => new Response(JSON.stringify({ ok: true, local: true, platform: 'linux' }))
const p = { id: 'benign', name: 'benign' }
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
})

test('desired: overlapping explicit backend selections cannot publish stale success', async () => {
  let first!: (response: Response) => void
  globalThis.fetch = async (url) =>
    String(url).includes('first.invalid')
      ? new Promise<Response>((resolve) => {
          first = resolve
        })
      : health()
  setBackendUrl('https://first.invalid')
  setBackendUrl('https://second.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(useBackend.getState().base, 'https://second.invalid')
  first(health())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(useBackend.getState().base, 'https://second.invalid')
})

test('desired: overlapping detection failure cannot overwrite a newer online result', async () => {
  let first!: (response: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      first = resolve
    })
  const stale = detectBackend()
  globalThis.fetch = async () => health()
  await detectBackend()
  first(new Response('{}', { status: 503 }))
  await stale
  assert.equal(useBackend.getState().status, 'online')
})

for (const switchKind of ['backend', 'token'] as const) {
  test(`desired: POST JSON consumed after ${switchKind} switch is rejected`, async () => {
    online()
    let parse!: (body: unknown) => void
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            parse = resolve
          }),
      }) as Response
    const result = bRead(p, ['note'])
    const check = assert.rejects(result, /контекст/i)
    await new Promise((resolve) => setImmediate(resolve))
    if (switchKind === 'backend') useBackend.setState({ base: 'https://new.invalid' })
    else setToken('benign-new-token')
    parse({ files: { note: 'old response' } })
    await check
  })
}

test('desired: hash GET consumed after backend switch is rejected', async () => {
  online()
  let parse!: (body: unknown) => void
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          parse = resolve
        }),
    }) as Response
  const result = bHashes(p)
  const check = assert.rejects(result, /контекст/i)
  await new Promise((resolve) => setImmediate(resolve))
  useBackend.setState({ base: 'https://new.invalid' })
  parse({ hashes: {} })
  await check
})

test('desired: proxy transport failure after context switch never falls back to direct API', async () => {
  online()
  const calls: string[] = []
  let fail!: (error: Error) => void
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (calls.length > 1) return new Response('{}')
    return new Promise<Response>((_, reject) => {
      fail = reject
    })
  }
  const result = backendFetch('https://example.invalid/model', { headers: {} })
  const check = assert.rejects(result, /контекст/i)
  useBackend.setState({ base: 'https://new.invalid' })
  fail(new Error('benign disconnect'))
  await check
  assert.equal(calls.length, 1)
})

test('desired: stale exec stream emits no output and cleanup targets original server/token', async () => {
  online()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const calls: { url: string; token: string | null }[] = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), token: new Headers(options?.headers).get('authorization') })
    if (String(url).endsWith('/kill')) return new Response('{}')
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller
        },
      }),
    )
  }
  const output: string[] = []
  const result = bExec(p, 'echo benign', { onOut: (text) => output.push(text) })
  const check = assert.rejects(result, /контекст/i)
  await new Promise((resolve) => setImmediate(resolve))
  useBackend.setState({ base: 'https://new.invalid' })
  setToken('benign-new-token')
  stream.enqueue(new TextEncoder().encode('{"t":"o","d":"stale"}\n{"t":"x","code":0}\n'))
  stream.close()
  await check
  assert.deepEqual(output, [])
  assert.ok(
    calls.some(
      (call) => call.url === 'https://old.invalid/api/exec/kill' && call.token === 'Bearer benign-old-token',
    ),
  )
  assert.ok(!calls.some((call) => call.url.includes('new.invalid')))
})

for (const switchKind of ['backend ABA', 'token ABA'] as const) {
  test(`desired: ${switchKind} cannot resurrect pending POST authority`, async () => {
    online()
    let parse!: (body: unknown) => void
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            parse = resolve
          }),
      }) as Response
    const result = bRead(p, ['note'])
    const check = assert.rejects(result, /контекст/i)
    await new Promise((resolve) => setImmediate(resolve))
    if (switchKind === 'backend ABA') {
      useBackend.setState({ base: 'https://temporary.invalid' })
      useBackend.setState({ base: 'https://old.invalid' })
    } else {
      setToken('benign-temp')
      setToken('benign-old-token')
    }
    parse({ files: { note: 'old' } })
    await check
  })
}

test('explicit selection invalidates requests even while backend status is already checking', async () => {
  online()
  const healthReplies: ((r: Response) => void)[] = []
  let parse!: (body: unknown) => void
  globalThis.fetch = async (url) =>
    String(url).endsWith('/api/health')
      ? new Promise<Response>((resolve) => {
          healthReplies.push(resolve)
        })
      : ({
          ok: true,
          json: () =>
            new Promise((resolve) => {
              parse = resolve
            }),
        } as Response)
  setBackendUrl('https://selection-one.invalid')
  const result = bRead(p, ['note'])
  const check = assert.rejects(result, /контекст/i)
  await new Promise((resolve) => setImmediate(resolve))
  setBackendUrl('https://selection-two.invalid')
  parse({ files: { note: 'stale' } })
  healthReplies.forEach((reply) => reply(health()))
  await check
})
