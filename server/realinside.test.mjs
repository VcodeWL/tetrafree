import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-root-'))
const { realInside } = await import('./tetra-server.mjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-ri-'))
const proj = path.join(tmp, 'proj')
const outside = path.join(tmp, 'outside')
fs.mkdirSync(proj)
fs.mkdirSync(outside)
fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
let canLink = true
try {
  fs.symlinkSync(outside, path.join(proj, 'link'), 'junction')
} catch {
  canLink = false /* Windows без прав на ссылки */
}

test('обычные пути внутри проекта проходят, в том числе ещё не существующие', async () => {
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
  await realInside(proj, path.join(proj, 'src', 'a.ts'))
  await realInside(proj, path.join(proj, 'new', 'deep', 'x.ts'))
  await realInside(proj, path.join(proj, 'file.txt'))
})

test('ссылка на папку вне проекта: запись и чтение через неё отклоняются', { skip: !canLink }, async () => {
  await assert.rejects(realInside(proj, path.join(proj, 'link', 'x.txt')), /за пределы/)
  await assert.rejects(realInside(proj, path.join(proj, 'link', 'secret.txt')), /за пределы/)
  await assert.rejects(realInside(proj, path.join(proj, 'link', 'a', 'b.txt')), /за пределы/)
})
