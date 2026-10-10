import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseConfig,
  resolve,
  winCommandLine,
  McpClient,
  flattenResult,
  createPool,
  mcpRoutes,
  configHash,
  approvals,
  readConfig,
  describe,
} from './mcp.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-mcp-'))

/* поддельный stdio-сервер MCP */
const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
console.log('баннер, не JSON')
rl.on('line', (l) => {
  const m = JSON.parse(l)
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake', version: '9' }, capabilities: { tools: {} } } })
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: m.params && m.params.cursor
    ? { tools: [{ name: 'boom', description: 'падает' }] }
    : { tools: [{ name: 'echo', description: 'эхо', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }], nextCursor: 'c2' } })
  if (m.method === 'tools/call') {
    if (m.params.name === 'echo') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'эхо: ' + m.params.arguments.text }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] } })
    if (m.params.name === 'boom') return send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'сломалось' }] } })
    if (m.params.name === 'die') process.exit(3)
    return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'нет такого инструмента' } })
  }
})
`
const fakeCfg = (dir) => {
  const f = path.join(dir, 'fake.cjs')
  fs.writeFileSync(f, FAKE)
  return { type: 'stdio', command: process.execPath, args: [f], env: {} }
}

test('конфиг: оба формата, ошибки по каждому серверу, disabled', () => {
  const r = parseConfig(
    JSON.stringify({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', 'x'], env: { A: '1' } },
        web: { url: 'https://e.com/mcp', headers: { Authorization: 'Bearer ${T}' } },
        'плохое имя': { command: 'x' },
        a: { command: 'x', args: 'нет' },
        b: { url: 'ftp://x' },
        c: {},
        d: { command: 'x', disabled: true },
      },
    }),
  )
  assert.deepEqual(Object.keys(r.servers).sort(), ['d', 'fs', 'web'])
  assert.equal(r.errors.length, 4)
  assert.equal(r.servers.d.disabled, true)
  assert.equal(parseConfig('{').servers && Object.keys(parseConfig('{').servers).length, 0)
  assert.match(parseConfig('{}').errors[0], /mcpServers/)
  assert.equal(Object.keys(parseConfig('{"servers":{"x":{"command":"c"}}}').servers)[0], 'x')
  assert.equal(describe(r.servers.fs), 'npx -y x')
})

test('${VAR} подставляется при запуске, значение по умолчанию работает', () => {
  const c = resolve(
    {
      type: 'http',
      url: 'https://e.com/${P:-mcp}',
      headers: { Authorization: 'Bearer ${TOK}', X: '${NOPE}' },
    },
    { TOK: 's3' },
  )
  assert.equal(c.url, 'https://e.com/mcp')
  assert.equal(c.headers.Authorization, 'Bearer s3')
  assert.equal(c.headers.X, '')
  assert.deepEqual(
    resolve({ type: 'stdio', command: 'c', args: ['${A}'], env: { K: '${A}' } }, { A: 'v' }).env,
    { K: 'v' },
  )
})

test('хеш одобрения меняется при любой правке конфига и папки', () => {
  const c = { type: 'stdio', command: 'a', args: [], env: {} }
  const h = configHash('/p', 'x', c)
  assert.equal(h, configHash('/p', 'x', { ...c }))
  assert.notEqual(h, configHash('/p', 'x', { ...c, command: 'b' }))
  assert.notEqual(h, configHash('/q', 'x', c))
  assert.notEqual(h, configHash('/p', 'y', c))
})

test('Windows: команда для cmd.exe экранируется', () => {
  assert.equal(winCommandLine('npx', ['-y', '@scope/pkg']), 'npx -y @scope/pkg')
  assert.equal(winCommandLine('npx', ['a b', 'c"d', '%PATH%']), 'npx "a b" "c""d" "%%PATH%%"')
})

test('stdio: рукопожатие, пагинация инструментов, вызов, ошибка инструмента, падение процесса', async () => {
  const dir = tmp()
  const c = new McpClient(fakeCfg(dir), { cwd: dir })
  try {
    await c.start()
    assert.equal(c.server.name, 'fake')
    const tools = await c.listTools()
    assert.deepEqual(
      tools.map((t) => t.name),
      ['echo', 'boom'],
    )
    const r = await c.callTool('echo', { text: 'привет' })
    assert.equal(r.text, 'эхо: привет')
    assert.equal(r.images[0], 'data:image/png;base64,AAAA')
    assert.deepEqual(await c.callTool('boom', {}), { text: 'сломалось', images: [], isError: true })
    await assert.rejects(c.callTool('nope', {}), /нет такого инструмента/)
    await assert.rejects(c.callTool('die', {}), /завершился \(код 3\)/)
  } finally {
    c.close()
  }
})

test('stdio: несуществующая команда — понятная ошибка', async () => {
  const c = new McpClient(
    { type: 'stdio', command: '/нет/такого/бинаря', args: [], env: {} },
    { cwd: os.tmpdir() },
  )
  await assert.rejects(c.start(), /Не удалось запустить/)
  c.close()
})

function httpServer(sse) {
  const seen = []
  const srv = http.createServer((req, res) => {
    let b = ''
    req.on('data', (d) => (b += d))
    req.on('end', () => {
      if (req.method === 'DELETE') return void res.writeHead(200).end()
      const m = JSON.parse(b)
      seen.push({ method: m.method, auth: req.headers.authorization, sid: req.headers['mcp-session-id'] })
      if (m.id === undefined) return void res.writeHead(202).end()
      const result =
        m.method === 'initialize'
          ? { protocolVersion: '2025-06-18', serverInfo: { name: 'h' } }
          : m.method === 'tools/list'
            ? { tools: [{ name: 'ping', description: 'p' }] }
            : { content: [{ type: 'text', text: 'pong ' + JSON.stringify(m.params.arguments) }] }
      const body = JSON.stringify({ jsonrpc: '2.0', id: m.id, result })
      const hdr = m.method === 'initialize' ? { 'mcp-session-id': 'S1' } : {}
      if (sse)
        res
          .writeHead(200, { 'content-type': 'text/event-stream', ...hdr })
          .end(
            `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${body}\n\n`,
          )
      else res.writeHead(200, { 'content-type': 'application/json', ...hdr }).end(body)
    })
  })
  return { srv, seen }
}

for (const sse of [false, true])
  test(`HTTP-транспорт (${sse ? 'SSE' : 'JSON'}): сессия, заголовки, вызов`, async () => {
    const { srv, seen } = httpServer(sse)
    await new Promise((r) => srv.listen(0, '127.0.0.1', r))
    const c = new McpClient({
      type: 'http',
      url: `http://127.0.0.1:${srv.address().port}/mcp`,
      headers: { authorization: 'Bearer T' },
    })
    try {
      await c.start()
      assert.equal((await c.listTools())[0].name, 'ping')
      assert.equal((await c.callTool('ping', { a: 1 })).text, 'pong {"a":1}')
      assert.ok(seen.every((s) => s.auth === 'Bearer T'))
      assert.equal(seen.at(-1).sid, 'S1')
      assert.ok(seen.some((s) => s.method === 'notifications/initialized'))
    } finally {
      c.close()
      srv.close()
    }
  })

