import test from 'node:test'
import assert from 'node:assert/strict'
import { produce } from 'immer'
import { projectsActions, projectPathKey } from './projects'
import { chatsActions } from './chats'
import { docsActions } from './docs'
import { tasksActions } from './tasks'
import { memoryActions } from './memory'
import { emptyProject } from '../../data/seed'
import { initialPersisted, initialUI } from '../defaults'
import type { Full, SetState } from '../types'
import { detachProject, exportProject, importProjectFile } from '../../lib/projectIO'
import { makeZip, readZip } from '../../lib/zip'
import type { Project } from '../../types'

export function domainStore() {
  let state = { ...initialPersisted(), ...initialUI() } as Full
  const set: SetState = (fn) => {
    state = produce(state, fn)
  }
  const get = () => state
  Object.assign(
    state,
    projectsActions(set),
    chatsActions(set),
    docsActions(set),
    tasksActions(set, get),
    memoryActions(set),
    {
      toast: () => {},
      closeModal: () => {},
      setCenter: (center: Full['center']) =>
        set((s) => {
          s.center = center
        }),
    },
  )
  set((s) => {
    s.projects = ['A', 'B'].map((id) => emptyProject({ id, name: id, path: 'C:/work/' + id }))
    s.projectId = 'A'
    s.center = { kind: 'empty' }
  })
  return { get, set, project: (id = 'A') => get().projects.find((p) => p.id === id)! }
}
function zipFile(blob: Blob) {
  return { name: 'project.zip', arrayBuffer: () => blob.arrayBuffer() } as File
}

test('D01/S10: duplicate is detached and deeply independent; original identity intact', () => {
  const h = domainStore()
  h.set((s) => {
    const p = s.projects[0]
    p.cloud = { pid: 'team', rev: 8, owner: true, ownerId: 'me', tomb: { x: 1 } }
    p.mirror = true
    p.files['private.md'] = 'secret'
  })
  h.get().duplicateProject('A')
  const c = h.get().projects[1]
  assert.equal(c.deploy.auto, false)
  assert.equal(c.path, '')
  assert.equal(c.cloud, undefined)
  assert.equal(c.mirror, undefined)
  h.get().up((p) => {
    p.files['private.md'] = 'copy'
  }, c.id)
  assert.equal(h.project().files['private.md'], 'secret')
  assert.equal(h.project().cloud?.pid, 'team')
})

test('D01/D02: ZIP round trip and direct import discard cloud/path without losing content', async () => {
  const h = domainStore()
  h.set((s) => {
    s.projects[0].cloud = { pid: 'team', rev: 1, owner: true, ownerId: 'me' }
    s.projects[0].files = { 'hello.txt': 'hello' }
  })
  const blob = exportProject(h.project())
  const entries = await readZip(await blob.arrayBuffer())
  const metadata = JSON.parse(entries['.tetra/project.json']).project
  assert.equal(metadata.path, '')
  assert.equal(metadata.cloud, undefined)
  const imported = await importProjectFile(zipFile(blob))
  assert.equal(imported.path, '')
  assert.equal(imported.cloud, undefined)
  assert.equal(imported.files['hello.txt'], 'hello')
  h.get().importProject(h.project())
  assert.equal(h.get().projects[0].path, '')
  assert.equal(h.get().projects[0].cloud, undefined)
})

test('D02: legacy ZIP path/cloud detached; dangerous and Windows-colliding file paths rejected', async () => {
  const h = domainStore()
  const legacy = makeZip({
    'old.txt': 'old',
    '.tetra/project.json': JSON.stringify({
      format: 'tetrafree-project',
      project: { ...h.project(), cloud: { pid: 'team' } },
    }),
  })
  assert.equal((await importProjectFile(zipFile(legacy))).path, '')
  const invalidFiles: Record<string, string>[] = [
    { '../outside.txt': 'bad' },
    { 'C:/outside.txt': 'bad' },
    { 'A.txt': 'one', 'a.txt': 'two' },
    { dir: 'file', 'dir/x': 'nested' },
  ]
  for (const files of invalidFiles) {
    await assert.rejects(importProjectFile(zipFile(makeZip(files))))
  }
})

