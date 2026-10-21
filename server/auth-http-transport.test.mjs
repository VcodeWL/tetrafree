/* Pure auth route fixtures: no HTTP listener, delivery, provider or credentials. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-auth-transport-'))
process.env.TF_DATA = temp
delete process.env.SMTP_URL
const { accountRoutes, flushDb } = await import('./auth.mjs')
const { outbox } = await import('./mail.mjs')
const url = new URL('http://fixture.invalid/api/dev/outbox')
const req = { method: 'DELETE', headers: {}, socket: { remoteAddress: '127.0.0.1' } }
test.after(() => {
  outbox.length = 0
  flushDb()
  process.removeListener('exit', flushDb)
  fs.rmSync(temp, { recursive: true, force: true })
})
for (const status of [413, 408, 499]) {
  test(`auth body transport ${status} does not become empty DELETE or clear mail`, async () => {
    outbox.length = 0
    outbox.push({ id: 'synthetic-fixture', body: 'benign fixture' })
    const failure = Object.assign(new Error('fixture transport failure'), { status })
    let responses = 0
    await assert.rejects(
      accountRoutes(req, {}, url, {
        isLocal: true,
        readBody: async () => {
          throw failure
        },
        json: () => {
          responses++
        },
      }),
      (error) => error === failure,
    )
    assert.equal(outbox.length, 1)
    assert.equal(responses, 0)
  })
}
test('intentional empty DELETE body remains supported', async () => {
  outbox.length = 0
  outbox.push({ id: 'synthetic-fixture' })
  let result
  assert.equal(
    await accountRoutes(req, {}, url, {
      isLocal: true,
      readBody: async () => ({}),
      json: (_res, status, body) => {
        result = { status, body }
      },
    }),
    true,
  )
  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.equal(outbox.length, 0)
})
test('unrelated legacy fallback is unchanged by targeted transport fix', async () => {
  let result
  await accountRoutes({ ...req, method: 'POST' }, {}, new URL('http://fixture.invalid/api/auth/config'), {
    isLocal: true,
    readBody: async () => {
      throw Object.assign(new Error('fixture malformed body'), { status: 400 })
    },
    json: (_res, status, body) => {
      result = { status, body }
    },
  })
  assert.equal(result.status, 200)
  assert.equal(typeof result.body.hasUsers, 'boolean')
})