test('flattenResult: текст, ресурсы, структурный ответ, обрезка', () => {
  assert.equal(
    flattenResult({
      content: [
        { type: 'text', text: 'a' },
        { type: 'resource', resource: { uri: 'x', text: 'b' } },
      ],
    }).text,
    'a\nb',
  )
  assert.match(flattenResult({ structuredContent: { k: 1 } }).text, /"k": 1/)
  assert.ok(
    flattenResult({ content: [{ type: 'text', text: 'x'.repeat(70000) }] }).text.endsWith('(обрезано)'),
  )
})

test('маршруты: без «Разрешить» ничего не запускается, после — работает, отзыв останавливает', async () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.tetra'))
  const cfg = fakeCfg(dir)
  fs.writeFileSync(
    path.join(dir, '.tetra/mcp.json'),
    JSON.stringify({ mcpServers: { fake: { command: cfg.command, args: cfg.args } } }),
  )
  const pool = createPool()
  const approvalsFile = path.join(dir, 'ap.json')
  const call = async (url, body) => {
    let code, data
    const io = {
      json: (_r, c, o) => ((code = c), (data = o)),
      readBody: async () => body,
      projectDir: async () => dir,
    }
    await mcpRoutes({ method: 'POST' }, {}, new URL('http://x' + url), io, { approvalsFile, pool })
    return { code, data }
  }
  try {
    let r = await call('/api/mcp/status', {})
    assert.equal(r.data.servers[0].approved, false)
    assert.equal(r.data.file, '.tetra/mcp.json')
    r = await call('/api/mcp/tools', { server: 'fake' })
    assert.equal(r.code, 403)
    assert.equal(pool.pool.size, 0, 'процесс не должен стартовать без разрешения')
    assert.equal((await call('/api/mcp/tools', { server: 'нет' })).code, 404)
    await call('/api/mcp/approve', { server: 'fake' })
    r = await call('/api/mcp/tools', { server: 'fake' })
    assert.equal(r.code, 200)
    assert.equal(r.data.tools[0].readOnly, true)
    r = await call('/api/mcp/call', { server: 'fake', tool: 'echo', args: { text: 'x' } })
    assert.equal(r.data.text, 'эхо: x')
    assert.equal((await call('/api/mcp/status', {})).data.servers[0].running, true)
    /* правка команды сбрасывает разрешение */
    fs.writeFileSync(
      path.join(dir, '.tetra/mcp.json'),
      JSON.stringify({ mcpServers: { fake: { command: cfg.command, args: [...cfg.args, '--evil'] } } }),
    )
    assert.equal((await call('/api/mcp/tools', { server: 'fake' })).code, 403)
    fs.writeFileSync(
      path.join(dir, '.tetra/mcp.json'),
      JSON.stringify({ mcpServers: { fake: { command: cfg.command, args: cfg.args } } }),
    )
    await call('/api/mcp/approve', { server: 'fake', approved: false })
    assert.equal(pool.pool.size, 0)
    assert.equal((await call('/api/mcp/call', { server: 'fake', tool: 'echo' })).code, 403)
    assert.equal(readConfig(dir).errors.length, 0)
    assert.equal(approvals(approvalsFile).has('x'), false)
  } finally {
    pool.closeAll()
  }
})
