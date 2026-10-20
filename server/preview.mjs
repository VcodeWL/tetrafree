/* Project content never shares the app/API origin. The listener is lazy, bounded,
   loopback only and serves no privileged routes. Capabilities are project/session
   scoped and short-lived; legacy session-wide preview links are not accepted. */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { finalFile } from './fs-safety.mjs'

export const PREVIEW_CSP =
  "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'"
const MIME = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain',
}
export function createPreview({ sessionValid, createServer = http.createServer, ttl = 15 * 60 * 1000 } = {}) {
  const caps = new Map()
  let server, ready
  const clean = () => {
    for (const [k, c] of caps) if (c.exp < Date.now() || !sessionValid(c.sid)) caps.delete(k)
  }
  const fail = (res, code, text) => {
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }
  const serve = async (req, res) => {
    clean()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      return fail(res, 405, 'Превью не содержит API приложения')
    if (
      req.headers.host !== `127.0.0.1:${server.address().port}` ||
      !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    )
      return fail(res, 403, 'Только локальное превью')
    const u = new URL(req.url, 'http://x')
    const m = u.pathname.match(/^\/p\/([0-9a-f]{32})\/(.*)$/)
    const cap = m && caps.get(m[1])
    if (!cap) return fail(res, 401, 'Превью истекло — открой его заново из приложения')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,HEAD' })
      return res.end()
    }
    let rel
    try {
      rel = decodeURIComponent(m[2])
    } catch {
      return fail(res, 400, 'Неверный путь')
    }
    try {
      if (!rel)
        rel = (await finalFile(cap.dir, 'site/index.html', { preview: true })
          .then(() => true)
          .catch(() => false))
          ? 'site/index.html'
          : 'index.html'
      const abs = await finalFile(cap.dir, rel, { preview: true })
      res.writeHead(200, {
        'content-type':
          (MIME[abs.split('.').pop().toLowerCase()] || 'application/octet-stream') + '; charset=utf-8',
        'content-security-policy': PREVIEW_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'service-worker-allowed': '/disabled/',
      })
      if (req.method === 'HEAD') return res.end()
      const stream = fs.createReadStream(abs)
      stream.on('error', () => res.destroy())
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    } catch (e) {
      fail(res, e.code === 'ENOENT' ? 404 : 400, 'Файл превью не найден или недоступен')
    }
  }
  return {
    async issue(dir, sid, rel = '') {
      clean()
      if (!sessionValid(sid)) throw new Error('Сессия превью недействительна')
      if (typeof rel !== 'string') throw Object.assign(new Error('Неверный путь превью'), { status: 400 })
      if (!rel)
        rel = (await finalFile(dir, 'site/index.html', { preview: true })
          .then(() => true)
          .catch(() => false))
          ? 'site/index.html'
          : 'index.html'
      if (!ready) {
        server = createServer((req, res) =>
          serve(req, res).catch(() => {
            if (!res.headersSent) fail(res, 500, 'Ошибка превью')
            else res.destroy()
          }),
        )
        ready = new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        ready.catch(() => {
          ready = undefined
          server?.close()
        })
        server.unref()
      }
      await ready
      // Origin remains dedicated to preview, opaque sandbox origin blocks storage,
      // SW and API reads while DOM/canvas/forms/scripts remain interactive.
      while (caps.size >= 64) caps.delete(caps.keys().next().value)
      const token = crypto.randomBytes(16).toString('hex'),
        expiresAt = Date.now() + ttl
      caps.set(token, { dir, sid, exp: expiresAt })
      return {
        url:
          `http://127.0.0.1:${server.address().port}/p/${token}/` +
          rel.split('/').map(encodeURIComponent).join('/'),
        expiresAt,
      }
    },
    close() {
      caps.clear()
      server?.close()
      server?.closeAllConnections?.()
      ready = undefined
    },
  }
}
