/* Интернет и скриншоты для агента: чтение страниц, поиск, снимок страницы проекта.
   • fetch/search — только наружу: адреса локальной сети, loopback и служебные блокируются на этапе соединения
     (проверяется IP, к которому реально подключаемся, — перепривязка DNS и редиректы не обходят защиту).
   • shot — headless Edge/Chrome/Chromium с этого компьютера, только для адресов 127.0.0.1/localhost. */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { childEnv, serverProcesses } from './process-safety.mjs'
import { publicFailure } from './public-errors.mjs'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_TEXT = 30000
const UA = 'Mozilla/5.0 (compatible; TetraFree/1.0; +https://github.com/VcodeWL/tetrafree)'

/** true — адрес приватный/служебный: наружу ходить нельзя */
export function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    // net validates syntax; expand to eight 16-bit words, including dotted tails.
    let text = ip.toLowerCase().split('%')[0]
    text = text.replace(/(\d+\.\d+\.\d+\.\d+)$/, (v) => {
      const n = v.split('.').map(Number)
      return ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16)
    })
    const halves = text.split('::')
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const words = (
      halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
    ).map((x) => parseInt(x, 16))
    if (words.length !== 8) return true
    if (words.slice(0, 5).every((x) => x === 0) && words[5] === 0xffff)
      return isPrivateIp([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.'))
    // Only global unicast is eligible; reject transition/documentation ranges.
    return (
      (words[0] & 0xe000) !== 0x2000 ||
      words[0] === 0x2002 ||
      (words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8))
    )
  }
  if (!net.isIPv4(ip)) return true
  const [a, b, c] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

/** lookup, который не отдаёт приватные адреса */
function safeLookup(host, opts, cb) {
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err)
    const ok = list.filter((x) => !isPrivateIp(x.address))
    if (!ok.length)
      return cb(Object.assign(new Error('Адрес во внутренней сети — запрещено'), { code: 'EPRIV' }))
    if (opts && opts.all) return cb(null, ok)
    cb(null, ok[0].address, ok[0].family)
  })
}

export function checkUrl(raw, allowPrivate = false) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Некорректный адрес')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Только http и https')
  if (u.username || u.password) throw new Error('Адрес с логином и паролем не поддерживается')
  if (allowPrivate) return u
  const h = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(h) && isPrivateIp(h)) throw new Error('Адрес во внутренней сети — запрещено')
  if (/^localhost$|\.local$|\.internal$|\.localhost$/i.test(h))
    throw new Error('Адрес во внутренней сети — запрещено')
  return u
}