test('D02: create/up/restore reject normalized folder aliases atomically', () => {
  const h = domainStore()
  assert.equal(projectPathKey('C:\\work\\temp\\..\\A\\'), projectPathKey('c:/work/A'))
  assert.throws(
    () => h.get().createProject({ name: 'Alias', path: 'c:\\work\\A\\', template: 'Пустой' }),
    /занята/,
  )
  assert.throws(
    () =>
      h.get().up((p) => {
        p.path = 'c:/work/a/'
      }, 'B'),
    /занята/,
  )
  assert.equal(h.project('B').path, 'C:/work/B')
  assert.throws(() => h.get().restoreProject({ ...h.project(), id: 'alias' } as Project, 0), /занята/)
  assert.equal(h.get().projects.length, 2)
})

test('D03: restore targets original project, clears original tomb, never navigates B', () => {
  const h = domainStore()
  const cid = h.get().createChat({ title: 'PRIVATE', creator: { kind: 'human', id: 'me' }, agents: [] })
  const chat = h.project().chats[0]
  h.set((s) => {
    s.projects[0].cloud = { pid: 'team', rev: 1, owner: true, ownerId: 'me' }
  })
  h.get().deleteChat(cid)
  h.get().openProject('B')
  const center = h.get().center
  h.get().restoreChat(chat, 0, 'A')
  assert.equal(h.project().chats[0].title, 'PRIVATE')
  assert.equal(h.project().cloud?.tomb?.[cid], undefined)
  assert.equal(h.project('B').chats.length, 0)
  assert.deepEqual(h.get().center, center)
  h.get().deleteProject('A')
  h.get().restoreChat(chat, 0, 'A')
  assert.equal(h.project('B').chats.length, 0)
})

test('D04/D06: optional pid actions never modify or focus current project B', () => {
  const h = domainStore()
  h.get().openProject('B')
  const center = h.get().center
  h.get().addDocs([{ title: 'Private', blocks: [] }], 'A')
  const did = h.get().createDoc('A')
  h.get().updateDoc(did, { title: 'Origin' }, 'A')
  h.get().createChat({ title: 'Origin chat', creator: { kind: 'human', id: 'me' }, agents: [] }, 'A')
  h.get().saveTask({ title: 'Origin task' }, 'A')
  assert.equal(h.project().docs.length, 2)
  assert.equal(h.project().docs[0].title, 'Origin')
  assert.equal(h.project('B').docs.length, 0)
  assert.equal(h.project('B').tasks.length, 0)
  assert.equal(h.project('B').chats.length, 0)
  assert.deepEqual(h.get().center, center)
  h.get().deleteProject('A')
  h.get().addDocs([{ title: 'Gone', blocks: [] }], 'A')
  h.get().createDoc('A')
  assert.equal(h.get().saveTask({ title: 'Gone' }, 'A'), '')
  assert.equal(h.project('B').docs.length, 0)
})

test('saveTask deleted id cannot resurrect; repeating task stays in original pid', () => {
  const h = domainStore()
  assert.equal(h.get().saveTask({ id: 'deleted', title: 'stale' }, 'A'), '')
  const tid = h.get().saveTask({ title: 'repeat', repeat: 'daily', due: '2026-10-13' }, 'A')
  h.get().openProject('B')
  h.get().saveTask({ id: tid, title: 'repeat', status: 'done' }, 'A')
  assert.equal(h.project().tasks.length, 2)
  assert.equal(h.project('B').tasks.length, 0)
})

test('S11: rename and memory edit advance sync stamp monotonically, no-op does not', () => {
  const h = domainStore()
  const cid = h.get().createChat({ title: 'Old', creator: { kind: 'human', id: 'me' }, agents: [] })
  const future = Date.now() + 100000
  h.get().setChat(cid, { lastAt: future })
  h.get().renameChat(cid, 'New')
  assert.equal(h.project().chats[0].lastAt, future + 1)
  h.get().renameChat(cid, 'New')
  assert.equal(h.project().chats[0].lastAt, future + 1)
  h.get().remember({ text: 'Old', by: 'me', kind: 'fact' })
  const mid = h.project().memory[0].id
  h.set((s) => {
    s.projects[0].memory[0].at = future
  })
  h.get().editMemory(mid, { text: 'New' })
  assert.equal(h.project().memory[0].at, future + 1)
  h.get().editMemory(mid, { text: 'New' })
  assert.equal(h.project().memory[0].at, future + 1)
})

// Execute actual TSX closures with controlled hooks/IO; not a browser lifecycle test.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as seed from '../../data/seed'
import * as util from '../../lib/util'
import * as rel from '../../lib/taskrel'
import * as model from '../../types'
import * as mdimport from '../../lib/mdimport'
import * as docmd from '../../lib/docmd'
import * as links from '../../lib/backlinks'
import { clone } from '../../lib/clone'
import * as snapshots from '../snapshots'
import * as templates from '../../data/docTemplates'
import * as today from '../../lib/today'

