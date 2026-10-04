import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptsOf, pkgManager } from './scripts'

const pkg = JSON.stringify({
  scripts: { dev: 'vite', test: 'node --test', start: 'node .', 'bad name': 'x', n: 5 },
})
test('npm', () =>
  assert.deepEqual(
    scriptsOf({ 'package.json': pkg }).map((s) => s.cmd),
    ['npm run dev', 'npm test', 'npm start'],
  ))
test('pnpm по lock-файлу', () => {
  const f = { 'package.json': pkg, 'pnpm-lock.yaml': '' }
  assert.equal(pkgManager(f), 'pnpm')
  assert.equal(scriptsOf(f)[0].cmd, 'pnpm dev')
})
test('битый json и нет scripts', () => {
  assert.deepEqual(scriptsOf({ 'package.json': '{' }), [])
  assert.deepEqual(scriptsOf({ 'package.json': '{}' }), [])
  assert.deepEqual(scriptsOf({}), [])
})
