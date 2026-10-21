/* Benign owned fixtures / mocks only. No server, sockets, browser, hooks or helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { killTree, observeChild, createProcessRegistry } from './process-safety.mjs'
import { assertGitMetadata, validateGitConfig, gitInvocation } from './git-safety.mjs'
import { captureProcess } from './owned-process.mjs'
import { cdpClient, takeShot, webRoutes } from './web.mjs'
import { createPreview, PREVIEW_CSP } from './preview.mjs'
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-process-second-'))
test.after(() => fs.rm(fixture, { recursive: true, force: true }))
const child = () => {
  const c = new EventEmitter()
  c.pid = 12345
  c.kill = () => true
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.stdin = new EventEmitter()
  c.stdin.end = () => {}
  c.stdio = [null, null, null, new EventEmitter(), new EventEmitter()]
  c.stdio[3].write = (_text, cb) => {
    cb?.()
    return true
  }
  return c
}
const missing = () => Object.assign(new Error('gone'), { code: 'ESRCH' })

test('Windows nonzero taskkill triggers fallback but never reports tree stop', async () => {
  const c = observeChild(child())
  let fallbacks = 0,
    args
  c.kill = () => {
    fallbacks++
  }
  const r = await killTree(
    c,
    'SIGTERM',
    'win32',
    (_exe, a) => {
      args = a
      const t = new EventEmitter()
      t.unref = () => {}
      queueMicrotask(() => t.emit('exit', 1))
      return t
    },
    { deadline: 30 },
  )
  assert.deepEqual(args, ['/PID', '12345', '/T', '/F'])
  assert.equal(fallbacks, 1)
  assert.equal(r.stopped, false)
})
test('Windows success waits for root close, spawn error and hung taskkill fail closed', async () => {
  const c = observeChild(child())
  let task,
    resolved = false
  const promise = killTree(
    c,
    'SIGTERM',
    'win32',
    () => (task = Object.assign(new EventEmitter(), { unref() {} })),
    { deadline: 100 },
  ).then((r) => {
    resolved = true
    return r
  })
  task.emit('exit', 0)
  await Promise.resolve()
  assert.equal(resolved, false)
  c.emit('close', 0)
  assert.equal((await promise).stopped, true)
  let fallback = 0,
    helperKilled = 0
  for (const mode of ['error', 'hung']) {
    const d = observeChild(child())
    d.kill = () => {
      fallback++
    }
    const r = await killTree(
      d,
      'SIGTERM',
      'win32',
      () => {
        const t = Object.assign(new EventEmitter(), {
          unref() {},
          kill() {
            helperKilled++
          },
        })
        if (mode === 'error') queueMicrotask(() => t.emit('error', new Error('fixture')))
        return t
      },
      { deadline: 15 },
    )
    assert.equal(r.stopped, false)
  }
  assert.equal(fallback, 2)
  assert.equal(helperKilled, 1)
})
test('a closed Windows root is never retargeted by numeric PID after failed stop', async () => {
  const c = observeChild(child())
  c.emit('close', 0)
  let launches = 0,
    rootKills = 0
  c.kill = () => {
    rootKills++
  }
  const launch = () => {
    launches++
    const t = Object.assign(new EventEmitter(), { unref() {} })
    queueMicrotask(() => t.emit('exit', 1))
    return t
  }
  assert.equal((await killTree(c, 'SIGTERM', 'win32', launch, { deadline: 30 })).stopped, false)
  assert.equal((await killTree(c, 'SIGTERM', 'win32', launch, { deadline: 30 })).stopped, false)
  assert.equal(launches, 1)
  assert.equal(rootKills, 0)
})
test('POSIX ignored TERM escalates; group disappearance without close is not reap', async () => {
  const c = observeChild(child()),
    signals = []
  let gone = false
  const groupKill = (_pid, sig) => {
    if (sig === 0) {
      if (gone) throw missing()
      return
    }
    signals.push(sig)
    if (sig === 'SIGKILL') {
      gone = true
      c.emit('close', null)
    }
  }
  assert.equal(
    (await killTree(c, 'SIGTERM', 'linux', null, { groupKill, grace: 5, deadline: 100 })).stopped,
    true,
  )
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
  const d = observeChild(child())
  assert.equal(
    (
      await killTree(d, 'SIGTERM', 'linux', null, {
        groupKill() {
          throw missing()
        },
        grace: 2,
        deadline: 12,
      })
    ).stopped,
    false,
  )
})
test('live failed-stop ownership consumes capacity and retries on shutdown', async () => {
  let stops = 0,
    cleaned = 0,
    release
  const registry = createProcessRegistry({
    limit: 1,
    stop: () => {
      stops++
      return new Promise((r) => {
        release = r
      })
    },
  })
  const c = child(),
    owned = registry.own(c, 'fixture', () => {
      cleaned++
    })
  const a = owned.stop(),
    b = owned.stop()
  assert.equal(a, b)
  await Promise.resolve()
  release({ stopped: false })
  await a
  assert.equal(registry.entries.has(c), true)
  assert.equal(owned.orphan, true)
  assert.equal(cleaned, 0)
  assert.equal(registry.available(), false)
  assert.throws(() => registry.own(child()))
  const shutdown = registry.shutdown()
  await Promise.resolve()
  release({ stopped: true })
  await shutdown
  assert.equal(cleaned, 1)
  assert.equal(registry.entries.size, 0)
  await owned.stop()
  assert.equal(stops, 2)
  assert.equal(cleaned, 1)
  assert.equal(registry.available(), false)
})
test('more than 64 natural Windows root closes never exhaust live slots or fabricate tree reap', async () => {
  let stops = 0,
    cleaned = 0
  const registry = createProcessRegistry({
    limit: 4,
    historyLimit: 8,
    stop: async () => {
      stops++
      return { stopped: false, reason: 'native-tree-ownership-required' }
    },
  })
  for (let i = 0; i < 130; i++) {
    assert.equal(registry.available(), true)
    const c = child(),
      owned = registry.own(c, 'git', (state) => {
        assert.equal(state.treeStopped, false)
        assert.equal(state.rootClosed, true)
        cleaned++
      })
    c.emit('close', 0)
    assert.equal((await owned.stop()).stopped, false)
    assert.equal((await owned.stop()).stopped, false) // no later numeric-PID retry
    assert.equal(registry.entries.size, 0)
  }
  assert.equal(stops, 130)
  assert.equal(cleaned, 130)
  assert.equal(registry.closedRootObligations.total, 130)
  assert.equal(registry.closedRootObligations.git, 130)
  assert.equal(registry.recentClosed.length, 8)
  assert.equal(registry.available(), true)
  await registry.shutdown()
  assert.equal(stops, 130)
})
test('type-specific caps bound active browsers and Git without blocking other kinds', async () => {
  const registry = createProcessRegistry({
    limit: 8,
    kindLimits: { browser: 1, git: 2 },
    stop: async () => ({ stopped: true }),
  })
  registry.own(child(), 'browser')
  assert.equal(registry.available('browser'), false)
  assert.throws(() => registry.own(child(), 'browser'))
  assert.equal(registry.available('git'), true)
  registry.own(child(), 'git')
  registry.own(child(), 'git')
  assert.equal(registry.available('git'), false)
  assert.equal(registry.available('exec'), true)
  await registry.shutdown()
})
test('Git capture bounds output; deadline/abort cleanup and pre-abort never spawns', async () => {
  for (const mode of ['overflow', 'timeout', 'abort']) {
    let stopped = 0
    const c = child(),
      controller = new AbortController()
    const registry = createProcessRegistry({
      stop: async () => {
        stopped++
        return { stopped: false }
      },
    })
    const work = captureProcess('fixture-only', [], {
      registry,
      launch: () => {
        queueMicrotask(() => {
          if (mode === 'overflow') c.stdout.write('small fixture text')
          if (mode === 'abort') controller.abort()
        })
        return c
      },
      timeout: 15,
      maxBytes: 4,
      signal: controller.signal,
    })
    const r = await work
    assert.equal(r.code, -1)
    assert.equal(r.so.length, 0)
    assert.equal(stopped, 1)
    assert.equal(registry.entries.has(c), true)
  }
  const controller = new AbortController()
  controller.abort()
  const r = await captureProcess('unused', [], {
    signal: controller.signal,
    launch() {
      assert.fail('must not spawn')
    },
  })
  assert.equal(r.code, -1)
})
test('Git native invocation isolates ambient config and disables external interpretation', () => {
  validateGitConfig(
    '[core]\n repositoryformatversion = 0\n filemode = false\n bare = false\n logallrefupdates = true\n[user]\n name = "Fixture User"\n email = fixture@example.test\n[remote "origin"]\n url = https://example.test/team/project.git\n fetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n remote = origin\n merge = refs/heads/main\n',
  )
  // Unsupported sections/keys only; no command, external target or payload.
  for (const text of [
    '[include]\n',
    '[filter "fixture"]\n',
    '[core]\n worktree = fixture\n',
    '[core]\n fsmonitor = false\n',
    '[extensions]\n worktreeConfig = true\n',
  ])
    assert.throws(() => validateGitConfig(text))
  const i = gitInvocation(fixture, ['diff', '--', 'fixture.txt'])
  assert.equal(i.env.GIT_CONFIG_GLOBAL, os.devNull)
  assert.equal(i.env.GIT_CONFIG_NOSYSTEM, '1')
  for (const option of [
    'core.hooksPath=' + os.devNull,
    'credential.helper=',
    'protocol.allow=never',
    'submodule.recurse=false',
    '--no-ext-diff',
    '--no-textconv',
  ])
    assert.ok(i.args.includes(option), option)
  assert.ok(i.args.includes('--git-dir=' + path.join(fixture, '.git')))
})
test('Git metadata pointers rejected before contents are opened; normal owned repository allowed', async () => {
  const root = path.join(fixture, 'metadata')
  await fs.mkdir(path.join(root, '.git', 'objects', 'info'), { recursive: true })
  await fs.writeFile(
    path.join(root, '.git', 'config'),
    '[core]\n repositoryformatversion = 0\n bare = false\n',
  )
  await assertGitMetadata(root)
  for (const rel of [
    'commondir',
    'config.worktree',
    'objects/info/alternates',
    'objects/info/http-alternates',
    'info/grafts',
  ]) {
    const abs = path.join(root, '.git', rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, '') // benign empty sentinel, no target/payload
    await assert.rejects(assertGitMetadata(root))
    await fs.rm(abs)
  }
})
test('CDP frame, pending count and outgoing queue are bounded; errors reject waiters', async () => {
  for (const mode of ['frame', 'pending', 'queue', 'pipe']) {
    const c = child(),
      rpc = cdpClient(c, { maxFrame: 16, maxPending: mode === 'queue' ? 2 : 1, maxQueue: 128 })
    const first = rpc.send('fixture'),
      failed = assert.rejects(first)
    if (mode === 'frame') c.stdio[4].emit('data', Buffer.alloc(17))
    if (mode === 'pending') await assert.rejects(rpc.send('second'))
    if (mode === 'queue') {
      c.stdio[3].writableLength = 200
      await assert.rejects(rpc.send('queued'))
    }
    if (mode === 'pipe') c.stdio[3].emit('error', new Error('fixture diagnostic'))
    await failed
    await assert.rejects(rpc.send('after-close'))
    rpc.dispose()
  }
})
test('Browser timeout and abort await owned stop; no actual browser is launched', async () => {
  for (const mode of ['timeout', 'abort']) {
    const controller = new AbortController()
    let stops = 0,
      profile
    const registry = createProcessRegistry({
      stop: async () => {
        stops++
        return { stopped: true }
      },
    })
    await assert.rejects(
      takeShot('http://127.0.0.1/fixture', {
        timeout: 100,
        exe: 'mock-only',
        signal: controller.signal,
        registry,
        launch: (_exe, args) => {
          profile = args.find((x) => x.startsWith('--user-data-dir=')).slice('--user-data-dir='.length)
          if (mode === 'abort') queueMicrotask(() => controller.abort())
          return child()
        },
      }),
    )
    assert.equal(stops, 1)
    assert.equal(registry.entries.size, 0)
    await assert.rejects(fs.stat(path.dirname(profile)), { code: 'ENOENT' })
  }
})
test('web public response does not expose private diagnostic text', async () => {
  const req = Object.assign(new EventEmitter(), { method: 'POST' }),
    res = new EventEmitter()
  let reply
  await webRoutes(req, res, new URL('http://fixture/api/shot'), {
    readBody: async () => ({ url: 'private-fixture-invalid' }),
    json: (_r, code, body) => {
      reply = { code, body }
    },
  })
  assert.equal(reply.code, 502)
  assert.ok(reply.body.error.correlationId)
  assert.ok(!JSON.stringify(reply).includes('private-fixture-invalid'))
  assert.equal(reply.body.error.message, 'Не удалось выполнить веб-операцию')
})
test('default preview URL retains site base, asset works, revocation still denies', async () => {
  const root = path.join(fixture, 'preview')
  await fs.mkdir(path.join(root, 'site'), { recursive: true })
  await fs.writeFile(path.join(root, 'site/index.html'), '<p>Fixture</p>')
  await fs.writeFile(path.join(root, 'site/style.css'), 'body { color: navy }')
  let handler,
    valid = true
  const listener = Object.assign(new EventEmitter(), {
    listen(_port, _host, cb) {
      cb()
    },
    address: () => ({ port: 45678 }),
    unref() {},
    close() {},
  })
  const preview = createPreview({
    sessionValid: () => valid,
    createServer: (h) => {
      handler = h
      return listener
    },
  })
  const head = (url) =>
    new Promise((resolve) => {
      const res = {
        writeHead(code, headers) {
          this.code = code
          this.headers = headers
        },
        end() {
          resolve(this)
        },
        destroy() {
          resolve(this)
        },
      }
      handler(
        {
          method: 'HEAD',
          url: new URL(url).pathname,
          headers: { host: '127.0.0.1:45678' },
          socket: { remoteAddress: '127.0.0.1' },
        },
        res,
      )
    })
  try {
    const cap = await preview.issue(root, 'fixture-session')
    assert.ok(new URL(cap.url).pathname.endsWith('/site/index.html'))
    assert.equal((await head(cap.url)).code, 200)
    assert.equal((await head(new URL('style.css', cap.url))).code, 200)
    assert.ok(!PREVIEW_CSP.includes('allow-same-origin'))
    valid = false
    assert.equal((await head(cap.url)).code, 401)
  } finally {
    preview.close()
  }
})
test('server integration retains ownership and never fabricates completion on cancellation timer', async () => {
  const source = await fs.readFile(new URL('./tetra-server.mjs', import.meta.url), 'utf8')
  assert.ok(!source.includes('void finish(130)'))
  assert.ok(source.includes('treeStopped: tree.stopped'))
  assert.ok(source.includes('const tree = await owned.stop()'))
  assert.ok(source.includes('serverProcesses.shutdown()'))
  const httpSource = await fs.readFile(new URL('./http-request.mjs', import.meta.url), 'utf8')
  // The request scope moved, not the cancellation/ownership guarantee.
  assert.match(source, /import\s*\{[^}]*\brunRequest\b[^}]*\}\s*from ['"]\.\/http-request\.mjs['"]/)
  assert.match(source, /return runRequest\(req, res, \(\) => handle\(req, res, access\.isLocal\), next\)/)
  assert.match(httpSource, /requestScope\s*\.run\(controller\.signal/)
  const { runRequest, requestScope } = await import('./http-request.mjs')
  const req = new EventEmitter()
  req.complete = true
  const res = new EventEmitter()
  const observed = []
  let handled = 0,
    nextCalls = 0
  await runRequest(
    req,
    res,
    async () => {
      handled++
      observed.push(requestScope.getStore())
      await Promise.resolve()
      observed.push(requestScope.getStore())
      // An exec/SSE handler returns before the owned response/process finishes.
    },
    () => {
      nextCalls++
    },
  )
  assert.equal(handled, 1)
  assert.equal(nextCalls, 0)
  assert.ok(observed[0] instanceof AbortSignal)
  assert.equal(observed[1], observed[0])
  assert.equal(observed[0].aborted, false)
  req.emit('close') // completed upload is not process cancellation
  assert.equal(observed[0].aborted, false)
  res.emit('close') // unfinished response must still cancel after handler return
  assert.equal(observed[0].aborted, true)
  assert.equal(req.listenerCount('aborted'), 0)
  assert.equal(res.listenerCount('close'), 0)
  assert.ok(source.includes("serverProcesses.own(child, 'exec'"))
  assert.ok(!source.includes('String(e?.message || e)'))
})
