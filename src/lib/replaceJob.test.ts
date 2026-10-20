import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Worker as NodeWorker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { replaceJob, type ReplaceWorker } from './replaceJob'
import type { ReplaceReply, ReplaceRequest } from './replace'

/** Real isolated execution of the same request handler; no browser is launched. */
function factory() {
  const worker = new NodeWorker(
    `
    require('tsx/cjs');
    const { parentPort } = require('node:worker_threads');
    const { executeReplace } = require(${JSON.stringify(fileURLToPath(new URL('./replace.ts', import.meta.url)))});
    parentPort.on('message', request => parentPort.postMessage(executeReplace(request)));
  `,
    { eval: true },
  )
  const adapter: ReplaceWorker = {
    postMessage: (request: ReplaceRequest) => worker.postMessage(request),
    terminate: () => {
      void worker.terminate()
    },
    onmessage: null,
    onerror: null,
  }
  worker.on('message', (data: ReplaceReply) => adapter.onmessage?.({ data } as MessageEvent<ReplaceReply>))
  worker.on('error', () => adapter.onerror?.({} as ErrorEvent))
  return adapter
}
const opts = { regex: true, caseSensitive: true }

test('UI08: search and replacement return from a real disposable worker', async () => {
  const search = replaceJob({ files: { a: 'a-1 b-2' }, q: '(\\w)-(\\d)', opts }, factory, 5000)
  assert.equal((await search.promise).hits[0].count, 2)
  const job = replaceJob(
    { files: { a: 'a-1 b-2' }, q: '(\\w)-(\\d)', opts, replacement: '$2$1' },
    factory,
    5000,
  )
  assert.deepEqual((await job.promise).files, { a: '1a 2b' })
})
test('UI08: backtracking on a short string is interrupted, main event loop stays responsive', async () => {
  let ticks = 0
  const heartbeat = setInterval(() => ticks++, 10)
  try {
    const job = replaceJob({ files: { a: 'a'.repeat(32) + '!' }, q: '(a+)+$', opts }, factory, 600)
    await assert.rejects(job.promise, /лимит времени/)
    assert.ok(ticks >= 5, `main thread heartbeat: ${ticks}`)
  } finally {
    clearInterval(heartbeat)
  }
})
test('UI08: replacement is also budgeted and cancellable', async () => {
  const job = replaceJob(
    { files: { a: 'a'.repeat(32) + '!' }, q: '(a+)+$', opts, replacement: 'x' },
    factory,
    400,
  )
  await assert.rejects(job.promise, /лимит времени/)
  const cancelled = replaceJob({ files: { a: 'a'.repeat(32) + '!' }, q: '(a+)+$', opts }, factory, 5000)
  cancelled.cancel()
  await assert.rejects(cancelled.promise, /отменён/)
})
test('UI08: malformed regex errors stay inside worker', async () => {
  const job = replaceJob({ files: { a: 'hello' }, q: '(', opts }, factory, 5000)
  await assert.rejects(job.promise, /Некорректное/)
})
test('UI08: worker creation failure does not execute regex on main thread', async () => {
  const job = replaceJob({ files: { a: 'hello' }, q: 'x', opts }, () => {
    throw new Error('blocked')
  })
  await assert.rejects(job.promise, /безопасный поиск/)
})
