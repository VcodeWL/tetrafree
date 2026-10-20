import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCheckpointHandler,
  flushStableCheckpoint,
  startDesktopLifecycle,
  type CheckpointRequest,
} from './desktopLifecycle'
const request = (digit = 'a', timeoutMs = 100): CheckpointRequest => ({
  token: digit.repeat(64),
  reason: 'quit',
  timeoutMs,
})

test('no browser runtime means no lifecycle side effects', () => {
  assert.doesNotThrow(() => startDesktopLifecycle()())
})
test('ACK true is sent only after successful awaited durable flush', async () => {
  let resolve!: () => void
  const acks: boolean[] = []
  const handler = createCheckpointHandler({
    flush: () =>
      new Promise<void>((r) => {
        resolve = r
      }),
    ack: async (_, saved) => {
      acks.push(saved)
      return true
    },
    warn: () => assert.fail('unexpected warning'),
  })
  const running = handler(request())
  assert.deepEqual(acks, [])
  resolve()
  await running
  assert.deepEqual(acks, [true])
  await handler(request())
  assert.equal(acks.length, 1, 'duplicate token cannot replay an ACK')
})
test('flush failure ACKs false and warns, next native token can retry', async () => {
  let fail = true,
    warned = 0
  const acks: boolean[] = []
  const handler = createCheckpointHandler({
    flush: async () => {
      if (fail) throw new Error('disk failure')
    },
    ack: async (_, saved) => {
      acks.push(saved)
      return true
    },
    warn: () => warned++,
  })
  await handler(request())
  fail = false
  await handler(request('b'))
  assert.deepEqual(acks, [false, true])
  assert.equal(warned, 1)
})
test('deadline never emits success even if original flush resolves later', async () => {
  let resolve!: () => void
  const acks: boolean[] = []
  let warned = 0
  const handler = createCheckpointHandler({
    flush: () =>
      new Promise<void>((r) => {
        resolve = r
      }),
    ack: async (_, saved) => {
      acks.push(saved)
      return true
    },
    warn: () => warned++,
  })
  await handler(request('c', 5))
  resolve()
  await Promise.resolve()
  assert.deepEqual(acks, [false])
  assert.equal(warned, 1)
})
test('invalid request is ignored; simultaneous different token is failed, not independently saved', async () => {
  let resolve!: () => void
  const acks: [string, boolean][] = []
  const handler = createCheckpointHandler({
    flush: () =>
      new Promise<void>((r) => {
        resolve = r
      }),
    ack: async (token, saved) => {
      acks.push([token, saved])
      return true
    },
    warn() {},
  })
  await handler({ ...request(), token: 'short' })
  assert.equal(acks.length, 0)
  const running = handler(request('d'))
  await handler(request('e'))
  assert.deepEqual(acks, [['e'.repeat(64), false]])
  resolve()
  await running
  assert.equal(acks[1][1], true)
})
test('late/rejected native ACK is a failure warning, never called accepted', async () => {
  let warnings = 0
  const handler = createCheckpointHandler({
    flush: async () => {},
    ack: async () => false,
    warn: () => warnings++,
  })
  await handler(request('f'))
  assert.equal(warnings, 1)
})
test('completed flush after time watermark does not ACK success', async () => {
  let time = 0
  const acks: boolean[] = []
  const handler = createCheckpointHandler({
    now: () => time,
    flush: async () => {
      time = 200
    },
    ack: async (_, saved) => {
      acks.push(saved)
      return true
    },
    warn() {},
  })
  await handler(request())
  assert.deepEqual(acks, [false])
})

test('concurrent runtime mutation during durable write refuses successful checkpoint', async () => {
  let revision = 10
  await assert.rejects(
    flushStableCheckpoint(
      async () => {
        revision++
      },
      () => revision,
    ),
    /изменилось/,
  )
  await assert.doesNotReject(
    flushStableCheckpoint(
      async () => {},
      () => revision,
    ),
  )
})