type HookCell = { value: unknown }
function uiHarness(h: ReturnType<typeof domainStore>) {
  let cursor = 0
  const cells: HookCell[] = []
  const cell = (value: unknown) => {
    const i = cursor++
    if (!cells[i]) cells[i] = { value }
    return cells[i]
  }
  const react = {
    useRef: (value: unknown) => cell({ current: value }).value,
    useState: (value: unknown) => {
      const c = cell(typeof value === 'function' ? (value as () => unknown)() : value)
      return [
        c.value,
        (next: unknown) => {
          c.value = typeof next === 'function' ? (next as (old: unknown) => unknown)(c.value) : next
        },
      ]
    },
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
    useLayoutEffect: () => {},
    lazy: () => () => null,
  }
  const useStore = Object.assign((selector: (s: Full) => unknown) => selector(h.get()), {
    getState: h.get,
    setState: (fn: (s: Full) => Partial<Full>) =>
      h.set((s) => {
        Object.assign(s, fn(s))
      }),
  })
  const store = {
    useStore,
    useProject: () => h.project(h.get().projectId!),
    toast: (t: unknown) => notices.push(t),
    actorName: () => 'Участник',
  }
  const notices: unknown[] = []
  h.set((s) => {
    s.toast = (t) => {
      notices.push(t)
    }
  })
  const captured: Record<string, unknown> = {}
  const load = (file: string, extra: Record<string, unknown> = {}, inject?: [string, string]) => {
    let source = readFileSync(new URL(file, import.meta.url), 'utf8')
    if (inject) {
      assert.ok(source.includes(inject[0]))
      source = source.replace(...inject)
    }
    const js = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    const mod = { exports: {} as Record<string, unknown> }
    const mocks: Record<string, unknown> = {
      react,
      '../store': store,
      '../data/seed': seed,
      '../lib/util': util,
      './util': util,
      './mdimport': mdimport,
      './projectIO': { detachProject },
      '../store/snapshots': snapshots,
      '../data/docTemplates': templates,
      '../lib/today': today,
      '../lib/whatsnew': { useUnseenRelease: () => false },
      '../lib/clone': { clone },
      '../lib/paths': {},
      '../lib/taskrel': rel,
      '../types': model,
      '../workspace/TasksView': { COLS: [], PRIO: { med: 'средний' } },
      '../lib/taskConstants': { COLS: [], PRIO: { med: 'средний' } },
      '../components/ui/Menu': { useMenu: () => ({ st: null }) },
      '../lib/team': { usePeers: () => false },
      '../lib/backlinks': links,
      '../lib/docmd': docmd,
      'zustand/traditional': {
        useStoreWithEqualityFn: (_store: unknown, selector: (s: Full) => unknown) => selector(h.get()),
      },
      ...extra,
    }
    new Function('require', 'module', 'exports', '__capture', js)(
      (id: string) =>
        id === 'react/jsx-runtime'
          ? {
              jsx: (type: unknown, props: unknown) => ({ type, props }),
              jsxs: (type: unknown, props: unknown) => ({ type, props }),
              Fragment: Symbol.for('fragment'),
            }
          : mocks[id] || {},
      mod,
      mod.exports,
      (value: Record<string, unknown>) => Object.assign(captured, value),
    )
    return mod.exports
  }
  const render = (fn: () => unknown) => {
    cursor = 0
    return fn()
  }
  return { load, render, captured, notices }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('D04: real Markdown chooser holds launch pid across selection and delayed File.text', async () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const wait = deferred<string>()
  const input = {
    type: '',
    multiple: false,
    accept: '',
    files: [{ name: 'private.md', size: 100, text: () => wait.promise }],
    onchange: async () => {},
    click: () => {},
  }
  const previous = globalThis.document
  globalThis.document = { createElement: () => input } as unknown as Document
  try {
    const mod = ui.load('../../lib/mdfiles.ts')
    ;(mod.importMd as (folder: boolean) => void)(false)
    h.get().openProject('B')
    const pending = input.onchange()
    wait.resolve('# PRIVATE A')
    await pending
    assert.equal(h.project().docs[0].title, 'PRIVATE A')
    assert.equal(h.project('B').docs.length, 0)
    assert.equal(h.get().center.kind, 'empty')
  } finally {
    globalThis.document = previous
  }
})

