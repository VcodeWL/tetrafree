/* Почта TetraFree. Если задан SMTP_URL (smtp://user:pass@host:587 или smtps://user:pass@host:465) — письма уходят по SMTP
   (минимальный клиент на net/tls: STARTTLS, AUTH PLAIN/LOGIN). Иначе — «dev-ящик»: письма сохраняются на сервере и показываются
   в приложении (только с этого компьютера), чтобы весь поток подтверждений работал без настройки почты. */
import net from 'node:net'
import tls from 'node:tls'
import crypto from 'node:crypto'

const SMTP = process.env.SMTP_URL ? new URL(process.env.SMTP_URL) : null
export const FROM =
  process.env.MAIL_FROM ||
  (SMTP
    ? `TetraFree <${decodeURIComponent(SMTP.username || 'no-reply')}@${SMTP.hostname}>`
    : 'TetraFree <no-reply@tetrafree.local>')
export const mailMode = () => (SMTP ? 'smtp' : 'dev')

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n')
const hdr = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`)
const addr = (s) => (s.match(/<([^>]+)>/)?.[1] || s).trim()

function build({ to, subject, text, html }) {
  const bd = 'tf' + crypto.randomBytes(8).toString('hex')
  const id = `<${crypto.randomBytes(12).toString('hex')}@tetrafree>`
  const h = [
    `From: ${FROM.replace(/^(.*?)\s*</, (m, n) => (n ? hdr(n) + ' <' : '<'))}`,
    `To: ${to}`,
    `Subject: ${hdr(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${bd}"`,
  ].join('\r\n')
  const part = (type, body) =>
    `--${bd}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(body))}\r\n`
  return `${h}\r\n\r\n${part('text/plain', text)}${part('text/html', html)}--${bd}--\r\n`
}

function smtpSend(msg, to) {
  return new Promise((ok, fail) => {
    const secure = SMTP.protocol === 'smtps:'
    const port = +SMTP.port || (secure ? 465 : 587)
    let sock = secure
      ? tls.connect({ host: SMTP.hostname, port, servername: SMTP.hostname })
      : net.connect({ host: SMTP.hostname, port })
    let buf = '',
      step = 0,
      caps = '',
      done = false,
      upgraded = secure
    const user = decodeURIComponent(SMTP.username || ''),
      pass = decodeURIComponent(SMTP.password || '')
    const end = (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sock.destroy()
      } catch {
        /* закрыт */
      }
      e ? fail(e) : ok()
    }
    const timer = setTimeout(() => end(new Error('SMTP: таймаут')), 20000)
    const w = (s) => sock.write(s + '\r\n')
    const seq = [] // очередь реакций на ответы
    const expect = (re, fn) => seq.push({ re, fn })
    const bind = () => {
      sock.setEncoding('utf8')
      sock.on('data', onData)
      sock.on('error', end)
      sock.on('close', () => end(new Error('SMTP: соединение закрыто')))
    }
    const onData = (d) => {
      buf += d
      for (;;) {
        const m = buf.match(/^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/)
        if (!m) return
        const block = m[0]
        buf = buf.slice(block.length)
        const code = +block.slice(0, 3)
        const cur = seq.shift()
        if (!cur) continue
        if (!cur.re.test(String(code))) return end(new Error('SMTP ' + block.trim().slice(0, 160)))
        cur.fn(block)
      }
    }
    const ehlo = () => {
      expect(/^250$/, (b) => {
        caps = b
        afterEhlo()
      })
      w('EHLO tetrafree.local')
    }
    const afterEhlo = () => {
      if (!upgraded && /STARTTLS/i.test(caps)) {
        expect(/^220$/, () => {
          sock.removeAllListeners('data')
          sock.removeAllListeners('close')
          sock.removeAllListeners('error')
          sock = tls.connect({ socket: sock, servername: SMTP.hostname }, () => {
            upgraded = true
            bind()
            ehlo()
          })
          sock.on('error', end)
        })
        return w('STARTTLS')
      }
      if (user) {
        if (/AUTH[^\r\n]*PLAIN/i.test(caps)) {
          expect(/^235$/, mail)
          return w('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'))
        }
        expect(/^334$/, () => {
          expect(/^334$/, () => {
            expect(/^235$/, mail)
            w(b64(pass))
          })
          w(b64(user))
        })
        return w('AUTH LOGIN')
      }
      mail()
    }
    const mail = () => {
      expect(/^250$/, () => {
        expect(/^25[01]$/, () => {
          expect(/^354$/, () => {
            expect(/^250$/, () => {
              w('QUIT')
              end()
            })
            sock.write(msg.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n')
          })
          w('DATA')
        })
        w(`RCPT TO:<${addr(to)}>`)
      })
      w(`MAIL FROM:<${addr(FROM)}>`)
    }
    expect(/^220$/, ehlo)
    bind()
    void step
  })
}

export const outbox = [] // dev-ящик
export async function sendMail({ to, subject, text, html }) {
  const rec = {
    id: crypto.randomBytes(6).toString('hex'),
    to,
    subject,
    text,
    at: Date.now(),
    status: SMTP ? 'queued' : 'dev',
  }
  if (!SMTP) {
    outbox.unshift(rec)
    outbox.length = Math.min(outbox.length, 40)
    console.log(`[mail:dev] → ${to} · ${subject}`)
    return rec
  }
  try {
    await smtpSend(build({ to, subject, text, html }), to)
    rec.status = 'sent'
  } catch (e) {
    rec.status = 'failed'
    rec.error = e.message
    console.error('[mail] ошибка отправки:', e.message)
    throw Object.assign(new Error('Не удалось отправить письмо: ' + e.message), { status: 502 })
  }
  return rec
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
/** единый шаблон: тёмная карточка, крупный код/кнопка */
export function tpl({ title, lines, code, button, foot }) {
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#0b0b10;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8ee"><div style="max-width:480px;margin:0 auto;padding:36px 24px"><div style="font-size:20px;font-weight:700;letter-spacing:-.01em;margin-bottom:22px">Tetra<span style="color:#a99bff">Free</span></div><div style="background:#14141c;border:1px solid #26263a;border-radius:16px;padding:28px"><h1 style="font-size:20px;margin:0 0 14px">${esc(title)}</h1>${lines.map((l) => `<p style="font-size:14px;line-height:1.6;color:#b9b9c9;margin:0 0 12px">${esc(l)}</p>`).join('')}${code ? `<div style="font-size:34px;letter-spacing:.3em;font-weight:700;font-family:ui-monospace,Menlo,monospace;background:#0b0b10;border-radius:12px;padding:16px;text-align:center;margin:18px 0;color:#fff">${esc(code)}</div>` : ''}${button ? `<a href="${esc(button.url)}" style="display:inline-block;background:#a99bff;color:#0b0b10;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;margin:8px 0">${esc(button.label)}</a><p style="font-size:12px;color:#77778a;word-break:break-all;margin:12px 0 0">${esc(button.url)}</p>` : ''}</div><p style="font-size:12px;color:#77778a;line-height:1.6;margin:18px 4px">${esc(foot || 'Если это были не вы — просто проигнорируйте письмо.')}</p></div></body></html>`
  const text = [
    title,
    '',
    ...lines,
    code ? '\nКод: ' + code : '',
    button ? `\n${button.label}: ${button.url}` : '',
    '',
    foot || 'Если это были не вы — просто проигнорируйте письмо.',
  ].join('\n')
  return { html, text }
}
