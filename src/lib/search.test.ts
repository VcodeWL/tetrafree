import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import type { Project } from '../types'
function fixture() {
  const project = {
    id: 'A',
    files: { 'file.txt': 'first\nneedle' },
    docs: [{ id: 'd', title: 'needle doc', blocks: [{ text: 'body' }] }],
    tasks: [{ id: 't', key: 1, title: 'needle task', desc: '' }],
    chats: [{ id: 'c', title: 'chat', messages: [{ id: 'm', text: 'needle message' }] }],
    memory: [{ id: 'mem', text: 'needle memory', kind: 'fact' }],
  } as unknown as Project
  const events: unknown[] = []
  const state = {
    projectId: 'A',
    screen: 'workspace',
    projects: [project, structuredClone({ ...project, id: 'B' })],
    setCenter: (c: unknown) => events.push(c),
    openModal: (m: unknown) => events.push(m),
    toast: (_m: unknown) => {},
  }
  const js = ts.transpileModule(fs.readFileSync(new URL('./search.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const imports = {
    '../store/navigation': { gotoFile: (...v: unknown[]) => events.push(v) },
    '../store': { useStore: { getState: () => state } },
    './docmd': { blockText: (b: { text: string }) => b.text },
  }
  new Function('require', 'module', 'exports', js)(
    (name: string) => imports[name as keyof typeof imports],
    mod,
    mod.exports,
  )
  return { search: (mod.exports as typeof import('./search')).searchProject, project, state, events }
}
test('search results never open same-ID objects after switching to another project', () => {
  const f = fixture()
  const hits = f.search(f.project, 'needle')
  assert.equal(hits.length, 5)
  f.state.projectId = 'B'
  for (const h of hits) h.run()
  assert.deepEqual(f.events, [])
})
test('deleted search targets do not open missing cards or files', () => {
  const f = fixture()
  const hits = f.search(f.project, 'needle')
  f.project.files = {}
  f.project.docs = []
  f.project.tasks = []
  f.project.chats = []
  f.project.memory = []
  for (const h of hits) h.run()
  assert.deepEqual(f.events, [])
})
test('file result whose source changed does not send a stale line navigation', () => {
  const f = fixture()
  const hit = f.search(f.project, 'needle').find((x) => x.group === 'Код')!
  f.project.files['file.txt'] = 'replacement'
  hit.run()
  assert.equal(f.events.some(Array.isArray), false)
})
test('unchanged results retain normal navigation in their original project', () => {
  const f = fixture()
  for (const h of f.search(f.project, 'needle')) h.run()
  assert.equal(f.events.length, 5)
  assert.deepEqual(f.events[0], ['A', 'file.txt', 2])
})
