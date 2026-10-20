import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureFileTree } from './filePreimage'
import { mutateFileTree } from '../store/slices/files'
import { checkPath } from './paths'
import { executeText, fileFixture, initializer } from './uiSecondTestHelpers'
import type { Op } from './opstack'

function dialogFixture(files = { 'a.txt': 'source' }) {
  const f = fileFixture(files),
    operations: Op[] = []
  let editing = false,
    retabbed = 0
  const globals = {
    p: f.project(),
    st: f.store.getState,
    useStore: f.store,
    checkPath,
    mutateFileTree,
    captureFileTree,
    guard: () => true,
    setEditing: (value: boolean) => {
      editing = value
    },
    stack: { push: (op: Op) => operations.push(op) },
    doneToast: (op: Op) => operations.push(op),
    retab: () => {
      retabbed++
    },
  }
  const source =
    ['newAt', 'renameAt', 'removeAt']
      .map((name) => `const ${name} = ${initializer('../workspace/RightPane.tsx', name)};`)
      .join('\n') + '\nmodule.exports = {newAt, renameAt, removeAt};'
  const callbacks = executeText(source, {}, globals) as {
    newAt: (dir: string, kind: 'file' | 'dir') => void
    renameAt: (path: string, dir: boolean) => void
    removeAt: (path: string, dir: boolean) => void
  }
  return { ...f, ...callbacks, operations, editing: () => editing, retabbed: () => retabbed }
}