test('D04: real Markdown completion reports deleted origin instead of falling back', async () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const wait = deferred<string>()
  const input = {
    files: [{ name: 'private.md', size: 1, text: () => wait.promise }],
    onchange: async () => {},
    click: () => {},
  }
  const previous = globalThis.document
  globalThis.document = { createElement: () => input } as unknown as Document
  try {
    const mod = ui.load('../../lib/mdfiles.ts')
    ;(mod.importMd as (folder: boolean) => void)(false)
    const pending = input.onchange()
    h.get().deleteProject('A')
    h.get().openProject('B')
    wait.resolve('# secret')
    await pending
    assert.equal(h.project('B').docs.length, 0)
    assert.match(JSON.stringify(ui.notices), /Исходный проект удалён/)
  } finally {
    globalThis.document = previous
  }
})

test('D06: actual addImages appends against fresh blocks of origin, not clone/current B', async () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const wait = deferred<string>()
  const did = h.get().createDoc('A')
  h.set((s) => {
    s.projects[1].docs = clone(s.projects[0].docs)
  })
  const mod = ui.load(
    '../../workspace/DocView.tsx',
    {
      '../lib/imgscale': { isImageFile: () => true, shrinkImage: () => wait.promise },
    },
    ['  const done =', '  __capture({ addImages });\n  const done ='],
  )
  ui.render(() => (mod.DocView as (p: { doc: model.Doc }) => unknown)({ doc: h.project().docs[0] }))
  const pending = (ui.captured.addImages as (f: File[], id: string | null) => Promise<void>)(
    [{} as File],
    null,
  )
  h.get().openProject('B')
  h.get().updateDoc(
    did,
    { blocks: [...h.project().docs[0].blocks, { id: 'fresh', type: 'p', text: 'concurrent' }] },
    'A',
  )
  wait.resolve('data:image/png;base64,SECRET')
  await pending
  assert.equal(h.project().docs[0].blocks.length, 3)
  assert.equal(h.project().docs[0].blocks[1].text, 'concurrent')
  assert.equal(h.project('B').docs[0].blocks.length, 1)
})

test('D06: actual addImages reports deleted origin doc, never recreates or leaks image', async () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const wait = deferred<string>()
  const did = h.get().createDoc('A')
  h.set((s) => {
    s.projects[1].docs = clone(s.projects[0].docs)
  })
  const mod = ui.load(
    '../../workspace/DocView.tsx',
    { '../lib/imgscale': { isImageFile: () => true, shrinkImage: () => wait.promise } },
    ['  const done =', '  __capture({ addImages });\n  const done ='],
  )
  ui.render(() => (mod.DocView as (p: { doc: model.Doc }) => unknown)({ doc: h.project().docs[0] }))
  const pending = (ui.captured.addImages as (f: File[], id: string | null) => Promise<void>)(
    [{} as File],
    null,
  )
  h.get().deleteDoc(did)
  h.get().openProject('B')
  wait.resolve('SECRET')
  await pending
  assert.equal(h.project().docs.length, 0)
  assert.equal(h.project('B').docs[0].blocks.length, 1)
})

function formHarness() {
  const h = domainStore()
  const ui = uiHarness(h)
  const id = h.get().saveTask({ title: 'Old', desc: 'Old desc' })
  const mod = ui.load('../../modals/Forms.tsx', {}, [
    '  const delegate = () => {',
    '  __capture({ save, setTitle, setDesc, title, saveError, conflict });\n  const delegate = () => {',
  ])
  const render = () => ui.render(() => (mod.TaskModal as (props: { id: string }) => unknown)({ id }))
  const save = (overwrite = false) =>
    (ui.captured.save as (extra: object, overwrite: boolean) => string | null)({}, overwrite)
  render()
  return { h, ui, id, render, save }
}

test('D05: actual TaskModal keeps independent remote fields and original pid', () => {
  const { h, ui, id, render, save } = formHarness()
  ;(ui.captured.setTitle as (value: string) => void)('Local title')
  h.get().saveTask({ id, title: 'Old', desc: 'REMOTE desc', status: 'done' }, 'A')
  h.get().openProject('B')
  render()
  assert.equal(save(), id)
  assert.equal(h.project().tasks[0].title, 'Local title')
  assert.equal(h.project().tasks[0].desc, 'REMOTE desc')
  assert.equal(h.project().tasks[0].status, 'done')
  assert.equal(h.project('B').tasks.length, 0)
})

