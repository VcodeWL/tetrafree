import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, mcpDenied, mcpAction } from './mcptool'
import { mcpSection, type McpAvail, type McpTool } from '../lib/mcp'
import { splitCommand, parseKv, addServer, removeServer, buildCfg, configPath } from '../lib/mcpconfig'

const tool = (name: string, readOnly = false): McpTool => ({
  name,
  description: 'Делает ' + name,
  inputSchema: {
    properties: { path: { type: 'string' }, n: { type: ['number', 'null'] } },
    required: ['path'],
  },
  readOnly,
})
const av: McpAvail = { tools: { fs: [tool('read', true), tool('write')] }, notes: { bad: 'не запустился' } }
const proj = { id: 'p', name: 'p', files: {} }

test('аргументы: пусто, объект, не JSON, не объект', () => {
  assert.deepEqual(parseArgs('  '), { args: {} })
  assert.deepEqual(parseArgs('{"a":1}'), { args: { a: 1 } })
  assert.match(parseArgs('{a:1}').error!, /не JSON/)
  assert.match(parseArgs('[1]').error!, /JSON-объектом/)
})

test('права по уровням автономности', () => {
  assert.ok(mcpDenied('Эскалация', tool('x', true)))
  assert.ok(mcpDenied('Спросить', tool('x')))
  assert.equal(mcpDenied('Спросить', tool('x', true)), null)
  assert.equal(mcpDenied('Уведомить', tool('x')), null)
  assert.equal(mcpDenied('Тихо', undefined), null)
})

test('вызов: ошибки для модели и успешный путь', async () => {
  const ok = async () => ({ text: 'содержимое', images: ['data:image/png;base64,AA'], isError: false })
  assert.match((await mcpAction(proj, 'Уведомить', av, 'nope', 'x', '', ok)).text, /недоступен/)
  assert.match((await mcpAction(proj, 'Уведомить', av, 'bad', 'x', '', ok)).text, /не запустился/)
  assert.match((await mcpAction(proj, 'Уведомить', av, 'fs', 'zzz', '', ok)).text, /есть: read, write/)
  assert.match((await mcpAction(proj, 'Спросить', av, 'fs', 'write', '{}', ok)).text, /только чтение/)
  assert.match((await mcpAction(proj, 'Уведомить', av, 'fs', 'read', '{bad', ok)).text, /не JSON/)
  const r = await mcpAction(proj, 'Спросить', av, 'fs', 'read', '{"path":"a"}', ok)
  assert.ok(r.ok && /содержимое/.test(r.text) && r.images?.length === 1)
  const e = await mcpAction(proj, 'Тихо', av, 'fs', 'read', '{}', async () => {
    throw new Error('упало')
  })
  assert.ok(!e.ok && /упало/.test(e.text))
  const t = await mcpAction(proj, 'Тихо', av, 'fs', 'read', '{}', async () => ({
    text: 'нет файла',
    images: [],
    isError: true,
  }))
  assert.ok(!t.ok && /вернул ошибку/.test(t.text))
})

test('раздел системной инструкции: инструменты, аргументы, заметки, пусто', () => {
  const s = mcpSection(av)
  assert.match(s, /- fs\.read \[только чтение\]: Делает read · аргументы: path\*:string, n:number\|null/)
  assert.match(s, /<mcp server="имя"/)
  assert.match(s, /сервер MCP «bad» недоступен: не запустился/)
  assert.equal(mcpSection({ tools: {}, notes: {} }), '')
  assert.match(mcpSection(av, 400), /скрыты/)
})

test('конфиг: слова с кавычками, KEY=VALUE, добавление и удаление без потерь', () => {
  assert.deepEqual(splitCommand('npx -y "@a/b c" \'x y\''), ['npx', '-y', '@a/b c', 'x y'])
  assert.deepEqual(parseKv('A=1\n# c\n\nB: два\nплохо'), { obj: { A: '1', B: 'два' }, errors: ['плохо'] })
  const t1 = addServer(undefined, 'mem', { command: 'npx', args: ['-y', 'm'] })
  const t2 = addServer(t1, 'web', { url: 'https://e.com' })
  assert.deepEqual(Object.keys(JSON.parse(t2).mcpServers), ['mem', 'web'])
  assert.deepEqual(Object.keys(JSON.parse(removeServer(t2, 'mem')).mcpServers), ['web'])
  assert.equal(
    JSON.parse(addServer('{"servers":{"a":{"command":"x"}},"extra":1}', 'b', { command: 'y' })).extra,
    1,
  )
  assert.ok('servers' in JSON.parse(addServer('{"servers":{}}', 'b', { command: 'y' })))
  assert.throws(() => addServer('{сломан', 'x', { command: 'y' }), /повреждён/)
  assert.throws(() => addServer(undefined, 'плохое имя', { command: 'y' }), /Имя/)
  assert.equal(configPath({ '.mcp.json': '{}' }), '.mcp.json')
  assert.equal(configPath({}), '.tetra/mcp.json')
  assert.deepEqual(buildCfg('cmd', 'npx -y pkg', 'K=v').cfg, {
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { K: 'v' },
  })
  assert.ok(buildCfg('cmd', '  ', '').error)
  assert.ok(buildCfg('http', 'ftp://x', '').error)
  assert.deepEqual(buildCfg('http', 'https://e.com/mcp', 'Authorization=Bearer ${T}').cfg, {
    url: 'https://e.com/mcp',
    headers: { Authorization: 'Bearer ${T}' },
  })
})
