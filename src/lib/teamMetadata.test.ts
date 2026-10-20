import test from 'node:test'
import assert from 'node:assert/strict'
import { convertMetaIds, mergeRecords, mergeValue, type TeamMeta } from './teamMetadata'
import { recoveryPath } from './syncRecovery'
import type { Chat, Doc, Task } from '../types'

const task: Task = {
  id: 't',
  key: 1,
  title: 'old',
  desc: 'old desc',
  status: 'backlog',
  priority: 'med',
  assignee: { kind: 'human', id: 'me' },
  createdAt: 1,
  updatedAt: 2,
  subtasks: [
    { id: 's1', text: 'one', done: false },
    { id: 's2', text: 'two', done: false },
  ],
  comments: [{ id: 'c', by: 'me', text: 'old comment', at: 1 }],
}
const doc: Doc = {
  id: 'd',
  title: 'me',
  createdBy: 'me',
  updatedAt: 2,
  blocks: [
    { id: 'b1', type: 'p', text: 'me' },
    { id: 'b2', type: 'p', text: 'old2' },
  ],
}
const chat = (n: number): Chat => ({
  id: 'chat',
  title: 'old',
  creator: { kind: 'human', id: 'me' },
  agents: [],
  running: false,
  createdAt: 1,
  lastAt: n,
  messages: Array.from({ length: n }, (_, i) => ({
    id: 'm' + i,
    kind: 'human',
    author: 'me',
    text: 'me',
    at: i,
  })),
})
const merge = <T extends { id: string }>(l: T, r: T, b?: T) =>
  mergeRecords([l], [r], b ? [b] : undefined, {}, () => 1)

test('D07: independent task fields and nested subtask/comment fields merge at equal clocks', () => {
  const l = structuredClone(task),
    r = structuredClone(task)
  l.title = 'local'
  l.subtasks![0].done = true
  l.comments![0].text = 'local comment'
  r.desc = 'remote'
  r.subtasks![1].text = 'remote two'
  r.comments!.push({ id: 'new', by: 'other', text: 'new', at: 3 })
  const m = merge(l, r, task)
  assert.equal(m.conflicts, 0)
  assert.equal(m.records.length, 1)
  assert.equal(m.records[0].title, 'local')
  assert.equal(m.records[0].desc, 'remote')
  assert.equal(m.records[0].subtasks![0].done, true)
  assert.equal(m.records[0].subtasks![1].text, 'remote two')
  assert.equal(m.records[0].comments![0].text, 'local comment')
  assert.equal(m.records[0].comments!.length, 2)
})
test('D07: independent document blocks and title merge', () => {
  const l = structuredClone(doc),
    r = structuredClone(doc)
  l.blocks[0].text = 'local'
  r.blocks[1].text = 'remote'
  r.title = 'renamed'
  const m = merge(l, r, doc)
  assert.equal(m.conflicts, 0)
  assert.deepEqual(
    m.records[0].blocks.map((x) => x.text),
    ['local', 'remote'],
  )
  assert.equal(m.records[0].title, 'renamed')
})
test('D07: same-field, delete-edit and unknown-baseline conflicts preserve both versions', () => {
  const l = { ...task, title: 'left' },
    r = { ...task, title: 'right' }
  for (const b of [task, undefined]) {
    const m = merge(l, r, b)
    assert.equal(m.conflicts, 1)
    assert.equal(m.records[0].title, 'left')
    assert.ok(m.records.some((x) => x.title.startsWith('right')))
  }
  const dl = structuredClone(doc),
    dr = structuredClone(doc)
  dl.blocks.shift()
  dr.blocks[0].text = 'edited deleted block'
  const m = merge(dl, dr, doc)
  assert.equal(m.conflicts, 1)
  assert.ok(m.records.some((x) => x.blocks.some((b) => b.text === 'edited deleted block')))
})
test('conflict copy IDs are unique and repeated merge does not overwrite or duplicate copies', () => {
  const l = { ...task, title: 'left' },
    r = { ...task, title: 'right' }
  const once = merge(l, r, task)
  const again = mergeRecords(once.records, [r], [task], {}, () => 1)
  assert.equal(again.records.length, once.records.length)
  const occupied = { ...once.records[1], title: 'precious' }
  const collision = mergeRecords([l, occupied], [r], [task], {}, () => 1)
  assert.ok(collision.records.some((x) => x.title === 'precious'))
  assert.equal(new Set(collision.records.map((x) => x.id)).size, collision.records.length)
})
test('S08: bounded wire window never deletes local chat prefix, even without ancestor', () => {
  const local = chat(100),
    remote = { ...chat(100), title: 'renamed', messages: chat(100).messages.slice(-80) }
  for (const base of [{ ...local, messages: local.messages.slice(-80) }, undefined]) {
    const m = merge(local, remote, base)
    assert.equal(m.records[0].messages.length, 100)
    assert.equal(m.records[0].messages[0].id, 'm0')
    assert.ok(m.records.some((x) => x.title.startsWith('renamed')))
  }
})
test('S11: remote memory text and chat header merge independent of stale/equal timestamps', () => {
  const b = { id: 'mem', text: 'old', by: 'me', at: 1, kind: 'fact' as const },
    l = { ...b, by: 'local' },
    r = { ...b, text: 'remote' }
  const m = merge(l, r, b)
  assert.equal(m.records[0].text, 'remote')
  assert.equal(m.records[0].by, 'local')
  const c = chat(3),
    cr = { ...c, title: 'renamed' },
    cl = { ...c, pinned: true }
  const cm = merge(cl, cr, c)
  assert.equal(cm.records[0].title, 'renamed')
  assert.equal(cm.records[0].pinned, true)
})
test('tombstone vs edited record keeps a visible recovery copy instead of losing edit', () => {
  const edited = { ...task, title: 'unsaved clock-skew edit' }
  const m = mergeRecords([edited], [], [task], { t: 100 }, () => 2)
  assert.equal(m.records.length, 1)
  assert.notEqual(m.records[0].id, 't')
  assert.match(m.records[0].title, /unsaved clock-skew edit/)
  assert.equal(mergeRecords([task], [], [task], { t: 100 }, () => 2).records.length, 0)
})
test('S09: only declared person-ID fields convert, arbitrary text and agent/display names round-trip', () => {
  const meta: TeamMeta = {
    desc: 'me',
    icon: 'sparkle',
    template: 'me',
    tools: ['me'],
    docs: [doc],
    tasks: [task],
    taskSeq: 2,
    memory: [{ id: 'me', text: 'me', by: 'me', at: 1, kind: 'fact' }],
    chats: [chat(2)],
    comments: [{ id: 'me', file: 'me', line: 1, anchor: 'me', text: 'me', by: 'me', at: 1 }],
  }
  meta.chats.push({ ...chat(1), id: 'agent-chat', creator: { kind: 'agent', name: 'me' } })
  const wire = convertMetaIds(meta, 'uid', 'to')
  assert.equal(wire.docs[0].createdBy, 'uid')
  assert.equal(wire.docs[0].title, 'me')
  assert.equal(wire.docs[0].blocks[0].text, 'me')
  assert.deepEqual(wire.tasks[0].assignee, { kind: 'human', id: 'uid' })
  assert.equal(wire.tasks[0].comments![0].by, 'uid')
  assert.equal(wire.comments![0].by, 'uid')
  assert.equal(wire.memory[0].by, 'me')
  assert.deepEqual(wire.chats[1].creator, { kind: 'agent', name: 'me' })
  assert.deepEqual(convertMetaIds(wire, 'uid', 'from'), meta)
  const text = convertMetaIds({ ...meta, desc: 'uid' }, 'uid', 'from')
  assert.equal(text.desc, 'uid')
})
test('S18: recovery reserves Windows aliases, future remote files and directory ancestors', () => {
  assert.equal(recoveryPath('x', 'cloud', ['X.CLOUD', 'x.cloud.2/precious', 'x.cloud.3']), 'x.cloud.4')
  assert.equal(recoveryPath('x', 'cloud', ['x.cloud.2', 'x.cloud']), 'x.cloud.3')
  assert.deepEqual(mergeValue(['a'], ['b'], ['a']).value, ['b'])
})