test('F01: rename dialog refreshes destination, transaction still rejects a race after validation', () => {
  const f = dialogFixture()
  f.renameAt('a.txt', false)
  const modal = f.dialog()
  assert.equal(modal.check?.('b.txt'), null)
  f.external('b.txt', 'newer colleague content')
  assert.match(modal.check?.('b.txt') || '', /занято/)
  modal.run('b.txt')
  assert.deepEqual(f.project().files, { 'a.txt': 'source', 'b.txt': 'newer colleague content' })
  assert.equal(f.operations.length, 0)
  assert.equal(f.retabbed(), 0)
  assert.equal(f.events[f.events.length - 1]?.tone, 'warn')
})
test('F01: new-file and new-directory dialogs refuse late files or implicit folders', () => {
  for (const kind of ['file', 'dir'] as const)
    for (const target of ['notes.txt', 'notes.txt/child']) {
      const f = dialogFixture()
      f.newAt('', kind)
      const modal = f.dialog()
      f.external(target, 'newer notes')
      assert.ok(modal.check?.('notes.txt'))
      modal.run('notes.txt')
      assert.equal(f.project().files[target], 'newer notes')
      if (target.includes('/')) assert.equal(f.project().files['notes.txt'], undefined)
      assert.equal(f.operations.length, 0)
    }
})
test('F01: source update/ABA/delete-recreate invalidates the dialog generation', () => {
  for (const mode of ['update', 'aba', 'recreate']) {
    const f = dialogFixture()
    f.renameAt('a.txt', false)
    if (mode === 'recreate') f.external('a.txt', undefined)
    else f.external('a.txt', 'external')
    if (mode !== 'update') f.external('a.txt', 'source')
    const current = f.project().files['a.txt']
    f.dialog().run('b.txt')
    assert.equal(f.project().files['a.txt'], current)
    assert.equal(f.project().files['b.txt'], undefined)
    assert.equal(f.operations.length, 0)
  }
})
test('F01: dialog always mutates original pid; inactive-project actions do not navigate B', () => {
  const f = dialogFixture()
  f.newAt('', 'file')
  const modal = f.dialog()
  f.set((s) => {
    s.projectId = 'B'
    s.activeFile = 'site/index.html'
  })
  modal.run('new.txt')
  assert.equal(f.project().files['new.txt'], '')
  assert.equal(f.project('B').files['new.txt'], undefined)
  assert.equal(f.store.getState().activeFile, 'site/index.html')
  assert.equal(f.editing(), false)
})
test('F01: normal rename and case-only rename preserve undo/redo functionality', () => {
  const f = dialogFixture()
  f.renameAt('a.txt', false)
  f.dialog().run('A.txt')
  assert.deepEqual(f.project().files, { 'A.txt': 'source' })
  f.operations[0].undo()
  assert.deepEqual(f.project().files, { 'a.txt': 'source' })
  f.operations[0].redo()
  assert.deepEqual(f.project().files, { 'A.txt': 'source' })
  f.external('A.txt', 'newer')
  assert.throws(() => f.operations[0].undo(), /изменились/)
  assert.deepEqual(f.project().files, { 'A.txt': 'newer' })
})
test('F01: direct store renameFile/renamePath cannot clobber destination or whole target subtree', () => {
  const f = fileFixture({ a: 'source', b: 'newer', 'from/x': 'x', 'to/y': 'y' })
  assert.throws(() => f.store.getState().renameFile('a', 'B'), /занято/)
  assert.throws(() => f.store.getState().renamePath('from', 'TO'), /папка/)
  assert.deepEqual(f.project().files, { a: 'source', b: 'newer', 'from/x': 'x', 'to/y': 'y' })
})
test('F01: atomic mkdir/create guards case-insensitive ancestors and implicit folder collisions', () => {
  const f = fileFixture({ Foo: 'file', 'folder/child': 'child' })
  assert.throws(() => mutateFileTree(f.set, 'A', { kind: 'create', path: 'foo/x' }), /файл/)
  assert.throws(() => mutateFileTree(f.set, 'A', { kind: 'create', path: 'FOLDER' }), /папка/)
  assert.throws(() => f.store.getState().writeFile('FOO', 'wrong'), /занято/)
  // Explicit exact-file overwrite remains available to editors/agents.
  f.store.getState().writeFile('Foo', 'updated', 'A')
  assert.equal(f.project().files.Foo, 'updated')
})
test('F01: fresh raw transaction preimage and matching scope are mandatory', () => {
  const f = fileFixture({ a: 'one', b: 'two' })
  const before = captureFileTree(f.store, 'A', 'a')
  assert.throws(
    () => mutateFileTree(f.set, 'A', { kind: 'replace', path: 'b', content: 'bad', before }),
    /изменились/,
  )
  f.external('a', 'newer')
  assert.throws(
    () => mutateFileTree(f.set, 'A', { kind: 'replace', path: 'a', content: 'bad', before }),
    /изменились/,
  )
  assert.deepEqual(f.project().files, { a: 'newer', b: 'two' })
})
test('F01: delete modal refuses stale source; successful delete has durable full-size recovery and safe undo', () => {
  const f = dialogFixture()
  f.removeAt('a.txt', false)
  const remove = f.store.getState().modal as { run: () => void }
  f.external('a.txt', 'newer')
  remove.run()
  assert.equal(f.project().files['a.txt'], 'newer')
  assert.equal(f.operations.length, 0)
  f.external('a.txt', 'X'.repeat(400_001))
  f.removeAt('a.txt', false)
  ;(f.store.getState().modal as { run: () => void }).run()
  assert.equal(f.project().files['a.txt'], undefined)
  assert.equal(f.project().trash?.[0].content.length, 400_001)
  f.operations[0].undo()
  assert.equal(f.project().files['a.txt'].length, 400_001)
  f.operations[0].redo()
  assert.equal(f.project().files['a.txt'], undefined)
  assert.equal(f.project().trash?.[0].content.length, 400_001)
})
test('F01: restoration validates all destinations before any write', () => {
  const f = fileFixture({ occupied: 'newer' })
  assert.throws(
    () => mutateFileTree(f.set, 'A', { kind: 'restore', files: { fresh: 'a', occupied: 'b' }, dirs: [] }),
    /занято/,
  )
  assert.deepEqual(f.project().files, { occupied: 'newer' })
})

test('F01: explicit overwrite and ensure-existing-directory APIs retain their original functionality', () => {
  const path = 'x'.repeat(201) + '.txt'
  const f = fileFixture({ [path]: 'old', 'implicit/child': 'text' })
  f.store.getState().writeFile(path, 'new', 'A')
  f.store.getState().addDir('implicit')
  f.store.getState().addDir('implicit')
  assert.equal(f.project().files[path], 'new')
  assert.equal(f.project().dirs.filter((name) => name === 'implicit').length, 1)
})