test('D05: no dirty fields is no-op; actual conflict retains draft and confirmation uses CAS', () => {
  const { h, ui, id, render, save } = formHarness()
  h.get().saveTask({ id, title: 'Remote title', desc: 'Remote desc' }, 'A')
  const stamp = h.project().tasks[0].updatedAt
  render()
  assert.equal(save(), id)
  assert.equal(h.project().tasks[0].title, 'Remote title')
  assert.equal(h.project().tasks[0].updatedAt, stamp)
  ;(ui.captured.setTitle as (value: string) => void)('Local title')
  render()
  assert.equal(save(), null)
  render()
  assert.equal(ui.captured.title, 'Local title')
  assert.ok(ui.captured.conflict)
  h.get().saveTask({ id, title: 'Another remote title' }, 'A')
  assert.equal(save(true), null)
  assert.equal(h.project().tasks[0].title, 'Another remote title')
  render()
  assert.equal(save(true), id)
  assert.equal(h.project().tasks[0].title, 'Local title')
  assert.equal(h.project().tasks[0].desc, 'Remote desc')
})

test('D05: actual form refuses deleted task without losing draft', () => {
  const { h, ui, id, render, save } = formHarness()
  ;(ui.captured.setTitle as (value: string) => void)('Unsaved draft')
  h.get().deleteTask(id)
  render()
  assert.equal(save(), null)
  render()
  assert.equal(ui.captured.title, 'Unsaved draft')
  assert.equal(h.project().tasks.length, 0)
  assert.match(String(ui.captured.saveError), /удалены/)
})

test('Forms: new-chat dialog retains origin pid without navigating switched project', () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const mod = ui.load('../../modals/Forms.tsx', {}, [
    '  const ref = useRef<HTMLInputElement>(null)',
    '  __capture({ create });\n  const ref = useRef<HTMLInputElement>(null)',
  ])
  const render = () => ui.render(() => (mod.NewChatModal as () => unknown)())
  render()
  h.get().openProject('B')
  render()
  ;(ui.captured.create as () => void)()
  assert.equal(h.project().chats.length, 1)
  assert.equal(h.project('B').chats.length, 0)
  assert.equal(h.get().center.kind, 'empty')
})

type TestNode = {
  type?: unknown
  props?: { className?: string; children?: unknown; onKeyDown?: (e: { key: string }) => void }
}
function findTitleInput(node: unknown): TestNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findTitleInput(child)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    const n = node as TestNode
    if (n.props?.className === 'tt-in') return n
    return findTitleInput(n.props?.children)
  }
}

test('D05: Enter does not close actual TaskModal on conflict', () => {
  const { h, ui, id, render } = formHarness()
  h.set((s) => {
    s.modal = { type: 'task', id }
    s.closeModal = () =>
      h.set((s) => {
        s.modal = null
      })
  })
  ;(ui.captured.setTitle as (value: string) => void)('Draft')
  h.get().saveTask({ id, title: 'Remote' }, 'A')
  const tree = render()
  const input = findTitleInput(tree)
  assert.ok(input?.props?.onKeyDown)
  input.props.onKeyDown({ key: 'Enter' })
  assert.ok(h.get().modal)
  assert.equal(h.project().tasks[0].title, 'Remote')
  render()
  assert.equal(ui.captured.title, 'Draft')
  assert.ok(ui.captured.conflict)
})

test('folder identity tolerates detached legacy paths', () => {
  assert.equal(projectPathKey(undefined), '')
  assert.equal(projectPathKey(null), '')
  const h = domainStore()
  h.set((s) => {
    delete (s.projects[0] as Partial<Project>).path
  })
  h.get().up((p) => {
    p.name = 'renamed'
  }, 'A')
  assert.equal(h.project().name, 'renamed')
})

function imageHarness() {
  const h = domainStore()
  const ui = uiHarness(h)
  h.get().createDoc('A')
  const wait = deferred<string>()
  const mod = ui.load(
    '../../workspace/DocView.tsx',
    {
      '../lib/imgscale': { isImageFile: () => true, shrinkImage: () => wait.promise },
    },
    ['  const done =', '  __capture({ addImages });\n  const done ='],
  )
  ui.render(() => (mod.DocView as (p: { doc: model.Doc }) => unknown)({ doc: h.project().docs[0] }))
  return {
    h,
    ui,
    wait,
    insert: ui.captured.addImages as (
      f: File[],
      after: string,
      replace: string,
      expected?: string,
    ) => Promise<void>,
  }
}