/** GET/POST с ручными редиректами, лимитом размера и таймаутом. get = { status, type, body: Buffer, url } */
export function httpGet(
  raw,
  { method = 'GET', body, headers = {}, timeout = 15000, hops = 5, allowPrivate = false } = {},
) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = checkUrl(raw, allowPrivate)
    } catch (e) {
      return reject(e)
    }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(
      u,
      {
        method,
        ...(allowPrivate ? {} : { lookup: safeLookup }),
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/json,text/plain,*/*;q=0.5',
          'accept-language': 'ru,en;q=0.8',
          ...headers,
        },
        timeout,
      },
      (res) => {
        const st = res.statusCode || 0
        if (st >= 300 && st < 400 && res.headers.location) {
          res.resume()
          if (hops <= 0) return reject(new Error('Слишком много перенаправлений'))
          let next
          try {
            next = new URL(res.headers.location, u).href
          } catch {
            return reject(new Error('Некорректное перенаправление'))
          }
          return httpGet(next, { method: 'GET', headers, timeout, hops: hops - 1, allowPrivate }).then(
            resolve,
            reject,
          )
        }
        const chunks = []
        let n = 0
        res.on('data', (d) => {
          n += d.length
          if (n > MAX_BYTES) {
            req.destroy(new Error('Страница больше 2 МБ'))
            return
          }
          chunks.push(d)
        })
        res.on('end', () =>
          resolve({
            status: st,
            type: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks),
            url: u.href,
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Таймаут ответа сайта')))
    req.on('error', (e) => reject(e.code === 'EPRIV' ? new Error('Адрес во внутренней сети — запрещено') : e))
    if (body) req.write(body)
    req.end()
  })
}

const ENT = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
}
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => (+n > 0 && +n < 0x110000 ? String.fromCodePoint(+n) : ''))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      parseInt(n, 16) < 0x110000 ? String.fromCodePoint(parseInt(n, 16)) : '',
    )
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)

/** HTML → читаемый текст: заголовки, списки, ссылки `[текст](адрес)`; скрипты/стили/меню выброшены */
export function htmlToText(html, base = '') {
  let s = html.replace(/<!--[\s\S]*?-->/g, '')
  const title = decode((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim())
  s = s.replace(/<(script|style|noscript|svg|template|nav|footer|iframe|form)\b[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_, a, b, t) => {
    const text = t
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    let href = a ?? b
    if (!text || /^(#|javascript:|mailto:)/i.test(href)) return text
    try {
      href = base ? new URL(href, base).href : href
    } catch {
      /* оставляем как есть */
    }
    return `[${text}](${href})`
  })
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(+n) + ' ')
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<(br|hr)\b[^>]*>/gi, '\n')
  s = s.replace(/<\/(p|div|section|article|tr|h[1-6]|ul|ol|table|pre|blockquote)>/gi, '\n')
  s = s.replace(/<\/t[dh]>/gi, ' | ')
  s = decode(s.replace(/<[^>]+>/g, ''))
  s = s
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return (title ? `# ${title}\n\n` : '') + s
}

export async function webFetch(raw, allowPrivate = false) {
  const r = await httpGet(raw, { allowPrivate })
  if (r.status >= 400) throw new Error(`Сайт ответил ${r.status}`)
  const type = r.type.toLowerCase()
  if (!/^(text\/|application\/(json|xml|xhtml|javascript|x-yaml|yaml)|$)|\+(json|xml)/.test(type))
    throw new Error('Это не текст (' + (type.split(';')[0] || 'неизвестный тип') + ')')
  let text = r.body.toString('utf8')
  if (/html/.test(type) || /^\s*<(!doctype|html)/i.test(text)) text = htmlToText(text, r.url)
  const cut = text.length > MAX_TEXT
  return {
    url: r.url,
    status: r.status,
    type: type.split(';')[0],
    text: cut ? text.slice(0, MAX_TEXT) + '\n…(обрезано)' : text,
  }
}

/** Выдача html.duckduckgo.com → [{title, url, snippet}] */
export function parseDdg(html) {
  const out = []
  const re =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/g
  let m
  while ((m = re.exec(html)) && out.length < 10) {
    let url = decode(m[1])
    const g = url.match(/[?&]uddg=([^&]+)/)
    if (g) {
      try {
        url = decodeURIComponent(g[1])
      } catch {
        continue
      }
    }
    if (url.startsWith('//')) url = 'https:' + url
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue
    const sn = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    out.push({
      title: decode(m[2].replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
      url,
      snippet: sn
        ? decode(sn[1].replace(/<[^>]+>/g, ''))
            .replace(/\s+/g, ' ')
            .trim()
        : '',
    })
  }
  return out
}

export async function webSearch(q) {
  const query = String(q || '')
    .trim()
    .slice(0, 300)
  if (!query) throw new Error('Пустой запрос')
  const r = await httpGet('https://html.duckduckgo.com/html/', {
    method: 'POST',
    body: 'q=' + encodeURIComponent(query) + '&kl=wt-wt',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  if (r.status >= 400) throw new Error(`Поиск ответил ${r.status}`)
  return parseDdg(r.body.toString('utf8'))
}

/* ------------------------------------------------------------------ скриншот */

export function browserCandidates(platform = process.platform, env = process.env) {
  const list = []
  if (env.TF_BROWSER) list.push(env.TF_BROWSER)
  if (platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)) {
      list.push(path.win32.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      list.push(path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      list.push(path.win32.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))
    }
  } else if (platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/chromium',
      '/usr/bin/microsoft-edge',
    )
  }
  return list
}
export function findBrowser(exists = fs.existsSync, platform, env) {
  return browserCandidates(platform, env).find((p) => exists(p)) || null
}

export function shotArgs({ profile }) {
  return [
    '--headless=new',
    '--remote-debugging-pipe',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-component-update',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    'about:blank',
  ]
}

const clamp = (v, a, b, d) => Math.min(b, Math.max(a, Math.round(Number(v)) || d))

/** Минимальный клиент CDP поверх --remote-debugging-pipe (сообщения JSON, разделённые нулевым байтом) */
export function cdpClient(
  child,
  { maxFrame = 24 * 1024 * 1024, maxPending = 32, maxQueue = 1024 * 1024 } = {},
) {
  let buf = Buffer.alloc(0),
    id = 0,
    closed = false,
    rejectFailure
  const waits = new Map(),
    listeners = new Set()
  const failure = new Promise((_, reject) => {
    rejectFailure = reject
  })
  // Caller races this failure; attaching here also prevents unhandled rejection
  // during initialization or final cleanup.
  failure.catch(() => {})
  const dispose = () => {
    if (closed) return
    closed = true
    const error = new Error('Канал браузера закрыт')
    for (const w of waits.values()) w.reject(error)
    waits.clear()
    listeners.clear()
    buf = Buffer.alloc(0)
    rejectFailure(error)
  }
  child.stdio[3].on('error', dispose)
  child.stdio[4].on('error', dispose)
  child.stdio[4].on('end', dispose)
  child.stdio[4].on('data', (d) => {
    if (closed) return
    if (buf.length + d.length > maxFrame) return dispose()
    buf = Buffer.concat([buf, d])
    let i
    while (!closed && (i = buf.indexOf(0)) >= 0) {
      const raw = buf.subarray(0, i).toString('utf8')
      buf = buf.subarray(i + 1)
      let m
      try {
        m = JSON.parse(raw)
      } catch {
        dispose()
        return
      }
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        dispose()
        return
      }
      if (m.id && waits.has(m.id)) {
        const w = waits.get(m.id)
        waits.delete(m.id)
        m.error ? w.reject(new Error('Браузер не выполнил операцию')) : w.resolve(m.result || {})
      } else if (m.method) for (const f of listeners) f(m)
    }
  })
  return {
    failure,
    dispose,
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error('Канал браузера закрыт'))
      if (waits.size >= maxPending) {
        dispose()
        return Promise.reject(new Error('Лимит запросов браузера'))
      }
      return new Promise((resolve, reject) => {
        const n = ++id,
          record = JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'
        if ((child.stdio[3].writableLength || 0) + Buffer.byteLength(record) > maxQueue) {
          reject(new Error('Лимит очереди браузера'))
          dispose()
          return
        }
        waits.set(n, { resolve, reject })
        try {
          child.stdio[3].write(record, (e) => {
            if (e) dispose()
          })
        } catch {
          dispose()
        }
      })
    },
    on: (f) => (listeners.add(f), () => listeners.delete(f)),
  }
}

/** Снимок страницы; url — только loopback. Возвращает data:image/png;base64,… */
export async function takeShot(
  raw,
  {
    width,
    height,
    timeout = 30000,
    exe = findBrowser(),
    full = false,
    signal,
    launch = spawn,
    registry = serverProcesses,
  } = {},
) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Некорректный адрес')
  }
  if (u.protocol !== 'http:' || !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname))
    throw new Error('Скриншот делается только для страниц на этом компьютере (127.0.0.1 / localhost)')
  if (!exe)
    throw new Error(
      'Не нашёл браузер для скриншотов: нужен Microsoft Edge или Google Chrome (или путь в переменной TF_BROWSER)',
    )
  if (signal?.aborted) throw new Error('Снимок отменён')
  if (!registry.available('browser')) throw new Error('Лимит процессов браузера')
  timeout = clamp(timeout, 100, 60000, 30000)
  const W = clamp(width, 320, 2560, 1280),
    H = clamp(height, 240, 6000, 800)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-shot-'))
  let child, owned, c, abort
  let timer, idleTimer, settleTimer
  try {
    child = launch(exe, shotArgs({ profile: path.join(dir, 'p') }), {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: childEnv(),
    })
    owned = registry.own(child, 'browser', () => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    c = cdpClient(child)
    const dead = new Promise((_, reject) => {
      child.on('error', () => reject(new Error('Не удалось запустить браузер')))
      abort = () => reject(new Error('Снимок отменён'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.on('exit', () => reject(new Error('Браузер закрылся, не сделав снимок')))
      timer = setTimeout(
        () => reject(new Error('Браузер не успел сделать снимок за ' + timeout / 1000 + ' с')),
        timeout,
      )
    })
    const work = (async () => {
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true })
      const S = (m, p) => c.send(m, p, sessionId)
      await S('Page.enable')
      await S('Page.setLifecycleEventsEnabled', { enabled: true })
      await S('Emulation.setDeviceMetricsOverride', {
        width: W,
        height: H,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await S('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 255, b: 255, a: 1 } })
      const idle = new Promise((resolve) => {
        const off = c.on((m) => {
          if (m.method === 'Page.lifecycleEvent' && m.params?.name === 'networkIdle') {
            off()
            resolve()
          }
        })
        idleTimer = setTimeout(resolve, 12000)
      })
      await S('Page.navigate', { url: u.href })
      await idle
      await new Promise((r) => {
        settleTimer = setTimeout(r, 700)
      }) /* шрифты, анимации входа */
      let h = H
      if (full) {
        const r = await S('Runtime.evaluate', {
          expression:
            'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
          returnByValue: true,
        })
        h = clamp(r.result?.value, H, 6000, H)
        if (h !== H)
          await S('Emulation.setDeviceMetricsOverride', {
            width: W,
            height: h,
            deviceScaleFactor: 1,
            mobile: false,
          })
      }
      const shot = await S('Page.captureScreenshot', { format: 'png' })
      if (typeof shot.data !== 'string' || shot.data.length > 22 * 1024 * 1024)
        throw new Error('Превышен размер снимка')
      return 'data:image/png;base64,' + shot.data
    })()
    return await Promise.race([work, dead, c.failure])
  } finally {
    clearTimeout(timer)
    clearTimeout(idleTimer)
    clearTimeout(settleTimer)
    signal?.removeEventListener('abort', abort)
    c?.dispose()
    if (owned) await owned.stop()
    else fs.rmSync(dir, { recursive: true, force: true })
  }
}

export async function webRoutes(req, res, u, io) {
  if (!u.pathname.startsWith('/api/web/') && u.pathname !== '/api/shot') return false
  if (req.method !== 'POST') return false
  const b = await io.readBody(req)
  const controller = new AbortController()
  const abort = () => controller.abort()
  const onClose = () => {
    if (!res.writableEnded) abort()
  }
  req.once?.('aborted', abort)
  res.once?.('close', onClose)
  if (req.aborted || res.destroyed) abort()
  try {
    if (u.pathname === '/api/web/fetch') io.json(res, 200, await webFetch(String(b.url || '')))
    else if (u.pathname === '/api/web/search') io.json(res, 200, { results: await webSearch(b.q) })
    else if (u.pathname === '/api/shot') {
      io.json(res, 200, {
        image: await takeShot(String(b.url || ''), {
          width: b.width,
          height: b.height,
          full: !!b.full,
          signal: controller.signal,
        }),
      })
    } else return false
  } catch (e) {
    if (!res.destroyed) {
      const failure = publicFailure(e, 'Не удалось выполнить веб-операцию', 502, 'web')
      io.json(res, failure.status, { error: failure.error })
    }
  } finally {
    req.removeListener?.('aborted', abort)
    res.removeListener?.('close', onClose)
  }
  return true
}
