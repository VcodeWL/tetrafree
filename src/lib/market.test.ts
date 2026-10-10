import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  safePath,
  planInstall,
  planRemove,
  readInstalled,
  bundledItems,
  matchItems,
  registryPack,
  slugName,
  rankSkillDirs,
  pickSkillFiles,
  MARKET_FILE,
  type RegServer,
} from './market'
import { BUNDLED } from '../data/market'
import { parseFrontmatter, listSkills, listCustom, BUILTIN_NAMES } from '../agent/slash'

const items = bundledItems()
const get = (k: string) => items.find((i) => i.key === k)!

test('safePath: только .tetra/skills и .tetra/commands, без выхода наверх', () => {
  assert.ok(safePath('.tetra/skills/a/SKILL.md'))
  assert.ok(safePath('.tetra/commands/fix.md'))
  for (const bad of [
    '.tetra/skills/../../x',
    '.tetra/skills/a/../b',
    '/etc/passwd',
    'src/a.ts',
    '.tetra/mcp.json',
    '.tetra/skills/a\\b',
    '.tetra/skills/.git/x',
    '.tetra/skills/a/b ',
  ])
    assert.equal(safePath(bad), false, bad)
})

test('встроенный каталог: всё валидно и читается движком команд и навыков', () => {
  const files: Record<string, string> = {}
  for (const b of BUNDLED) Object.assign(files, b.files)
  for (const p of Object.keys(files)) assert.ok(safePath(p), p)
  const skills = listSkills(files)
  const cmds = listCustom(files)
  for (const b of BUNDLED.filter((x) => x.kind === 'skill')) {
    const s = skills.find((x) => x.name === b.id)
    assert.ok(s, 'навык ' + b.id)
    assert.ok(s!.description.length > 20)
    assert.ok(s!.body.length > 200)
  }
  for (const b of BUNDLED.filter((x) => x.kind === 'command')) {
    assert.ok(!BUILTIN_NAMES.has(b.id), 'не перекрывает встроенную /' + b.id)
    const c = cmds.find((x) => x.name === b.id)
    assert.ok(c, 'команда ' + b.id)
    assert.ok(parseFrontmatter(Object.values(b.files!)[0]).meta.description)
  }
  for (const b of BUNDLED.filter((x) => x.kind === 'bundle'))
    for (const k of b.parts!) assert.ok(get(k), `${b.id}: нет части ${k}`)
  const keys = items.map((i) => i.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('установка навыка: запись файлов и учёт', () => {
  const it = get('skill:debugging')
  const plan = planInstall(it, it.pack!, {}, [])
  assert.equal(plan.error, undefined)
  assert.deepEqual(plan.conflicts, [])
  assert.ok(plan.write['.tetra/skills/debugging/SKILL.md'])
  const rec = readInstalled(plan.write[MARKET_FILE])
  assert.equal(rec.length, 1)
  assert.deepEqual(rec[0].files, ['.tetra/skills/debugging/SKILL.md'])
})

test('установка MCP: добавляет в конфиг, сохраняя чужие серверы; удаление убирает только своё', () => {
  const it = get('mcp:memory')
  const cfg = JSON.stringify({ mcpServers: { mine: { command: 'x' } } })
  const files: Record<string, string> = { '.tetra/mcp.json': cfg }
  const plan = planInstall(it, it.pack!, files, [])
  const j = JSON.parse(plan.write['.tetra/mcp.json'])
  assert.ok(j.mcpServers.mine && j.mcpServers.memory)
  const after = { ...files, ...plan.write }
  const rm = planRemove(it.key, after, readInstalled(after[MARKET_FILE]))
  const j2 = JSON.parse(rm.write['.tetra/mcp.json'])
  assert.ok(j2.mcpServers.mine)
  assert.equal(j2.mcpServers.memory, undefined)
  assert.deepEqual(readInstalled(rm.write[MARKET_FILE]), [])
})

test('конфликты: чужой файл и чужой MCP с тем же именем; своё обновление — не конфликт', () => {
  const it = get('command:fix')
  const path = '.tetra/commands/fix.md'
  assert.deepEqual(planInstall(it, it.pack!, { [path]: 'моя команда' }, []).conflicts, [path])
  const first = planInstall(it, it.pack!, {}, [])
  const files = { [path]: 'старая версия', [MARKET_FILE]: first.write[MARKET_FILE] }
  assert.deepEqual(planInstall(it, it.pack!, files, readInstalled(files[MARKET_FILE])).conflicts, [])
  const mem = get('mcp:memory')
  const c = planInstall(
    mem,
    mem.pack!,
    { '.tetra/mcp.json': '{"mcpServers":{"memory":{"command":"z"}}}' },
    [],
  )
  assert.deepEqual(c.conflicts, ['MCP «memory»'])
})

test('повреждённый конфиг MCP — ошибка, а не потеря данных', () => {
  const it = get('mcp:memory')
  const p = planInstall(it, it.pack!, { '.tetra/mcp.json': '{oops' }, [])
  assert.ok(p.error)
  assert.deepEqual(p.write, {})
})

test('набор: ставит все части; удаление не трогает общее с другим установленным', () => {
  const b = get('bundle:quality')
  const plan = planInstall(b, b.pack!, {}, [])
  assert.ok(plan.write['.tetra/skills/code-review/SKILL.md'] && plan.write['.tetra/commands/fix.md'])
  const fix = get('command:fix')
  const files1 = { ...plan.write }
  const p2 = planInstall(fix, fix.pack!, files1, readInstalled(files1[MARKET_FILE]))
  const files2 = { ...files1, ...p2.write }
  const rm = planRemove(b.key, files2, readInstalled(files2[MARKET_FILE]))
  assert.ok(!rm.remove.includes('.tetra/commands/fix.md'), 'fix общий с отдельной установкой')
  assert.ok(rm.remove.includes('.tetra/skills/debugging/SKILL.md'))
})

test('readInstalled отбрасывает записи с опасными путями и мусор', () => {
  const t = JSON.stringify({
    items: [
      { key: 'a', kind: 'skill', id: 'a', name: 'a', source: '', files: ['../../x'], mcp: [], at: 1 },
      {
        key: 'b',
        kind: 'skill',
        id: 'b',
        name: 'b',
        source: '',
        files: ['.tetra/skills/b/SKILL.md'],
        mcp: [],
        at: 1,
      },
      null,
      5,
    ],
  })
  assert.deepEqual(
    readInstalled(t).map((x) => x.key),
    ['b'],
  )
  assert.deepEqual(readInstalled('не json'), [])
})

test('поиск по каталогу: все слова и фильтр по виду', () => {
  assert.ok(matchItems(items, 'память', 'all').length >= 1)
  assert.ok(matchItems(items, 'ревью код', 'all').some((i) => i.id === 'code-review'))
  assert.ok(matchItems(items, '', 'mcp').every((i) => i.kind === 'mcp'))
  assert.equal(matchItems(items, 'абракадабра', 'all').length, 0)
})

test('реестр MCP: npm → npx с переменными окружения через ${…}', () => {
  const s: RegServer = {
    name: 'io.github.acme/cool',
    packages: [
      {
        registryType: 'npm',
        identifier: '@acme/cool',
        version: '1.2.3',
        transport: { type: 'stdio' },
        environmentVariables: [{ name: 'API_KEY', isRequired: true, isSecret: true, description: 'ключ' }],
      },
    ],
  }
  const r = registryPack(s).pack!
  assert.deepEqual(r.mcp['acme-cool'], {
    command: 'npx',
    args: ['-y', '@acme/cool@1.2.3'],
    env: { API_KEY: '${API_KEY}' },
  })
  assert.deepEqual(r.env, [{ name: 'API_KEY', desc: 'ключ', secret: true }])
  assert.ok(!JSON.stringify(r.mcp).includes('sk-'))
})

test('реестр MCP: удалённый сервер, заголовок Bearer, SSE и пустые варианты', () => {
  const rem = registryPack({
    name: 'ai.korely/memory',
    remotes: [
      {
        type: 'streamable-http',
        url: 'https://api.korely.ai/agent/mcp',
        headers: [
          { name: 'Authorization', description: 'Bearer kor_live_...', isRequired: true, isSecret: true },
        ],
      },
    ],
  }).pack!
  assert.deepEqual(rem.mcp['korely-memory'], {
    url: 'https://api.korely.ai/agent/mcp',
    headers: { Authorization: 'Bearer ${KORELY_MEMORY_AUTHORIZATION}' },
  })
  assert.equal(rem.env[0].name, 'KORELY_MEMORY_AUTHORIZATION')
  assert.ok(registryPack({ name: 'a/b', remotes: [{ type: 'sse', url: 'https://x.y/sse' }] }).blocked)
  assert.ok(registryPack({ name: 'a/b' }).blocked)
  assert.ok(
    registryPack({ name: 'a/b', remotes: [{ type: 'streamable-http', url: 'https://{tenant}.x.y/mcp' }] })
      .blocked,
  )
  const sub = registryPack({
    name: 'a/b',
    remotes: [{ type: 'streamable-http', url: 'https://{r}.x.y/mcp', variables: { r: { default: 'eu' } } }],
  }).pack!
  assert.equal((sub.mcp['a-b'] as { url: string }).url, 'https://eu.x.y/mcp')
})

test('реестр MCP: PyPI → uvx, OCI → docker, обязательный аргумент без значения — заметка', () => {
  const py = registryPack({
    name: 'x/y',
    packages: [{ registryType: 'pypi', identifier: 'mcp-y', version: '1.0', runtimeHint: 'uvx' }],
  }).pack!
  assert.deepEqual(py.mcp['x-y'], { command: 'uvx', args: ['mcp-y==1.0'] })
  const oci = registryPack({
    name: 'x/z',
    packages: [{ registryType: 'oci', identifier: 'ghcr.io/x/z:1', environmentVariables: [{ name: 'T' }] }],
  }).pack!
  assert.deepEqual(oci.mcp['x-z'], {
    command: 'docker',
    args: ['run', '-i', '--rm', '-e', 'T', 'ghcr.io/x/z:1'],
    env: { T: '${T}' },
  })
  const arg = registryPack({
    name: 'x/w',
    packages: [
      {
        registryType: 'npm',
        identifier: 'w',
        packageArguments: [{ type: 'positional', isRequired: true, valueHint: 'папка' }],
      },
    ],
  }).pack!
  assert.ok(arg.notes.some((n) => n.includes('папка')))
})

test('slugName даёт допустимое имя сервера', () => {
  for (const n of ['io.github.User/Repo.Name', 'ai.x/y z', 'com.ex/' + 'a'.repeat(80), '///'])
    assert.match(slugName(n), /^[\w.-]{1,40}$/, n)
  assert.equal(slugName('io.github.acme/cool'), 'acme-cool')
})

test('rankSkillDirs: совпадение имени папки первым, мусор отброшен', () => {
  const paths = [
    'README.md',
    'skills/other/SKILL.md',
    'skills/tdd/SKILL.md',
    'node_modules/x/SKILL.md',
    'a/b/tdd/SKILL.md',
    'SKILL.md',
  ]
  assert.deepEqual(rankSkillDirs(paths, 'tdd'), ['a/b/tdd', 'skills/tdd', 'skills/other', ''])
})

test('pickSkillFiles: текст и небольшие файлы, лимиты, бинарные пропускаются', () => {
  const tree = [
    { path: 's/tdd/SKILL.md', type: 'blob', size: 1000 },
    { path: 's/tdd/references/a.md', type: 'blob', size: 2000 },
    { path: 's/tdd/logo.png', type: 'blob', size: 500 },
    { path: 's/tdd/big.md', type: 'blob', size: 900000 },
    { path: 's/tdd/references', type: 'tree' },
    { path: 's/other/x.md', type: 'blob', size: 10 },
  ]
  const r = pickSkillFiles(tree, 's/tdd')
  assert.deepEqual(r.take, ['SKILL.md', 'references/a.md'])
  assert.deepEqual(r.skipped.sort(), ['big.md', 'logo.png'])
})
