import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digest } from './today'
import type { Project } from '../types'

const task = (o: object) => ({
  title: 't',
  desc: '',
  assignee: null,
  priority: 'med',
  createdAt: 0,
  key: 1,
  ...o,
})
test('digest: горит, в работе, блокеры, ожидание решения', () => {
  const p = {
    tasks: [
      task({ id: 'late', status: 'doing', due: '2025-10-01' }),
      task({ id: 'td', status: 'backlog', due: '2025-10-10' }),
      task({ id: 'hi', status: 'doing', priority: 'high' }),
      task({ id: 'hib', status: 'backlog', priority: 'high' }),
      task({ id: 'dn', status: 'done', due: '2025-09-01' }),
      task({ id: 'dg', status: 'review' }),
      task({ id: 'bl', status: 'backlog', blockedBy: ['dg'] }),
    ],
    chats: [
      {
        id: 'c1',
        title: 'A',
        running: true,
        agents: [{ name: 'builder' }],
        messages: [{ kind: 'agent', turn: { state: 'partial' } }],
      },
      {
        id: 'c2',
        title: 'B',
        running: false,
        agents: [],
        messages: [{ kind: 'agent', turn: { state: 'proposed' } }],
      },
      {
        id: 'c3',
        title: 'C',
        running: false,
        agents: [],
        messages: [{ kind: 'agent', turn: { state: 'applied' } }],
      },
    ],
  } as unknown as Project
  const d = digest(p, '2025-10-10', 'me')
  assert.deepEqual(
    d.fire.map((f) => f.task.id + ':' + f.why),
    ['late:late', 'td:today', 'hi:high'],
  )
  assert.deepEqual(
    d.doing.map((t) => t.id),
    ['dg'],
  )
  assert.deepEqual(
    d.blocked.map((b) => b.task.id),
    ['bl'],
  )
  assert.deepEqual(
    d.needYou.map((n) => n.id),
    ['c1', 'c2'],
  )
  assert.deepEqual(
    d.running.map((n) => n.id),
    ['c1'],
  )
})
