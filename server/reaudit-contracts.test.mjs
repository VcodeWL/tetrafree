/* Portable desired-behavior regressions from the independent R02/R06 audit.
   Only fake processes/listeners and our own temporary files: no real spawn,
   taskkill, listen, network, account operations or Windows runtime claims. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { killTree } from './process-safety.mjs'
import { createPreview } from './preview.mjs'

const turn = () => new Promise((resolve) => setImmediate(resolve))

test('R02: a failed taskkill exit must not silently abandon cancellation', { timeout: 5000 }, async () => {
  const child = new EventEmitter()
  const attempts = []
  let fallbackCalls = 0
  Object.assign(child, {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    kill(signal = 'SIGTERM') {
      fallbackCalls++
      child.signalCode = signal
      queueMicrotask(() => {
        child.emit('exit', null, signal)
        child.emit('close', null, signal)
      })
      return true
    },
  })
  const launch = (exe, args, options) => {
    attempts.push({ exe, args, options })
    const task = new EventEmitter()
    Object.assign(task, {
      pid: 23456,
      exitCode: null,
      signalCode: null,
      unref() {},
      kill() {
        return true
      },
    })
    // Successful spawn but unsuccessful command; deliberately NOT a spawn error.
    setImmediate(() => {
      task.exitCode = 1
      task.emit('exit', 1, null)
      task.emit('close', 1, null)
    })
    return task
  }

  await killTree(child, 'SIGTERM', 'win32', launch)
  await turn()
  await turn()
  assert.equal(attempts.length, 1, 'the initial tree cancellation must use the injected launcher')
  assert.equal(path.win32.basename(attempts[0].exe).toLowerCase(), 'taskkill.exe')
  assert.deepEqual(attempts[0].args, ['/PID', String(child.pid), '/T', '/F'])
  assert.equal(attempts[0].options.windowsHide, true)
  assert.equal(
    fallbackCalls,
    1,
    'nonzero taskkill exit must trigger fallback exactly once, including when both exit and close fire',
  )
})

function previewHarness() {
  let handler
  let listens = 0
  const server = new EventEmitter()
  Object.assign(server, {
    address: () => ({ port: 45678 }),
    listen(port, host, ready) {
      assert.equal(port, 0)
      assert.equal(host, '127.0.0.1')
      listens++
      queueMicrotask(ready)
      return server
    },
    unref() {},
    close(done) {
      done?.()
      return server
    },
    closeAllConnections() {},
  })
  const preview = createPreview({
    sessionValid: (sid) => sid === 'reaudit-synthetic-session',
    createServer: (serve) => {
      handler = serve
      return server
    },
  })
  const head = (url) =>
    new Promise((resolve, reject) => {
      const target = new URL(url)
      const req = new EventEmitter()
      Object.assign(req, {
        method: 'HEAD',
        url: target.pathname + target.search,
        headers: { host: target.host },
        socket: { remoteAddress: '127.0.0.1' },
      })
      const res = new EventEmitter()
      Object.assign(res, {
        status: undefined,
        headers: {},
        headersSent: false,
        writeHead(status, headers = {}) {
          res.status = status
          res.headers = Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
          )
          res.headersSent = true
          return res
        },
        end() {
          resolve({ status: res.status, headers: res.headers, url: target.href })
        },
        destroy(error) {
          reject(error || new Error('fake preview response unexpectedly destroyed'))
        },
      })
      try {
        Promise.resolve(handler(req, res)).catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  const document = async (url) => {
    const original = new URL(url)
    for (let hops = 0; hops <= 4; hops++) {
      const response = await head(url)
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      assert.ok(response.headers.location, 'a preview redirect needs a Location')
      const next = new URL(response.headers.location, url)
      assert.equal(next.origin, original.origin, 'canonicalization must retain isolated preview origin')
      assert.equal(
        next.pathname.split('/')[2],
        original.pathname.split('/')[2],
        'canonicalization must retain its capability',
      )
      url = next.href
    }
    assert.fail('preview canonicalization exceeded four redirects')
  }
  return {
    preview,
    head,
    document,
    get listens() {
      return listens
    },
  }
}

test(
  'R06: default site entrypoint must preserve the base for relative assets',
  { timeout: 5000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-reaudit-contracts-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    await fs.mkdir(path.join(root, 'site'))
    await fs.writeFile(
      path.join(root, 'site', 'index.html'),
      '<!doctype html><link rel="stylesheet" href="style.css"><p>Benign fixture</p>',
    )
    await fs.writeFile(path.join(root, 'site', 'style.css'), 'body { color: navy }')
    // There is intentionally no root style.css: a wrong directory base must fail.
    const harness = previewHarness()
    t.after(() => harness.preview.close())
    const issued = await harness.preview.issue(root, 'reaudit-synthetic-session')
    assert.equal(harness.listens, 1, 'only the fake listener should be initialized')
    const page = await harness.document(issued.url)
    assert.equal(page.status, 200)
    assert.match(page.headers['content-type'], /^text\/html\b/)
    assert.match(page.headers['content-security-policy'], /\bsandbox\b/)
    assert.doesNotMatch(page.headers['content-security-policy'], /\ballow-same-origin\b/)

    // Browser-equivalent URL resolution after optional canonical redirects; no browser/request.
    const asset = await harness.head(new URL('style.css', page.url).href)
    assert.equal(
      asset.status,
      200,
      'relative style.css must resolve alongside the actual default site/index.html',
    )
    assert.match(
      asset.headers['content-type'],
      /^text\/css\b/,
      'an HTML fallback is not a successful stylesheet response',
    )
    const missing = await harness.head(new URL('missing-fixture.css', page.url).href)
    assert.equal(missing.status, 404, 'a nonexistent asset must not be disguised as successful HTML')
  },
)
