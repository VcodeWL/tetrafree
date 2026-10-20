/* Executes the actual frontend delegates plus actual createCheckpointHandler.
 * Tauri/Win32 boundary below is CONTROLLED NATIVE EMULATION, not native/GUI
 * evidence: it emulates prevent-close, final post-download checkpoint and ACK. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createCheckpointHandler } from './desktopLifecycle'

function fixture(flush: () => Promise<void>, download: () => Promise<void> = async () => {}) {
  const events: string[] = []
  let closed = false,
    nativeWarningVisible = false
  let completion: Promise<void> | undefined
  let pendingToken: string | null = null
  let saved = false
  let sequence = 0
  const handler = createCheckpointHandler({
    flush: async () => {
      events.push('flush-start')
      await flush()
      events.push('flush-durable')
    },
    ack: async (token, success) => {
      assert.equal(token, pendingToken, 'mock native boundary accepts only its current token')
      events.push(success ? 'ack-true' : 'ack-false')
      saved = success
      return true
    },
    warn: () => events.push('frontend-warning'),
  })
  const checkpoint = async (reason: 'quit' | 'update') => {
    pendingToken = (++sequence).toString(16).padStart(64, '0')
    saved = false
    events.push('checkpoint-request')
    await handler({ token: pendingToken, reason, timeoutMs: 1000 })
    pendingToken = null
    if (!saved) {
      nativeWarningVisible = true
      events.push('native-warning')
    }
    return saved
  }
  const nativeClose = async () => {
    events.push('native-close-prevented')
    if (await checkpoint('quit')) {
      closed = true
      events.push('window-close')
    }
  }
  const nativeUpdate = async () => {
    events.push('download-start')
    await download()
    events.push('download-complete')
    if (!(await checkpoint('update'))) throw new Error('native checkpoint rejected')
    events.push('server-stop', 'installer-dispatch')
  }
  const imports: Record<string, unknown> = {
    '@tauri-apps/api/window': {
      getCurrentWindow: () => ({
        close: async () => {
          events.push('close-request')
          completion = nativeClose()
          // Real frontend close-request delivery is NOT final window termination.
        },
      }),
    },
    '@tauri-apps/api/core': {
      invoke: (name: string) => {
        assert.equal(name, 'update_install')
        events.push('update-request')
        completion = nativeUpdate()
        return completion
      },
    },
  }
  const source = readFileSync(new URL('./desktop.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} as { winClose: () => Promise<void>; updInstall: () => Promise<void> } }
  new Function('require', 'module', 'exports', 'window', code)(
    (name: string) => {
      assert.ok(name in imports, `unexpected delegate import: ${name}`)
      return imports[name]
    },
    mod,
    mod.exports,
    { __TAURI_INTERNALS__: {} },
  )
  return {
    ...mod.exports,
    events,
    get closed() {
      return closed
    },
    get nativeWarningVisible() {
      return nativeWarningVisible
    },
    settled: async () => {
      assert.ok(completion, 'delegate must reach mock native boundary')
      await completion
    },
  }
}

test('frontend close delegate + mock native gate wait for actual checkpoint handler before termination', async () => {
  let done!: () => void
  const f = fixture(
    () =>
      new Promise<void>((resolve) => {
        done = resolve
      }),
  )
  await f.winClose()
  assert.deepEqual(f.events, ['close-request', 'native-close-prevented', 'checkpoint-request', 'flush-start'])
  assert.equal(f.closed, false, 'delivery of close request cannot authorize termination')
  assert.equal(f.nativeWarningVisible, false)
  done()
  await f.settled()
  assert.deepEqual(f.events, [
    'close-request',
    'native-close-prevented',
    'checkpoint-request',
    'flush-start',
    'flush-durable',
    'ack-true',
    'window-close',
  ])
  assert.equal(f.closed, true)
})
test('failed actual checkpoint handler leaves mock native window open and requests warnings', async () => {
  const f = fixture(async () => {
    throw new Error('synthetic quota at persistence boundary')
  })
  await f.winClose()
  await f.settled()
  assert.equal(f.closed, false)
  assert.equal(f.nativeWarningVisible, true, 'native warning request recorded, not a real OS dialog test')
  assert.deepEqual(f.events, [
    'close-request',
    'native-close-prevented',
    'checkpoint-request',
    'flush-start',
    'ack-false',
    'frontend-warning',
    'native-warning',
  ])
  assert.ok(!f.events.includes('window-close'))
})
test('frontend update delegate + mock native gate checkpoint AFTER download and before stop/install', async () => {
  let downloaded!: () => void, durable!: () => void
  let current = 'before download',
    persisted = ''
  const f = fixture(
    () =>
      new Promise<void>((resolve) => {
        persisted = current
        durable = resolve
      }),
    () =>
      new Promise<void>((resolve) => {
        downloaded = resolve
      }),
  )
  const install = f.updInstall()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.events, ['update-request', 'download-start'])
  current = 'edit while downloading'
  downloaded()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    persisted,
    'edit while downloading',
    'final checkpoint must include edits made during download',
  )
  assert.deepEqual(f.events, [
    'update-request',
    'download-start',
    'download-complete',
    'checkpoint-request',
    'flush-start',
  ])
  assert.ok(!f.events.includes('server-stop'))
  assert.ok(!f.events.includes('installer-dispatch'))
  durable()
  await install
  assert.deepEqual(f.events, [
    'update-request',
    'download-start',
    'download-complete',
    'checkpoint-request',
    'flush-start',
    'flush-durable',
    'ack-true',
    'server-stop',
    'installer-dispatch',
  ])
})
test('failed actual handler rejects update at mock native boundary without stopping backend/installing', async () => {
  const f = fixture(async () => {
    throw new Error('synthetic quota at persistence boundary')
  })
  await assert.rejects(f.updInstall(), /native checkpoint rejected/)
  assert.deepEqual(f.events, [
    'update-request',
    'download-start',
    'download-complete',
    'checkpoint-request',
    'flush-start',
    'ack-false',
    'frontend-warning',
    'native-warning',
  ])
  assert.equal(f.closed, false)
  assert.equal(f.nativeWarningVisible, true)
  assert.ok(!f.events.includes('server-stop'))
  assert.ok(!f.events.includes('installer-dispatch'))
})
