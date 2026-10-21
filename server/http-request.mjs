/* Shared HTTP boundary primitives. No listening sockets or application route policy. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { BlockList, isIP } from 'node:net'
import { publicError, publicFailure } from './public-errors.mjs'

export const requestScope = new AsyncLocalStorage()
const cors = new WeakMap()
const bodies = new WeakMap()
const cancelled = () => publicError(499, 'Операция отменена')
export function assertRequestActive() {
  if (requestScope.getStore()?.aborted) throw cancelled()
}
export function responseOpen(res) {
  return !res.destroyed && !res.writableEnded
}
export function responseStatus(status, fallback = 500) {
  return Number.isInteger(status) && status >= 200 && status <= 599 ? status : fallback
}
export function responseHeaders(res, headers = {}) {
  const origin = cors.get(res)
  return origin ? { ...headers, 'access-control-allow-origin': origin, vary: 'Origin' } : headers
}
export function json(res, status, body) {
  if (!responseOpen(res) || res.headersSent) return false
  const data = JSON.stringify(body)
  res.writeHead(
    responseStatus(status),
    responseHeaders(res, {
      'content-type': 'application/json; charset=utf-8',
    }),
  )
  res.end(data)
  return true
}
export function failRequest(res, error) {
  if (!responseOpen(res)) return
  if (res.headersSent) return res.end()
  if (error?.closeConnection) res.setHeader?.('connection', 'close')
  const errorStatus = (status) => (Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500)
  const failure = publicFailure(
    error,
    'Не удалось выполнить операцию сервера',
    errorStatus(error?.status),
    'server',
  )
  return json(res, errorStatus(failure.status), { error: failure.error })
}

/** Byte budget, absolute read deadline, and exactly-once settlement. Empty/null stay {}. */
export function readBody(req, { limit = 50e6, timeout = 60000, signal = requestScope.getStore() } = {}) {
  if (bodies.has(req)) return bodies.get(req)
  const promise = new Promise((resolve, reject) => {
    let chunks = [],
      bytes = 0,
      settled = false,
      timer
    const cleanup = () => {
      clearTimeout(timer)
      for (const [event, fn] of [
        ['data', data],
        ['end', end],
        ['error', error],
        ['aborted', abort],
        ['close', close],
      ])
        req.removeListener(event, fn)
      signal?.removeEventListener('abort', abort)
      chunks = []
    }
    const finish = (failure, body) => {
      if (settled) return
      settled = true
      cleanup()
      if (failure) {
        req.pause?.()
        reject(failure)
      } else resolve(body)
    }
    const abort = () => finish(cancelled())
    const close = () => {
      if (!req.complete && !req.readableEnded) abort()
    }
    const error = () => {
      const e = publicError(400, 'Не удалось прочитать тело запроса')
      e.closeConnection = true
      finish(e)
    }
    const tooLarge = () => {
      const e = publicError(413, 'Слишком большой запрос')
      e.closeConnection = true
      finish(e)
    }
    const data = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
      bytes += buf.length
      if (bytes > limit) return tooLarge()
      chunks.push(buf)
    }
    const end = () => {
      try {
        const text = Buffer.concat(chunks, bytes).toString('utf8')
        const body = (text ? JSON.parse(text) : {}) ?? {}
        if (typeof body !== 'object' || Array.isArray(body))
          return finish(publicError(400, 'Тело запроса должно быть JSON-объектом'))
        finish(null, body)
      } catch {
        finish(publicError(400, 'Тело запроса — не корректный JSON'))
      }
    }
    if (signal?.aborted || req.aborted || req.destroyed) return abort()
    const length = req.headers?.['content-length']
    if (length !== undefined && /^\d+$/.test(String(length)) && Number(length) > limit) return tooLarge()
    for (const [event, fn] of [
      ['data', data],
      ['end', end],
      ['error', error],
      ['aborted', abort],
      ['close', close],
    ])
      req.on(event, fn)
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      const e = publicError(408, 'Время чтения запроса истекло')
      e.closeConnection = true
      finish(e)
    }, timeout)
    timer.unref?.()
    if (req.readableEnded) end()
  })
  bodies.set(req, promise)
  return promise
}