test('recovery inside an existing directory does not loop; parent-file collisions flatten safely', () => {
  assert.equal(recoveryPath('src/x', 'cloud', ['src/x'], ['src']), 'src/x.cloud')
  assert.equal(recoveryPath('src/x', 'cloud', ['src', 'src_x.cloud'], []), 'src_x.cloud.2')
  assert.equal(recoveryPath('x', 'cloud', ['X.CLOUD. ']), 'x.cloud.2')
})
test('chat window shortened by an older client is a union even when local exactly matches ancestor', () => {
  const c = chat(80),
    remote = { ...c, messages: c.messages.slice(-20) }
  assert.equal(merge(c, remote, c).records[0].messages.length, 80)
})

test('independent inserted document blocks retain their position between common anchors', () => {
  const l = structuredClone(doc),
    r = structuredClone(doc)
  l.blocks.splice(1, 0, { id: 'local-new', type: 'p', text: 'local middle' })
  r.blocks.splice(1, 0, { id: 'remote-new', type: 'p', text: 'remote middle' })
  const m = merge(l, r, doc)
  assert.equal(m.conflicts, 0)
  const ids = m.records[0].blocks.map((b) => b.id)
  assert.equal(ids[0], 'b1')
  assert.equal(ids[ids.length - 1], 'b2')
  assert.ok(ids.includes('local-new'))
  assert.ok(ids.includes('remote-new'))
})
test('memory mutation clocks merge without creating a conflict for independent kind/text changes', () => {
  const b = { id: 'mem', text: 'old', by: 'name', at: 1, kind: 'fact' as 'fact' | 'decision' }
  const m = merge({ ...b, text: 'local', at: 10 }, { ...b, kind: 'decision', at: 11 }, b)
  assert.equal(m.conflicts, 0)
  assert.equal(m.records[0].text, 'local')
  assert.equal(m.records[0].kind, 'decision')
  assert.equal(m.records[0].at, 11)
})
