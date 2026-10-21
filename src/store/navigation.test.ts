import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as chatDraft from '../lib/chatDraft'
import { chatsActions } from './slices/chats'
import type { Full } from './types'

type Consumer = (line: number) => void
interface Navigation {
  gotoFile: (pid: string, file: string, line: number) => boolean
  consumeGoto: (pid: string, file: string, receive: Consumer) => () => void
  composeToChat: (pid: string, chat: string, text: string) => boolean
}
function fixture() {
  const listeners = new Set<() => void>()
  let now = 0
  const events: unknown[] = []
  const state = {
    screen: 'workspace',
    projectId: 'A',
    activeFile: 'a.txt',
    rightTab: 'code',
    rightOpen: true,
    projects: ['A', 'B'].map((id) => ({
      id,
      files: { 'a.txt': 'one\ntwo', 'b.txt': 'other' } as Record<string, string>,
      chats: [{ id: 'same' }],
    })),
    drafts: {} as Record<string, string>,
    center: { kind: 'doc', id: 'doc' },
    openFile(file: string) {
      state.activeFile = file
      state.rightTab = 'code'
      state.rightOpen = true
      emit()
    },
    setDraft(chat: string, text: string, pid?: string) {
      chatsActions((fn) => fn(state as unknown as Full)).setDraft(chat, text, pid)
      emit()
    },
    setCenter(center: { kind: string; id: string }) {
      state.center = center
      emit()
    },
  }
  function emit() {
    for (const cb of [...listeners]) cb()
  }
  const useStore = {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
  const src = fs.readFileSync(new URL('./navigation.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  class CustomEvent {
    constructor(
      public type: string,
      public options: unknown,
    ) {}
  }
  new Function('require', 'module', 'exports', 'window', 'CustomEvent', 'Date', js)(
    (id: string) => (id.endsWith('/chatDraft') ? chatDraft : { useStore }),
    mod,
    mod.exports,
    { dispatchEvent: (e: unknown) => events.push(e) },
    CustomEvent,
    { now: () => now },
  )
  return {
    nav: mod.exports as Navigation,
    state,
    emit,
    events,
    listeners,
    useStore,
    advance: () => {
      now = 60_001
    },
  }
}

test('cold compose persists immediately without Composer and preserves unsent draft', () => {
  const f = fixture()
  f.state.projects[1].chats = []
  f.state.drafts.same = 'unsent'
  assert.equal(f.nav.composeToChat('A', 'same', 'request'), true)
  assert.equal(chatDraft.readChatDraft(f.state, 'A', 'same'), 'unsent\n\nrequest')
  assert.equal(f.state.drafts.same, 'unsent')
  assert.deepEqual(f.state.center, { kind: 'chat', id: 'same' })
  assert.equal(f.events.length, 1)
})
test('compose retains original draft bytes including trailing newlines', () => {
  const f = fixture()
  f.state.projects[1].chats = []
  f.state.drafts.same = 'unsent\n\n\n'
  f.nav.composeToChat('A', 'same', 'request')
  assert.equal(chatDraft.readChatDraft(f.state, 'A', 'same'), 'unsent\n\n\n\n\nrequest')
})
test('compose refuses stale pid, missing chat and non-workspace without writes/navigation', () => {
  for (const kind of ['pid', 'chat', 'screen']) {
    const f = fixture()
    if (kind === 'pid') f.state.projectId = 'B'
    if (kind === 'chat') f.state.projects[0].chats = []
    if (kind === 'screen') f.state.screen = 'launcher'
    assert.equal(f.nav.composeToChat('A', 'same', 'request'), false)
    assert.deepEqual(f.state.drafts, {})
    assert.equal(f.state.center.kind, 'doc')
    assert.equal(f.events.length, 0)
  }
})
test('cold goto survives delayed mount, ACKs exactly once, no replay on remount', () => {
  const f = fixture(),
    got: number[] = []
  assert.equal(f.nav.gotoFile('A', 'a.txt', 2), true)
  assert.equal(f.listeners.size, 1)
  const off = f.nav.consumeGoto('A', 'a.txt', (line) => got.push(line))
  assert.deepEqual(got, [2])
  assert.equal(f.listeners.size, 0)
  off()
  f.nav.consumeGoto('A', 'a.txt', (line) => got.push(line))
  f.emit()
  assert.deepEqual(got, [2])
})
test('warm goto delivers immediately; unmounted consumer receives nothing', () => {
  const f = fixture(),
    got: number[] = []
  const off = f.nav.consumeGoto('A', 'a.txt', (line) => got.push(line))
  f.nav.gotoFile('A', 'a.txt', 2)
  off()
  f.nav.gotoFile('A', 'a.txt', 1)
  assert.deepEqual(got, [2])
  f.nav.consumeGoto('A', 'a.txt', (line) => got.push(line))
  assert.deepEqual(got, [2, 1])
})
test('pending goto is single-slot latest-wins, with no delivery to wrong target', () => {
  const f = fixture(),
    got: number[] = []
  f.nav.gotoFile('A', 'a.txt', 2)
  f.nav.gotoFile('A', 'b.txt', 1)
  f.nav.consumeGoto('B', 'b.txt', () => assert.fail('wrong project'))
  f.nav.consumeGoto('A', 'a.txt', () => assert.fail('old file'))
  f.nav.consumeGoto('A', 'b.txt', (line) => got.push(line))
  assert.deepEqual(got, [1])
  assert.equal(f.listeners.size, 0)
})
test('navigation away permanently cancels pending even if same pid/path is revisited', () => {
  for (const change of ['pid', 'file', 'screen', 'tab', 'close', 'delete', 'content']) {
    const f = fixture()
    f.nav.gotoFile('A', 'a.txt', 2)
    if (change === 'pid') f.state.projectId = 'B'
    if (change === 'file') f.state.activeFile = 'b.txt'
    if (change === 'screen') f.state.screen = 'launcher'
    if (change === 'tab') f.state.rightTab = 'browser'
    if (change === 'close') f.state.rightOpen = false
    if (change === 'delete') delete f.state.projects[0].files['a.txt']
    if (change === 'content') f.state.projects[0].files['a.txt'] = 'changed'
    f.emit()
    f.state.projectId = 'A'
    f.state.activeFile = 'a.txt'
    f.state.screen = 'workspace'
    f.state.rightTab = 'code'
    f.state.rightOpen = true
    f.state.projects[0].files['a.txt'] = 'one\ntwo'
    f.nav.consumeGoto('A', 'a.txt', () => assert.fail(change))
    assert.equal(f.listeners.size, 0)
  }
})
test('expiry cancels intent on mount; malformed/new stale requests do not open a file', () => {
  const f = fixture()
  f.nav.gotoFile('A', 'a.txt', 2)
  f.advance()
  f.nav.consumeGoto('A', 'a.txt', () => assert.fail('expired'))
  assert.equal(f.listeners.size, 0)
  for (const line of [NaN, Infinity, 0, -1, 1.2]) assert.equal(f.nav.gotoFile('A', 'b.txt', line), false)
  assert.equal(f.nav.gotoFile('B', 'b.txt', 1), false)
  assert.equal(f.nav.gotoFile('A', 'missing', 1), false)
  assert.equal(f.state.activeFile, 'a.txt')
})

test('production askAgent prefill uses original project and needs no mounted event consumer', () => {
  const f = fixture()
  const src = fs.readFileSync(new URL('../workspace/RightPane.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('RightPane.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = tree.statements.find(
    (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'askAgent',
  )!
  const js = ts.transpileModule(fn.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} as { askAgent?: (text: string) => void } }
  new Function('exports', 'useStore', 'composeToChat', js)(mod.exports, f.useStore, f.nav.composeToChat)
  mod.exports.askAgent!('cold request')
  assert.equal(chatDraft.readChatDraft(f.state, 'A', 'same'), 'cold request')
  f.state.projects[0].chats = []
  f.state.projectId = 'B'
  // existing B chat rather than stale A center; no createChat fallback required.
  mod.exports.askAgent!('B request')
  assert.equal(chatDraft.readChatDraft(f.state, 'B', 'same'), 'B request')
  assert.equal(chatDraft.readChatDraft(f.state, 'A', 'same'), '')
  assert.equal(f.state.drafts[chatDraft.draftKey('A', 'same')], 'cold request')
})

test('production search result rejects stale pid and queues live file goto until mount', () => {
  const f = fixture()
  const src = fs.readFileSync(new URL('../lib/search.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const mod = { exports: {} as { searchProject?: (p: unknown, q: string) => { run: () => void }[] } }
  new Function('require', 'module', 'exports', js)(
    (n: string) =>
      n.endsWith('/navigation')
        ? f.nav
        : n === '../store'
          ? { useStore: f.useStore }
          : { blockText: () => '' },
    mod,
    mod.exports,
  )
  const p = { ...f.state.projects[0], docs: [], tasks: [], chats: [], memory: [] }
  const hit = mod.exports.searchProject!(p, 'two')[0]
  f.state.projectId = 'B'
  hit.run()
  assert.equal(f.listeners.size, 0)
  f.state.projectId = 'A'
  hit.run()
  const got: number[] = []
  f.nav.consumeGoto('A', 'a.txt', (line) => got.push(line))
  assert.deepEqual(got, [2])
})

function effectSource(file: string, marker: string) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const tree = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result = ''
  function visit(n: ts.Node) {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(tree) === 'useEffect' &&
      n.arguments[0]?.getText(tree).includes(marker)
    )
      result = n.arguments[0].getText(tree)
    ts.forEachChild(n, visit)
  }
  visit(tree)
  assert.ok(result, marker)
  return (
    ts.transpileModule('const effect = ' + result, { compilerOptions: { target: ts.ScriptTarget.ES2020 } })
      .outputText + '\nreturn effect()'
  )
}

test('real CodeSurface mount consumes cold intent and cleans subscription; legacy wrong pid is ignored', () => {
  const f = fixture(),
    flashes: number[] = [],
    listeners = new Map<string, (e: unknown) => void>()
  const window = {
    addEventListener: (k: string, cb: (e: unknown) => void) => listeners.set(k, cb),
    removeEventListener: (k: string) => listeners.delete(k),
    clearTimeout() {},
    setTimeout() {
      return 1
    },
  }
  f.nav.gotoFile('A', 'a.txt', 2)
  const off = new Function(
    'consumeGoto',
    'useStore',
    'p',
    'file',
    'setFlash',
    'setFolded',
    'unfoldAt',
    'rangesRef',
    'stack',
    'window',
    effectSource('../workspace/CodeEditor.tsx', 'consumeGoto'),
  )(
    f.nav.consumeGoto,
    f.useStore,
    { id: 'A' },
    'a.txt',
    (n: number) => flashes.push(n),
    () => {},
    () => {},
    { current: new Map() },
    { current: null },
    window,
  ) as () => void
  assert.deepEqual(flashes, [2])
  listeners.get('tf:goto')!({ detail: { pid: 'B', file: 'a.txt', line: 1 } })
  assert.deepEqual(flashes, [2])
  off()
  assert.equal(listeners.size, 0)
  f.nav.gotoFile('A', 'a.txt', 1)
  assert.deepEqual(flashes, [2])
})

test('real Composer focus consumption does not overwrite persisted prefill and removes listeners', () => {
  const f = fixture(),
    listeners = new Map<string, (e: unknown) => void>(),
    ranges: number[] = []
  f.nav.composeToChat('A', 'same', 'prefill')
  const off = new Function(
    'useStore',
    'pid',
    'chatId',
    'setDraft',
    'isCurrentDraftTarget',
    'readChatDraft',
    'ta',
    'window',
    effectSource('../workspace/Composer.tsx', 'tf:compose-focus'),
  )(
    f.useStore,
    'A',
    'same',
    f.state.setDraft,
    chatDraft.isCurrentDraftTarget,
    chatDraft.readChatDraft,
    {
      current: {
        focus() {},
        setSelectionRange(a: number) {
          ranges.push(a)
        },
      },
    },
    {
      addEventListener: (k: string, cb: (e: unknown) => void) => listeners.set(k, cb),
      removeEventListener: (k: string) => listeners.delete(k),
    },
  ) as () => void
  listeners.get('tf:compose-focus')!({ detail: { pid: 'A', chatId: 'same' } })
  assert.equal(f.state.drafts[chatDraft.draftKey('A', 'same')], 'prefill')
  assert.deepEqual(ranges, [7])
  listeners.get('tf:compose')!({ detail: { chatId: 'same', text: 'unscoped stale payload' } })
  assert.equal(f.state.drafts[chatDraft.draftKey('A', 'same')], 'prefill')
  f.state.projectId = 'B'
  listeners.get('tf:compose')!({ detail: { pid: 'A', chatId: 'same', text: 'stale' } })
  listeners.get('tf:compose')!({ detail: { chatId: 'same', text: 42 } })
  assert.equal(f.state.drafts[chatDraft.draftKey('A', 'same')], 'prefill')
  off()
  assert.equal(listeners.size, 0)
})

test('compose prefill isolates duplicate ids and never copies ambiguous legacy into another project', () => {
  const f = fixture()
  f.state.drafts.same = 'PRIVATE LEGACY'
  assert.equal(f.nav.composeToChat('A', 'same', 'A request'), true)
  f.state.projectId = 'B'
  assert.equal(f.nav.composeToChat('B', 'same', 'B request'), true)
  assert.equal(chatDraft.readChatDraft(f.state, 'A', 'same'), 'A request')
  assert.equal(chatDraft.readChatDraft(f.state, 'B', 'same'), 'B request')
  assert.equal(f.state.drafts.same, 'PRIVATE LEGACY')
  const before = { ...f.state.drafts }
  assert.equal(f.nav.composeToChat('A', 'same', 'stale request'), false)
  assert.deepEqual(f.state.drafts, before)
})
