/* SMTP state-machine fake only: net.connect never opens a socket. */
import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { EventEmitter } from 'node:events'
process.env.SMTP_URL = 'smtp://fixture:dummy@mail.unit.invalid:587'
const { sendMail } = await import('./mail.mjs')
test('SMTP without STARTTLS fails before AUTH or mail payload', async () => {
  const original = net.connect,
    writes = []
  net.connect = () => {
    const socket = new EventEmitter()
    socket.setEncoding = () => {}
    socket.destroy = () => {}
    socket.write = (line) => {
      writes.push(line)
      if (line.startsWith('EHLO '))
        queueMicrotask(() => socket.emit('data', '250-fixture\r\n250 AUTH PLAIN LOGIN\r\n'))
    }
    queueMicrotask(() => socket.emit('data', '220 fixture\r\n'))
    return socket
  }
  try {
    await assert.rejects(
      sendMail({ to: 'receiver@unit.invalid', subject: 'Fixture', text: 'Fixture', html: '<p>Fixture</p>' }),
      /отправить письмо/,
    )
    assert.ok(writes.some((s) => s.startsWith('EHLO ')))
    assert.ok(!writes.some((s) => /^(AUTH|MAIL|RCPT|DATA)/.test(s)))
  } finally {
    net.connect = original
  }
})

test('STARTTLS mock verified transport permits mail, invalid certificate blocks AUTH', async () => {
  const tls = (await import('node:tls')).default
  const originalNet = net.connect,
    originalTls = tls.connect
  let authorized = false,
    writes = []
  const socket = (secure = false) => {
    const s = new EventEmitter()
    s.authorized = authorized
    s.setEncoding = () => {}
    s.destroy = () => {}
    s.write = (line) => {
      writes.push({ secure, line })
      let reply
      if (line.startsWith('EHLO'))
        reply = secure ? '250-fixture\r\n250 AUTH PLAIN\r\n' : '250-fixture\r\n250 STARTTLS\r\n'
      else if (line.startsWith('STARTTLS')) reply = '220 ready\r\n'
      else if (line.startsWith('AUTH')) reply = '235 accepted\r\n'
      else if (line.startsWith('MAIL') || line.startsWith('RCPT')) reply = '250 accepted\r\n'
      else if (line.startsWith('DATA')) reply = '354 message\r\n'
      else if (!line.startsWith('QUIT')) reply = '250 accepted\r\n'
      if (reply) queueMicrotask(() => s.emit('data', reply))
    }
    return s
  }
  net.connect = () => {
    const s = socket()
    queueMicrotask(() => s.emit('data', '220 fixture\r\n'))
    return s
  }
  tls.connect = (_options, cb) => {
    const s = socket(true)
    queueMicrotask(cb)
    return s
  }
  const message = { to: 'receiver@unit.invalid', subject: 'Fixture', text: 'Fixture', html: '<p>Fixture</p>' }
  try {
    await assert.rejects(sendMail(message), /отправить письмо/)
    assert.ok(!writes.some((s) => s.line.startsWith('AUTH')))
    authorized = true
    writes = []
    const result = await sendMail(message)
    assert.equal(result.status, 'sent')
    assert.ok(writes.some((s) => s.secure && s.line.startsWith('AUTH')))
    assert.ok(!writes.some((s) => !s.secure && /^(AUTH|MAIL|RCPT|DATA)/.test(s.line)))
  } finally {
    net.connect = originalNet
    tls.connect = originalTls
  }
})

test('SMTP transport diagnostics stay out of public errors and logs', async () => {
  const originalConnect = net.connect,
    originalLog = console.error,
    logs = []
  net.connect = () => {
    throw new Error('SYNTHETIC_PRIVATE_SMTP_DETAIL')
  }
  console.error = (...args) => logs.push(args.join(' '))
  try {
    await assert.rejects(
      sendMail({ to: 'receiver@unit.invalid', subject: 'Fixture', text: 'Fixture', html: '<p>Fixture</p>' }),
      (error) => {
        assert.equal(error.status, 502)
        assert.match(error.extra.correlationId, /^[0-9a-f]{16}$/)
        assert.ok(!error.message.includes('SYNTHETIC_PRIVATE_SMTP_DETAIL'))
        return true
      },
    )
    assert.ok(!logs.join(' ').includes('SYNTHETIC_PRIVATE_SMTP_DETAIL'))
  } finally {
    net.connect = originalConnect
    console.error = originalLog
  }
})
