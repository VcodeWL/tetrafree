import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { bExec, bBatch } from './backend'
const originalFetch = globalThis.fetch
after(() => {
  globalThis.fetch = originalFetch
})
const p = { id: 'unit', name: 'unit' }
const output = (text: string) => new Response(text, { status: 200 })

test('A04 pre-aborted bExec sends no POST', async () => {
  const ctl = new AbortController()
  ctl.abort()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return output('')
  }
  await assert.rejects(bExec(p, 'echo hello', { signal: ctl.signal, onOut() {} }), { name: 'AbortError' })
  assert.equal(calls, 0)
})
test('A04 cancellation during pending launch sends kill and aborts transport', async () => {
  const ctl = new AbortController()
  const calls: string[] = []
  let resolve!: (r: Response) => void
  let signal: AbortSignal | undefined
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    if (String(url).endsWith('/kill')) return output('{"ok":true}')
    signal = init?.signal as AbortSignal
    return new Promise<Response>((r) => {
      resolve = r
    })
  }
  const pending = bExec(p, 'echo hello', { signal: ctl.signal, onOut() {} })
  ctl.abort()
  assert.equal(signal?.aborted, true)
  resolve(output('{"t":"x","code":0}\n'))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(calls.some((s) => s.endsWith('/kill')))
})
test('A04 cancellation while awaiting a stream read rejects rather than hanging', async () => {
  const ctl = new AbortController()
  let cancel = 0
  globalThis.fetch = async (url) =>
    String(url).endsWith('/kill')
      ? output('{"ok":true}')
      : new Response(
          new ReadableStream({
            cancel() {
              cancel++
            },
          }),
        )
  const pending = bExec(p, 'echo hello', { signal: ctl.signal, onOut() {} })
  await new Promise((r) => setImmediate(r))
  ctl.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancel, 1)
})
test('A16 output-only EOF is unknown result, never code zero', async () => {
  globalThis.fetch = async (url) =>
    String(url).endsWith('/kill') ? output('{"ok":true}') : output('{"t":"e","d":"unit diagnostic"}\n')
  await assert.rejects(bExec(p, 'echo hello', { onOut() {} }), /не подтверждено/)
})
test('A16 final decoder flush and unnewline-terminated exit frame are parsed', async () => {
  const text: string[] = []
  globalThis.fetch = async () => output('{"t":"o","d":"Привет"}\n{"t":"x","code":3,"cwd":"src"}')
  assert.deepEqual(await bExec(p, 'echo hello', { onOut: (s) => text.push(s) }), { code: 3, cwd: 'src' })
  assert.deepEqual(text, ['Привет'])
})
for (const source of [
  '{"t":"x","code":"0"}\n',
  '{"t":"unknown"}\n',
  '{unfinished',
  '{"t":"x","code":0}\n{"t":"o","d":"late"}\n',
]) {
  test('A16 invalid or out-of-order NDJSON is a transport error: ' + source.slice(0, 24), async () => {
    globalThis.fetch = async (url) => (String(url).endsWith('/kill') ? output('{"ok":true}') : output(source))
    await assert.rejects(bExec(p, 'echo hello', { onOut() {} }))
  })
}
test('bBatch preserves existing body and forwards fifth optional expectedHashes', async () => {
  let body: Record<string, unknown> = {}
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return output('{"dir":"unit"}')
  }
  await bBatch(
    p,
    { 'a.txt': 'hello' },
    ['b.txt'],
    { make: ['folder'] },
    { 'a.txt': null, 'b.txt': 'expected' },
  )
  assert.deepEqual(body.expectedHashes, { 'a.txt': null, 'b.txt': 'expected' })
  assert.deepEqual(body.write, { 'a.txt': 'hello' })
  assert.deepEqual(body.remove, ['b.txt'])
  assert.deepEqual(body.mkdirs, ['folder'])
})

test('transport timeout is distinct from confirmed process exit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/kill')) return output('{"ok":true}')
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('unit canceled transport', 'AbortError')),
        { once: true },
      )
    })
  }
  const pending = bExec(p, 'echo hello', { onOut() {}, timeout: 1 })
  const check = assert.rejects(pending, /таймаут/)
  t.mock.timers.tick(6001)
  await check
})

test('confirmed zero process exit succeeds even without output', async () => {
  globalThis.fetch = async () => output('{"t":"x","code":0}\n')
  assert.deepEqual(await bExec(p, 'echo hello', { onOut() {} }), { code: 0, cwd: '' })
})

test('UTF-8 frame data can span transport chunks', async () => {
  const bytes = new TextEncoder().encode('{"t":"o","d":"Привет"}\n{"t":"x","code":0}\n')
  const split = bytes.indexOf(0xd0) + 1
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, split))
          controller.enqueue(bytes.slice(split))
          controller.close()
        },
      }),
    )
  let text = ''
  const result = await bExec(p, 'echo hello', {
    onOut(s) {
      text += s
    },
  })
  assert.equal(result.code, 0)
  assert.equal(text, 'Привет')
})
