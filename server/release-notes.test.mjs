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

import { versionFromTag, applyVersion } from '../scripts/release-notes.mjs'

test('версия из тега: v, V, v. и без префикса; мусор отклоняется', () => {
  assert.equal(versionFromTag('v3.0.2'), '3.0.2')
  assert.equal(versionFromTag('v.3.0.2'), '3.0.2')
  assert.equal(versionFromTag('V3.1.0'), '3.1.0')
  assert.equal(versionFromTag('3.1.0'), '3.1.0')
  assert.equal(versionFromTag('v4.0.0-beta.1'), '4.0.0-beta.1')
  assert.equal(versionFromTag('release-1'), null)
  assert.equal(versionFromTag('v3.0'), null)
})

test('версия из тега подставляется в три файла, остальное не трогается', () => {
  const out = applyVersion(
    {
      'package.json': '{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": {"a": "1.0.0"}\n}',
      'src-tauri/tauri.conf.json': '{ "productName": "T", "version": "1.0.0" }',
      'src-tauri/Cargo.toml':
        '[package]\nname = "t"\nversion = "1.0.0"\n[dependencies]\na = { version = "1.0.0" }',
    },
    '3.2.1',
  )
  assert.match(out['package.json'], /"version": "3\.2\.1"/)
  assert.match(out['package.json'], /"a": "1\.0\.0"/)
  assert.match(out['src-tauri/tauri.conf.json'], /"version": "3\.2\.1"/)
  assert.match(out['src-tauri/Cargo.toml'], /^version = "3\.2\.1"/m)
  assert.match(out['src-tauri/Cargo.toml'], /a = \{ version = "1\.0\.0" \}/)
})
