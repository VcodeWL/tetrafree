import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createVault } from './secrets.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-vault-'))

test('файловый режим: запись, чтение после перезапуска, удаление', async () => {
  const dir = tmp()
  const a = createVault({ dir, win: false })
  await a.set('p1', 'sk-секрет-123')
  await a.set('p2', 'sk-other')
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')
  assert.ok(!raw.includes('sk-секрет') && !raw.includes('sk-other'), 'в файле нет открытого текста')
  const b = createVault({ dir, win: false })
  assert.deepEqual(await b.list(), { p1: 'sk-секрет-123', p2: 'sk-other' })
  await b.remove('p1')
  assert.deepEqual(await createVault({ dir, win: false }).list(), { p2: 'sk-other' })
})

test('перезапись значения и отказ на плохих данных', async () => {
  const v = createVault({ dir: tmp(), win: false })
  await v.set('x', 'one')
  await v.set('x', 'two')
  assert.equal((await v.list()).x, 'two')
  await assert.rejects(v.set('../evil', 'v'))
  await assert.rejects(v.set('ok', ''))
  await assert.rejects(v.set('ok', 'a'.repeat(5000)))
})

test('повреждённая запись пропускается, остальные читаются', async () => {
  const dir = tmp()
  const v = createVault({ dir, win: false })
  await v.set('a', 'AAA')
  await v.set('b', 'BBB')
  const f = path.join(dir, 'secrets.json')
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  j.items.a = Buffer.from('мусор мусор мусор мусор мусор мусор').toString('base64')
  fs.writeFileSync(f, JSON.stringify(j))
  assert.deepEqual(await createVault({ dir, win: false }).list(), { b: 'BBB' })
})

test('режим Windows: данные идут в PowerShell, на диск попадает только шифртекст', async () => {
  const dir = tmp()
  const calls = []
  /* поддельный DPAPI: «шифрует» разворотом строки */
  const run = async (script, data) => {
    calls.push(script.includes('-AsPlainText') ? 'enc' : 'dec')
    const o = {}
    for (const [k, val] of Object.entries(data))
      o[k] = script.includes('-AsPlainText')
        ? 'DP:' + [...val].reverse().join('')
        : [...val.slice(3)].reverse().join('')
    return o
  }
  const v = createVault({ dir, win: true, run })
  assert.equal(v.mode, 'dpapi')
  await v.set('k1', 'secret-key')
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')
  assert.ok(!raw.includes('secret-key') && raw.includes('DP:'))
  const v2 = createVault({ dir, win: true, run })
  assert.deepEqual(await v2.list(), { k1: 'secret-key' })
  assert.deepEqual(calls, ['enc', 'dec'])
})

test('ошибка записи откатывает значение в памяти', async () => {
  let fail = false
  const run = async (script, data) => {
    if (fail && script.includes('-AsPlainText')) throw new Error('powershell упал')
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, 'E' + v]))
  }
  const v = createVault({ dir: tmp(), win: true, run })
  await v.set('a', '1')
  fail = true
  await assert.rejects(v.set('b', '2'))
  assert.deepEqual(Object.keys(await v.list()), ['a'])
})
