import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { section, versions } from '../scripts/release-notes.mjs'

test('section: берёт только нужную версию', () => {
  const md = '# T\n\n## 2.0.1 «A» — x\n\n- a\n- b\n\n## 2.0.0 «B»\n\n- c\n'
  assert.equal(section(md, '2.0.1'), '- a\n- b')
  assert.equal(section(md, '2.0.0'), '- c')
  assert.equal(section(md, '2.0'), null)
  assert.equal(section(md, '9.9.9'), null)
})
test('версии в трёх файлах совпадают, и для неё есть раздел в CHANGELOG.md', () => {
  const v = Object.values(versions())
  assert.equal(new Set(v).size, 1, JSON.stringify(versions()))
  assert.ok(section(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), v[0]))
})
