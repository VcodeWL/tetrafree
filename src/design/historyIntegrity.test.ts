import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from 'zustand/vanilla'
import { useDesign } from './store'
import type * as DesignActions from './actions'
import { captureFileTree } from '../lib/filePreimage'
import { mutateFileTree } from '../store/slices/files'
import { freePath } from '../lib/trash'
import { executeSource, fileFixture, timerFixture } from '../lib/uiSecondTestHelpers'
import type { Toast } from '../store/types'

type Doc = Document & { html: string }
function fixture() {
  const f = fileFixture({ 'site/index.html': 'base', 'site/two.html': 'second' })
  const time = timerFixture()
  const design = createStore<ReturnType<typeof useDesign.getState>>()(() => ({
    ...useDesign.getInitialState(),
    bump: () => design.setState((s) => ({ rev: s.rev + 1 })),
  }))
  const actions = executeSource(
    '../design/actions.ts',
    {
      '../store': { useStore: f.store, toast: (event: Omit<Toast, 'id'>) => f.events.push(event) },
      './store': { useDesign: design },
      '../lib/filePreimage': { captureFileTree },
      '../store/slices/files': { mutateFileTree },
      '../lib/trash': { freePath },
      '../lib/util': { download: () => {} },
      './dom': { serialize: (doc: Doc) => doc.html },
    },
    time,
  ) as unknown as typeof DesignActions
  const load = (pid = 'A', page = 'site/index.html') => {
    const doc = { html: f.project(pid).files[page] } as Doc
    design.setState({ pid, page, doc })
    return doc
  }
  const edit = (text: string, key = '') => {
    ;(design.getState().doc as Doc).html = text
    actions.commitDoc('Текст', key)
  }
  const doc = load()
  return { ...f, design, actions, time, load, edit, doc }
}

