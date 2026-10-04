import test from 'node:test'
import assert from 'node:assert/strict'
import { OpStack, type Op } from './opstack'

const mk = (log: string[], n: string): Op => ({
  label: n,
  undo: () => void log.push('-' + n),
  redo: () => void log.push('+' + n),
})

test('undo и redo идут в обратном порядке', () => {
  const log: string[] = []
  const s = new OpStack()
  s.push(mk(log, 'a'))
  s.push(mk(log, 'b'))
  assert.equal(s.nextUndo, 'b')
  s.undo()
  s.undo()
  assert.equal(s.undo(), null)
  s.redo()
  assert.deepEqual(log, ['-b', '-a', '+a'])
  assert.ok(s.canUndo && s.canRedo)
})
test('новая операция сбрасывает повтор', () => {
  const s = new OpStack()
  const log: string[] = []
  s.push(mk(log, 'a'))
  s.undo()
  assert.ok(s.canRedo)
  s.push(mk(log, 'b'))
  assert.ok(!s.canRedo)
})
test('история ограничена', () => {
  const s = new OpStack(3)
  for (const n of 'abcde') s.push(mk([], n))
  let k = 0
  while (s.undo()) k++
  assert.equal(k, 3)
})
test('упавшая отмена не теряет операцию', () => {
  const s = new OpStack()
  s.push({
    label: 'x',
    undo: () => {
      throw new Error('boom')
    },
    redo: () => {},
  })
  assert.throws(() => s.undo())
  assert.ok(s.canUndo && !s.canRedo)
})
test('undoOp: отмена из тоста работает один раз и только пока операция в истории', () => {
  const log: string[] = []
  const s = new OpStack()
  const a = mk(log, 'a')
  s.push(a)
  s.push(mk(log, 'b'))
  assert.ok(s.undoOp(a))
  assert.ok(!s.undoOp(a))
  assert.deepEqual(log, ['-a'])
  s.redo()
  assert.deepEqual(log, ['-a', '+a'])
})