const LOCALS = new Set(['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'])
const loopbacks = new BlockList()
loopbacks.addSubnet('127.0.0.0', 8, 'ipv4')
loopbacks.addAddress('::1', 'ipv6')
function authority(value) {
  if (typeof value !== 'string' || !value || /[\s/@?#\\]/.test(value)) return ''
  try {
    const url = new URL('http://' + value)
    return url.pathname === '/' ? url.hostname : ''
  } catch {
    return ''
  }
}
/** Preserve Vite/Tauri local cross-port support; extra hosts remain same-host only. */
export function requestAccess(req, res, allowedHosts = process.env.TF_ALLOWED_HOSTS || '') {
  const host = authority(req.headers.host)
  const extra = new Set(
    String(allowedHosts)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
  const origin = req.headers.origin
  let originAllowed = origin === undefined || origin === ''
  if (typeof origin === 'string' && /^[a-z]+:\/\/[^/?#\\\s]+$/i.test(origin)) {
    try {
      const url = new URL(origin)
      const valid = !url.username && !url.password
      originAllowed =
        valid &&
        ((['http:', 'https:'].includes(url.protocol) &&
          (LOCALS.has(url.hostname) || (extra.has(url.hostname) && url.hostname === host))) ||
          (url.protocol === 'tauri:' && url.hostname === 'localhost' && !url.port))
    } catch {
      originAllowed = false
    }
  }
  if (!host || (!LOCALS.has(host) && !extra.has(host)) || !originAllowed)
    return { allowed: false, isLocal: false }
  if (origin) {
    cors.set(res, origin)
    // Other route owners may write their own response headers (SSE/PTY/MCP).
    res.setHeader?.('access-control-allow-origin', origin)
    res.setHeader?.('vary', 'Origin')
  }
  const address = String(req.socket?.remoteAddress || '').toLowerCase()
  const family = isIP(address)
  const loopback = !!family && loopbacks.check(address, family === 6 ? 'ipv6' : 'ipv4')
  return { allowed: true, isLocal: LOCALS.has(host) && loopback }
}

/** Lifetime follows the response, not the async handler (exec/SSE return early). */
export function runRequest(req, res, handle, next) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const close = () => {
    if (!req.complete && !req.readableEnded) abort()
  }
  const responseClose = () => {
    if (!res.writableEnded) abort()
    cleanup()
  }
  const releaseError = () => req.removeListener('error', abort)
  const cleanup = () => {
    req.removeListener('aborted', abort)
    // A failed/incomplete upload may emit its terminal error after response finish.
    if (req.complete || req.readableEnded || req.closed) releaseError()
    else req.once('close', releaseError)
    req.removeListener('close', close)
    res.removeListener('close', responseClose)
    res.removeListener('error', responseClose)
    res.removeListener('finish', cleanup)
  }
  req.once('aborted', abort)
  req.once('error', abort)
  req.once('close', close)
  res.once('close', responseClose)
  res.once('error', responseClose)
  res.once('finish', cleanup)
  if (req.aborted || (req.destroyed && !req.complete) || res.destroyed) abort()
  return requestScope.run(controller.signal, async () => {
    try {
      assertRequestActive()
      const result = await handle()
      if (result === false) {
        cleanup()
        next()
      }
    } catch (e) {
      try {
        failRequest(res, e)
      } catch {
        res.destroy?.()
      }
    }
  })
}

function waitDrain(res, signal, timeout) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      res.removeListener('drain', drain)
      res.removeListener('close', abort)
      res.removeListener('error', abort)
      signal?.removeEventListener('abort', abort)
    }
    const drain = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(cancelled())
    }
    if (signal?.aborted || !responseOpen(res)) return abort()
    res.once('drain', drain)
    res.once('close', abort)
    res.once('error', abort)
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      reject(publicError(504, 'Клиент не принимает ответ'))
    }, timeout)
    timer.unref?.()
  })
}
/** At most one upstream chunk retained, split into bounded writes; pause pull on false. */
export async function streamResponse(
  res,
  body,
  { signal = requestScope.getStore(), drainTimeout = 15000 } = {},
) {
  for await (const chunk of body) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    for (let offset = 0; offset < data.length; offset += 65536) {
      if (signal?.aborted || !responseOpen(res)) throw cancelled()
      if (!res.write(data.subarray(offset, offset + 65536))) await waitDrain(res, signal, drainTimeout)
    }
  }
  if (signal?.aborted || !responseOpen(res)) throw cancelled()
  res.end()
}
