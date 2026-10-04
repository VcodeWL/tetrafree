/* Каждый серверный модуль, который импортируется из ./, должен лежать в resources установщика —
   иначе встроенный сервер в собранном приложении падает при старте (так было в 2.0–2.2 с folders/ignore). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const res = new Set(Object.keys(conf.bundle.resources).map((k) => k.replace('../server/', '')))
const dir = new URL('./', import.meta.url)

test('все импортируемые модули сервера входят в установщик', () => {
  const need = new Set(['tetra-server.mjs'])
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.includes('.test.'))) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    for (const m of src.matchAll(/from '\.\/([\w-]+\.mjs)'/g)) need.add(m[1])
  }
  for (const n of need) assert.ok(res.has(n), `${n} не добавлен в bundle.resources`)
})

test('node подключён как sidecar', () => {
  assert.deepEqual(conf.bundle.externalBin, ['binaries/node'])
})