test('R03 negative: pending replacement must not erase text typed into the target', async () => {
  const { h, wait, insert } = imageHarness()
  const d = h.project().docs[0],
    target = d.blocks[0].id
  const pending = insert([{} as File], target, target)
  h.get().updateDoc(d.id, { blocks: [{ id: target, type: 'p', text: 'CONCURRENT LOCAL TEXT' }] }, 'A')
  wait.resolve('data:image/png;base64,SAFE')
  await pending
  const blocks = h.project().docs[0].blocks
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].text, 'CONCURRENT LOCAL TEXT')
  assert.equal(blocks[1].type, 'image')
})

test('R03 control: unchanged empty placeholder is still replaced, not duplicated', async () => {
  const { h, wait, insert } = imageHarness()
  const target = h.project().docs[0].blocks[0].id
  const pending = insert([{} as File], target, target)
  wait.resolve('data:image/png;base64,SAFE')
  await pending
  assert.equal(h.project().docs[0].blocks.length, 1)
  assert.equal(h.project().docs[0].blocks[0].id, target)
  assert.equal(h.project().docs[0].blocks[0].type, 'image')
})

test('R03 negative: changed empty block structure is preserved; image is appended', async () => {
  const { h, wait, insert } = imageHarness()
  const d = h.project().docs[0],
    target = d.blocks[0].id
  const pending = insert([{} as File], target, target)
  h.get().updateDoc(d.id, { blocks: [{ id: target, type: 'todo', text: '', checked: true }] }, 'A')
  wait.resolve('data:image/png;base64,SAFE')
  await pending
  assert.equal(h.project().docs[0].blocks.length, 2)
  assert.equal(h.project().docs[0].blocks[0].type, 'todo')
  assert.equal(h.project().docs[0].blocks[0].checked, true)
})

test('R04 negative: backup import uses full detach even when source id is not occupied', async () => {
  const h = domainStore()
  const ui = uiHarness(h)
  const p = clone(h.project())
  p.id = 'removed-source'
  p.deploy.auto = true
  p.mirror = true
  p.cloud = { pid: 'private-team', rev: 7, owner: true, ownerId: 'me' }
  p.files = { 'keep.txt': 'KEEP CONTENT' }
  const version = {
    n: 1,
    title: 'First',
    at: 1,
    by: 'human' as const,
    author: 'me',
    tag: 'build' as const,
    feats: [],
    changes: [],
    fixes: [],
    details: [],
    snapshot: { 'keep.txt': 'OLD' },
  }
  const fullVersions = [
    version,
    { ...version, n: 2, title: 'Second', snapshot: { 'keep.txt': 'KEEP CONTENT' } },
  ]
  p.versions = snapshots.packVersions(fullVersions) as unknown as Project['versions']
  p.chats = [
    {
      id: 'c',
      title: 'Keep chat',
      creator: { kind: 'human', id: 'me' },
      agents: [],
      running: true,
      createdAt: 1,
      lastAt: 1,
      messages: [
        {
          id: 'm',
          kind: 'agent',
          agent: 'builder',
          text: 'PARTIAL CONTENT',
          at: 1,
          streaming: true,
          thinking: 'busy',
          parts: [{ k: 'cmd', id: 'cmd', cmd: 'synthetic', state: 'running', out: 'KEEP OUTPUT' }],
        },
      ],
    },
  ]
  const json = JSON.stringify({ app: 'tetrafree', v: 1, projects: [p] })
  const mod = ui.load('../../lib/backup.ts')
  const count = await (mod.importBackup as (f: File) => Promise<number>)({
    size: json.length,
    text: async () => json,
  } as File)
  assert.equal(count, 1)
  const imported = h.get().projects[2]
  assert.notEqual(imported.id, p.id)
  assert.equal(imported.cloud, undefined)
  assert.equal(imported.path, '')
  assert.equal(imported.deploy.auto, false)
  assert.equal(imported.mirror, undefined)
  assert.equal(imported.chats[0].running, false)
  assert.equal(imported.files['keep.txt'], 'KEEP CONTENT')
  assert.equal(imported.chats[0].title, 'Keep chat')
  assert.deepEqual(imported.versions, fullVersions)
  const message = imported.chats[0].messages[0]
  assert.equal(message.text, 'PARTIAL CONTENT')
  assert.equal(message.kind, 'agent')
  if (message.kind === 'agent') {
    assert.equal(message.streaming, false)
    assert.equal(message.stopped, true)
    assert.equal(message.thinking, undefined)
    assert.equal(message.parts?.[0].k, 'cmd')
    const part = message.parts?.[0]
    if (part?.k === 'cmd') {
      assert.equal(part.state, 'error')
      assert.equal(part.out, 'KEEP OUTPUT')
    }
  }

  assert.equal(h.project().path, 'C:/work/A')
  assert.equal(h.get().projects.length, 3)
})

