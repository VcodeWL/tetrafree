import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONPTY_CS, conPtySupported } from './conpty-win.mjs'

test('ConPTY поддерживается с Windows 10 1809 (сборка 17763)', () => {
  assert.equal(conPtySupported('10.0.17763'), true)
  assert.equal(conPtySupported('10.0.22631'), true)
  assert.equal(conPtySupported('10.0.17134'), false)
  assert.equal(conPtySupported('6.1.7601'), false)
})

test('исходник помощника: скобки сбалансированы, нет синтаксиса новее C# 5 (csc из .NET Framework 4)', () => {
  const code = CONPTY_CS.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\*.*?\*\//g, '')
  for (const [o, c] of ['{}', '()', '[]']) {
    assert.equal(code.split(o).length, code.split(c).length, `скобки ${o}${c}`)
  }
  assert.ok(!/\$"|\?\.|\bout var\b|=>|\bnameof\b/.test(code), 'синтаксис C# 6+')
  for (const api of ['CreatePseudoConsole', 'ResizePseudoConsole', 'ClosePseudoConsole', 'CreateProcessW'])
    assert.ok(code.includes(api), api)
})
