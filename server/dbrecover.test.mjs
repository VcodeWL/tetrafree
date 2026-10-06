import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

test('повреждённый db.json не затирается молча: рядом остаётся копия', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-db-'))
  fs.writeFileSync(path.join(dir, 'db.json'), '{"users": {"a": ')
  execFileSync(process.execPath, ['-e', "import('./server/auth.mjs')"], {
    env: { ...process.env, TF_DATA: dir },
    stdio: 'ignore',
  })
  const copies = fs.readdirSync(dir).filter((f) => f.startsWith('db.json.broken-'))
  assert.equal(copies.length, 1)
  assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), '{"users": {"a": ')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('первый запуск без db.json копий не создаёт', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-db-'))
  execFileSync(process.execPath, ['-e', "import('./server/auth.mjs')"], {
    env: { ...process.env, TF_DATA: dir },
    stdio: 'ignore',
  })
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.includes('broken')),
    [],
  )
  fs.rmSync(dir, { recursive: true, force: true })
})