type CallbackNode = { props?: Record<string, unknown> }
function findNode(
  node: unknown,
  predicate: (props: Record<string, unknown>) => boolean,
): CallbackNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    const n = node as CallbackNode
    if (n.props && predicate(n.props)) return n
    return findNode(n.props?.children, predicate)
  }
}
function memoryUndoFixture(withMatchingId = false) {
  const h = domainStore()
  h.get().remember({ text: 'PRIVATE A', by: 'test', kind: 'fact' }, 'A')
  const mid = h.project().memory[0].id
  h.set((s) => {
    s.projects[0].cloud = { pid: 'private-team', rev: 1, owner: true, ownerId: 'me' }
    if (withMatchingId) s.projects[1].memory = [{ ...s.projects[0].memory[0], text: 'PRIVATE B' }]
  })
  const ui = uiHarness(h)
  const mod = ui.load('../../modals/Activity.tsx', {}, [
    '  const [fact, setFact]',
    '  __capture({ setTab });\n  const [fact, setFact]',
  ])
  const render = () => ui.render(() => (mod.ActivityModal as () => unknown)())
  render()
  ;(ui.captured.setTab as (tab: string) => void)('memory')
  const remove = findNode(render(), (p) => p.title === 'Забыть')
  assert.ok(remove?.props?.onClick)
  ;(remove.props.onClick as () => void)()
  const notice = ui.notices[ui.notices.length - 1] as { action?: { run: () => void } }
  assert.ok(notice.action)
  return { h, ui, mid, undo: notice.action.run }
}

test('R05 negative: actual memory undo restores A after switch to B with no matching id', () => {
  const { h, mid, undo } = memoryUndoFixture()
  const tombAt = h.project().cloud!.tomb![mid]
  h.get().openProject('B')
  const center = h.get().center
  undo()
  assert.equal(h.project().memory[0].text, 'PRIVATE A')
  assert.equal(h.project('B').memory.length, 0)
  assert.equal(h.project().cloud?.tomb?.[mid], undefined)
  assert.ok(h.project().memory[0].at > tombAt)
  assert.deepEqual(h.get().center, center)
})

test('R05 negative: memory undo cannot touch duplicate id in B or overwrite a restored live note', () => {
  const { h, mid, undo } = memoryUndoFixture(true)
  h.get().openProject('B')
  undo()
  assert.equal(h.project('B').memory[0].text, 'PRIVATE B')
  h.get().up((p) => {
    p.memory[0].text = 'NEW A'
  }, 'A')
  undo()
  assert.equal(h.project().memory[0].text, 'NEW A')
  assert.equal(h.project('B').memory[0].id, mid)
})

test('R05 negative: deleted origin means no memory fallback; user receives warning', () => {
  const { h, ui, undo } = memoryUndoFixture()
  h.get().deleteProject('A')
  h.get().openProject('B')
  undo()
  assert.equal(h.project('B').memory.length, 0)
  assert.match(JSON.stringify(ui.notices), /Исходный проект удалён/)
})

function docCallbacksFixture() {
  const h = domainStore()
  const did = h.get().createDoc('A')
  h.get().duplicateProject('A')
  const copyId = h.get().projects[1].id
  const ui = uiHarness(h)
  let menuIndex = 0
  h.set((s) => {
    s.openModal = (modal) =>
      h.set((s) => {
        s.modal = modal
      })
  })
  const mod = ui.load('../../workspace/Sidebar.tsx', {
    '../components/ui/Menu': {
      useMenu: () => ({ st: ++menuIndex === 2 ? { data: h.project().docs[0] } : null, close: () => {} }),
    },
  })
  const tree = ui.render(() => (mod.Sidebar as () => unknown)())
  const renameItem = findNode(tree, (p) => p.label === 'Переименовать')
  assert.ok(renameItem?.props?.onClick)
  ;(renameItem.props.onClick as () => void)()
  const renameModal = h.get().modal
  assert.equal(renameModal?.type, 'rename')
  const removeItem = findNode(tree, (p) => p.label === 'Удалить документ')
  assert.ok(removeItem?.props?.onClick)
  ;(removeItem.props.onClick as () => void)()
  const deleteModal = h.get().modal
  assert.equal(deleteModal?.type, 'confirm')
  assert.ok(renameModal?.type === 'rename' && deleteModal?.type === 'confirm')
  return { h, ui, did, copyId, rename: renameModal.run, remove: deleteModal.run }
}

