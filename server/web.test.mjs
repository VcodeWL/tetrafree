import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  isPrivateIp,
  checkUrl,
  htmlToText,
  parseDdg,
  browserCandidates,
  findBrowser,
  shotArgs,
  takeShot,
  webFetch,
  httpGet,
} from './web.mjs'

test('приватные адреса распознаются', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '172.16.0.1',
    '172.31.255.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
    '224.0.0.1',
  ])
    assert.ok(isPrivateIp(ip), ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700::1111'])
    assert.ok(!isPrivateIp(ip), ip)
})

test('checkUrl: схемы, логины, локальные имена', () => {
  assert.equal(checkUrl('https://example.com/a?b=1').hostname, 'example.com')
  for (const bad of [
    'file:///etc/passwd',
    'ftp://x.y',
    'http://user:pw@example.com',
    'http://127.0.0.1:3001/api',
    'http://localhost/',
    'http://[::1]/',
    'http://192.168.1.1',
    'http://printer.local/',
    'не адрес',
  ])
    assert.throws(() => checkUrl(bad), undefined, bad)
})

test('htmlToText: заголовки, списки, ссылки, без скриптов', () => {
  const t = htmlToText(
    '<html><head><title>Док &amp; гайд</title><style>a{}</style></head><body><nav>меню</nav><h1>Привет</h1><p>Текст <a href="/x">ссылка</a></p><ul><li>раз</li><li>два</li></ul><script>alert(1)</script></body></html>',
    'https://e.com/doc/',
  )
  assert.match(t, /^# Док & гайд/)
  assert.match(t, /# Привет/)
  assert.match(t, /\[ссылка\]\(https:\/\/e\.com\/x\)/)
  assert.match(t, /- раз\n- два/)
  assert.ok(!/alert|меню/.test(t))
})

test('parseDdg: прямые и редиректные ссылки, сниппеты', () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvite.dev%2Fguide%2F&rut=1">Vite <b>Guide</b></a>
  <a class="result__snippet" href="x">Быстрый &amp; простой</a>
  <a class="result__a" href="https://react.dev/">React</a><a class="result__snippet" href="y">UI</a>
  <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Реклама</a>`
  const r = parseDdg(html)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], {
    title: 'Vite Guide',
    url: 'https://vite.dev/guide/',
    snippet: 'Быстрый & простой',
  })
  assert.equal(r[1].url, 'https://react.dev/')
})

test('браузер: кандидаты по платформам, TF_BROWSER первым', () => {
  const w = browserCandidates('win32', {
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramFiles: 'C:\\Program Files',
  })
  assert.ok(w.some((p) => /msedge\.exe$/.test(p)) && w.some((p) => /chrome\.exe$/.test(p)))
  assert.equal(browserCandidates('linux', { TF_BROWSER: '/x/br' })[0], '/x/br')
  assert.equal(
    findBrowser(() => false, 'linux', {}),
    null,
  )
  assert.equal(
    findBrowser((p) => p === '/usr/bin/chromium', 'linux', {}),
    '/usr/bin/chromium',
  )
  const a = shotArgs({ profile: '/p' })
  assert.ok(a.includes('--remote-debugging-pipe') && a.includes('--user-data-dir=/p'))
})

test('скриншот: чужие адреса и отсутствие браузера отклоняются', async () => {
  await assert.rejects(
    takeShot('https://example.com/', { exe: '/x' }),
    /только для страниц на этом компьютере/,
  )
  await assert.rejects(takeShot('http://10.0.0.1/', { exe: '/x' }), /только для страниц/)
  await assert.rejects(takeShot('http://127.0.0.1:1/', { exe: null }), /Не нашёл браузер/)
})

test('fetch: наружу ходим, во внутреннюю сеть — нет; редирект и размер', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/r') return void res.writeHead(302, { location: '/p' }).end()
    if (req.url === '/big')
      return void res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(3 * 1024 * 1024))
    if (req.url === '/bin') return void res.writeHead(200, { 'content-type': 'image/png' }).end('x')
    res.writeHead(200, { 'content-type': 'text/html' }).end('<title>T</title><h1>Привет</h1>')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  try {
    await assert.rejects(webFetch(base + '/p'), /внутренней сети/)
    await assert.rejects(httpGet(base + '/p'), /внутренней сети/)
    const r = await webFetch(base + '/r', true)
    assert.match(r.text, /# T[\s\S]*# Привет/)
    await assert.rejects(webFetch(base + '/big', true), /больше 2 МБ/)
    await assert.rejects(webFetch(base + '/bin', true), /не текст/)
  } finally {
    srv.close()
  }
})

test('скриншот настоящим браузером (если он есть на машине)', { skip: !findBrowser() }, async () => {
  const srv = http.createServer((q, r) =>
    r
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<body style="margin:0;background:#123456"><div style="height:1500px"></div></body>'),
  )
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const img = await takeShot('http://127.0.0.1:' + srv.address().port + '/', { width: 640, height: 480 })
    const png = Buffer.from(img.split(',')[1], 'base64')
    assert.equal(png.readUInt32BE(16), 640)
    assert.equal(png.readUInt32BE(20), 480)
    const full = Buffer.from(
      (
        await takeShot('http://127.0.0.1:' + srv.address().port + '/', {
          width: 640,
          height: 480,
          full: true,
        })
      ).split(',')[1],
      'base64',
    )
    assert.equal(full.readUInt32BE(20), 1500)
  } finally {
    srv.close()
  }
})