test('F02: normal multi-step undo/redo remains functional across fresh CAS revisions', () => {
  const f = fixture()
  f.edit('one')
  f.edit('two')
  assert.equal(f.design.getState().undo.length, 2)
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'one')
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'base')
  f.actions.redo()
  assert.equal(f.project().files['site/index.html'], 'one')
  f.actions.redo()
  assert.equal(f.project().files['site/index.html'], 'two')
  assert.equal(f.events.length, 0)
  f.actions.flushVersion()
})
test('F02: coalesced typing keeps original before and latest after, then undo/redo works', () => {
  const f = fixture()
  f.edit('one', 'text')
  f.edit('two', 'text')
  assert.equal(f.design.getState().undo.length, 1)
  assert.equal(f.design.getState().undo[0].before, 'base')
  assert.equal(f.design.getState().undo[0].after, 'two')
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'base')
  f.actions.redo()
  assert.equal(f.project().files['site/index.html'], 'two')
  f.actions.flushVersion()
})
test('F02: external update followed by fully reloaded canvas refuses stale undo without overwriting', () => {
  const f = fixture()
  f.edit('ours')
  f.external('site/index.html', 'new external text')
  f.load()
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'new external text')
  assert.equal(f.design.getState().undo.length, 1)
  assert.equal(f.design.getState().redo.length, 0)
  assert.equal(f.events[f.events.length - 1]?.tone, 'warn')
  f.edit('next local edit')
  assert.equal(f.design.getState().undo.slice(-1)[0]?.before, 'new external text')
  assert.equal(f.design.getState().undo.length, 2)
  f.actions.flushVersion()
})
test('F02: update/ABA/delete/recreate invalidate both undo and redo generations', () => {
  for (const direction of ['undo', 'redo'] as const)
    for (const mode of ['update', 'aba', 'delete', 'recreate']) {
      const f = fixture()
      f.edit('ours')
      if (direction === 'redo') f.actions.undo()
      const expected = direction === 'undo' ? 'ours' : 'base'
      if (mode === 'delete' || mode === 'recreate') f.external('site/index.html', undefined)
      else f.external('site/index.html', 'external')
      if (mode === 'aba' || mode === 'recreate') f.external('site/index.html', expected)
      const before = { ...f.project().files }
      f.actions[direction]()
      assert.deepEqual(f.project().files, before, `${direction}/${mode}`)
      assert.match(f.events[f.events.length - 1]?.title || '', /Нельзя/)
      f.actions.flushVersion()
    }
})
test('F02: cross-project and cross-page history entries cannot write same-named files', () => {
  const f = fixture()
  f.edit('ours')
  f.set((s) => {
    s.projectId = 'B'
  })
  f.load('B')
  f.actions.undo()
  assert.equal(f.project('B').files['site/index.html'], 'other')
  assert.equal(f.project().files['site/index.html'], 'ours')
  f.set((s) => {
    s.projectId = 'A'
  })
  f.load('A', 'site/two.html')
  f.actions.undo()
  assert.equal(f.project().files['site/two.html'], 'second')
  f.actions.flushVersion()
})
test('F02: stale DOM commit preserves external and durably recovers full local HTML before history clears', () => {
  const f = fixture()
  f.edit('ours')
  f.external('site/index.html', 'external')
  const local = 'X'.repeat(400_001)
  f.doc.html = local
  f.actions.commitDoc('Текст')
  assert.equal(f.project().files['site/index.html'], 'external')
  assert.equal(f.project().trash?.[0].content, local)
  assert.notEqual(f.project().trash?.[0].path, 'site/index.html')
  f.design.setState({ undo: [], redo: [] })
  assert.equal(f.project().trash?.[0].content, local)
  assert.match(f.events[f.events.length - 1]?.title || '', /корзине/)
  f.actions.flushVersion()
})
test('F02: detached element commit stays bound to original document pid/page and does not touch B history', () => {
  const f = fixture()
  f.set((s) => {
    s.projectId = 'B'
  })
  f.load('B')
  f.doc.html = 'A late edit'
  f.actions.commitDoc('Текст', 'text', f.doc)
  assert.equal(f.project().files['site/index.html'], 'A late edit')
  assert.equal(f.project('B').files['site/index.html'], 'other')
  assert.equal(f.design.getState().undo.length, 0)
  f.actions.flushVersion()
  assert.equal(f.project().versions.length, 1)
  assert.equal(f.project('B').versions.length, 0)
})
test('F03: transition flush commits A batch into A even when active project already became B', () => {
  const f = fixture()
  f.edit('ours')
  f.set((s) => {
    s.projectId = 'B'
  })
  f.actions.flushVersion()
  assert.equal(f.project().versions.length, 1)
  assert.equal(f.project('B').versions.length, 0)
  assert.equal(f.project().versions[0].snapshot['site/index.html'], 'ours')
  assert.deepEqual(f.project().versions[0].changes, ['Текст в site/index.html'])
  f.time.run()
  assert.equal(f.project().versions.length, 1)
})
test('F03: distinct document batches retain individual pid/page and coalescing boundaries', () => {
  const f = fixture()
  f.edit('one', 'text')
  f.load('A', 'site/two.html')
  f.edit('two', 'text')
  f.set((s) => {
    s.projectId = 'B'
  })
  f.load('B')
  f.edit('B text', 'text')
  f.time.run()
  assert.equal(f.project().versions.length, 2)
  assert.equal(f.project('B').versions.length, 1)
  assert.deepEqual(
    f.project().versions.map((v) => v.changes),
    [['Текст в site/index.html'], ['Текст в site/two.html']],
  )
  assert.deepEqual(f.project('B').versions[0].changes, ['Текст в site/index.html'])
  assert.equal(f.design.getState().undo.length, 3)
  const last = f.design.getState().undo.slice(-1)[0]!
  assert.equal(last.pid, 'B')
  assert.equal(last.before, 'other')
  f.actions.flushVersion()
  assert.equal(f.project('B').versions.length, 1)
})
test('F03: flush resets typing coalescing and deleted batch owner never falls back to active B', () => {
  const f = fixture()
  f.edit('one', 'text')
  f.actions.flushVersion()
  f.edit('two', 'text')
  assert.equal(f.design.getState().undo.length, 2)
  f.set((s) => {
    s.projects = s.projects.filter((p) => p.id !== 'A')
    s.projectId = 'B'
  })
  f.actions.flushVersion()
  assert.equal(f.project('B').versions.length, 0)
})

test('F02: identical-content external ABA starts a new history lineage; local inverse cannot revive old undo', () => {
  const f = fixture()
  f.edit('ours', 'text')
  f.external('site/index.html', 'external')
  f.external('site/index.html', 'ours')
  f.load()
  f.edit('new local', 'text')
  assert.equal(f.design.getState().undo.length, 2, 'must not coalesce across external generation')
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'ours')
  f.actions.undo()
  assert.equal(f.project().files['site/index.html'], 'ours', 'old lineage must remain invalid')
  assert.match(f.events[f.events.length - 1]?.title || '', /Нельзя/)
  f.actions.flushVersion()
})