test('R06 negative: captured document rename/delete address A, never duplicate B', () => {
  const { h, did, copyId, rename, remove } = docCallbacksFixture()
  h.set((s) => {
    s.projects[0].cloud = { pid: 'team-a', rev: 1, owner: true, ownerId: 'me' }
  })
  h.get().openProject(copyId)
  const center = h.get().center
  rename('INTENDED FOR A')
  assert.equal(h.project().docs[0].title, 'INTENDED FOR A')
  assert.equal(h.project(copyId).docs[0].title, 'Без названия')
  remove()
  assert.equal(h.project().docs.length, 0)
  assert.equal(h.project(copyId).docs.length, 1)
  assert.ok(h.project().cloud?.tomb?.[did])
  assert.deepEqual(h.get().center, center)
})

test('R06 negative: captured document callbacks cannot fall back after origin deletion', () => {
  const { h, ui, copyId, rename, remove } = docCallbacksFixture()
  h.get().deleteProject('A')
  h.get().openProject(copyId)
  rename('SECRET')
  remove()
  assert.equal(h.project(copyId).docs.length, 1)
  assert.equal(h.project(copyId).docs[0].title, 'Без названия')
  assert.match(JSON.stringify(ui.notices), /Исходный/)
})

test('R03 negative: chooser replacement CAS keeps a block changed before compression starts', async () => {
  const { h, wait, insert } = imageHarness()
  const d = h.project().docs[0],
    target = d.blocks[0].id,
    expected = JSON.stringify(d.blocks[0])
  h.get().updateDoc(d.id, { blocks: [{ id: target, type: 'todo', text: '', checked: true }] }, 'A')
  const pending = insert([{} as File], target, target, expected)
  wait.resolve('data:image/png;base64,SAFE')
  await pending
  assert.equal(h.project().docs[0].blocks.length, 2)
  assert.equal(h.project().docs[0].blocks[0].type, 'todo')
  assert.equal(h.project().docs[0].blocks[0].checked, true)
})

test('R05 negative: actual memory edit/blur callback stays scoped to original modal project', () => {
  const h = domainStore()
  h.get().remember({ text: 'PRIVATE A', by: 'test', kind: 'fact' }, 'A')
  h.get().duplicateProject('A')
  const copyId = h.get().projects[1].id
  const mid = h.project().memory[0].id,
    ui = uiHarness(h)
  const mod = ui.load('../../modals/Activity.tsx', {}, [
    '  const goChat =',
    '  __capture({ setEdit, saveEdit, edit });\n  const goChat =',
  ])
  const render = () => ui.render(() => (mod.ActivityModal as () => unknown)())
  render()
  ;(ui.captured.setEdit as (v: unknown) => void)({ id: mid, text: 'NEW PRIVATE A' })
  h.get().openProject(copyId)
  render()
  ;(ui.captured.saveEdit as () => void)()
  assert.equal(h.project().memory[0].text, 'NEW PRIVATE A')
  assert.equal(h.project(copyId).memory[0].text, 'PRIVATE A')
  ;(ui.captured.setEdit as (v: unknown) => void)({ id: mid, text: 'UNSAVED' })
  h.get().deleteProject('A')
  render()
  ;(ui.captured.saveEdit as () => void)()
  render()
  assert.equal(h.project(copyId).memory[0].text, 'PRIVATE A')
  assert.ok(ui.captured.edit)
  assert.match(JSON.stringify(ui.notices), /Исходный проект или запись удалены/)
})

test('R05/R06 negative: explicit deleted pid actions never mutate matching ids in current copy', () => {
  const h = domainStore()
  const did = h.get().createDoc('A')
  h.get().remember({ text: 'MEMORY', by: 'test', kind: 'fact' }, 'A')
  const note = h.project().memory[0]
  h.get().duplicateProject('A')
  const copyId = h.get().projects[1].id
  h.get().deleteProject('A')
  h.get().openProject(copyId)
  const center = h.get().center
  h.get().editMemory(note.id, { text: 'SHOULD NOT APPLY' }, 'A')
  h.get().restoreMemory({ ...note, id: 'deleted-note' }, 'A')
  h.get().deleteDoc(did, 'A')
  assert.equal(h.project(copyId).docs.length, 1)
  assert.equal(h.project(copyId).memory.length, 1)
  assert.equal(h.project(copyId).memory[0].text, 'MEMORY')
  assert.deepEqual(h.get().center, center)
})
