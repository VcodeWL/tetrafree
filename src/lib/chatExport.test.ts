import test from 'node:test'
import assert from 'node:assert/strict'
import { agentParts } from './chatExport'
import type { Part } from '../types'

test('agentParts: файлы и команды попадают в экспорт', () => {
  const parts: Part[] = [
    { k: 'text', id: '1', text: 'Делаю' },
    { k: 'file', id: '2', op: 'create', path: 'a.txt', state: 'done', add: 3, del: 0 },
    { k: 'cmd', id: '3', cmd: 'echo hi', state: 'done', out: 'hi\n' },
  ]
  const md = agentParts(parts)
  assert.match(md, /Делаю/)
  assert.match(md, /`a\.txt`: создан \(\+3 −0\)/)
  assert.match(md, /\$ echo hi\nhi\n```/)
  assert.equal(agentParts(undefined), '')
})
