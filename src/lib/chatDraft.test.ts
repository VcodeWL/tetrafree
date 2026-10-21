import test from 'node:test'
import assert from 'node:assert/strict'
import { produce } from 'immer'
import { chatsActions } from '../store/slices/chats'
import { projectsActions } from '../store/slices/projects'
import { tasksActions } from '../store/slices/tasks'
import { initialPersisted, initialUI } from '../store/defaults'
import { emptyProject } from '../data/seed'
import type { Full, SetState } from '../store/types'
import type { Message } from '../types'
import { draftKey, readChatDraft, copyLegacyDraftText, recoverableLegacyDraft } from './chatDraft'

function fixture() {
  let state = { ...initialPersisted(), ...initialUI() } as Full
  const set: SetState = (fn) => {
    state = produce(state, fn)
  }
  Object.assign(
    state,
    chatsActions(set),
    projectsActions(set),
    tasksActions(set, () => state),
  )
  set((s) => {
    s.projects = [emptyProject({ id: 'A', name: 'A', path: '' })]
  })
  state.openProject('A')
  const chat = state.createChat({ title: 'Private', creator: { kind: 'human', id: 'me' }, agents: [] }, 'A')
  const duplicate = () => {
    state.duplicateProject('A')
    return state.projects[1].id
  }
  return { get: () => state, set, chat, duplicate }
}

test('actual duplicateProject preserves ids but new scoped drafts never leak or overwrite', () => {
  const f = fixture()
  f.get().setDraft(f.chat, 'PRIVATE A', 'A')
  const bid = f.duplicate()
  f.get().openProject(bid)
  assert.equal(readChatDraft(f.get(), bid, f.chat), '')
  f.get().setDraft(f.chat, 'PRIVATE B', bid)
  assert.equal(readChatDraft(f.get(), 'A', f.chat), 'PRIVATE A')
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'PRIVATE B')
  assert.equal(f.get().drafts[draftKey('A', f.chat)], 'PRIVATE A')
})

test('captured A writer after switch to actual duplicate B still only addresses A', () => {
  const f = fixture(),
    bid = f.duplicate()
  const staleWrite = (value: string) => f.get().setDraft(f.chat, value, 'A')
  f.get().openProject(bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  staleWrite('LATE A')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), 'LATE A')
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'KEEP B')
})

test('unique legacy reads unchanged, new edits preserve raw legacy bytes', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'old\n\n\n'
  })
  assert.equal(readChatDraft(f.get(), 'A', f.chat), 'old\n\n\n')
  f.get().setDraft(f.chat, 'NEW', 'A')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), 'NEW')
  assert.equal(f.get().drafts[f.chat], 'old\n\n\n')
})

test('ambiguous legacy is never auto-displayed; explicit current-target copy appends without consuming raw', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'OLD PRIVATE\n'
  })
  const bid = f.duplicate()
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
  assert.equal(readChatDraft(f.get(), bid, f.chat), '')
  assert.equal(recoverableLegacyDraft(f.get(), bid, f.chat), 'OLD PRIVATE\n')
  f.get().openProject(bid)
  f.set((s) => {
    s.center = { kind: 'chat', id: f.chat }
  })
  f.get().setDraft(f.chat, 'KEEP CURRENT', bid)
  const text = copyLegacyDraftText(f.get(), bid, f.chat)
  assert.equal(text, 'KEEP CURRENT\n\nOLD PRIVATE\n')
  f.get().setDraft(f.chat, text!, bid)
  assert.equal(f.get().drafts[f.chat], 'OLD PRIVATE\n')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
})

test('cleared scoped entry cannot resurrect legacy even when duplicated owner is removed', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'LEGACY'
  })
  const bid = f.duplicate()
  f.get().setDraft(f.chat, '', 'A')
  f.get().deleteProject(bid)
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
  assert.equal(f.get().drafts[f.chat], 'LEGACY')
})

test('explicit missing project or chat cannot write/read/fallback or recover into active copy', () => {
  const f = fixture(),
    bid = f.duplicate()
  f.get().openProject(bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  f.get().deleteProject('A')
  const before = { ...f.get().drafts }
  f.get().setDraft(f.chat, 'LEAK', 'A')
  f.get().setDraft('missing-chat', 'LEAK', bid)
  assert.deepEqual(f.get().drafts, before)
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
  assert.equal(copyLegacyDraftText(f.get(), 'A', f.chat), undefined)
})

test('old no-pid action remains current-target compatible, without writing raw chatId', () => {
  const f = fixture()
  f.get().setDraft(f.chat, 'current')
  assert.equal(f.get().drafts[draftKey('A', f.chat)], 'current')
  assert.equal(f.get().drafts[f.chat], undefined)
})

test('recovery refuses stale project/chat context and keeps source plus target unchanged', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'LEGACY'
  })
  const bid = f.duplicate()
  f.get().openProject(bid)
  assert.equal(copyLegacyDraftText(f.get(), 'A', f.chat), undefined)
  f.set((s) => {
    s.center = { kind: 'empty' }
  })
  assert.equal(copyLegacyDraftText(f.get(), bid, f.chat), undefined)
  assert.deepEqual(f.get().drafts, { [f.chat]: 'LEGACY' })
})

test('scoped key encoding is collision-safe for compound identities', () => {
  assert.notEqual(draftKey('a:b', 'c'), draftKey('a', 'b:c'))
  assert.notEqual(draftKey('a",[', 'x'), draftKey('a', '",[x'))
})

// Real Composer JSX and closures, with inert network/runtime and minimal hooks (not browser E2E).
import fs from 'node:fs'
import ts from 'typescript'
import * as drafts from './chatDraft'
import * as util from './util'
import * as runtimeQueue from '../agent/queue'

type UiNode = { type?: unknown; props?: Record<string, unknown> }
function nodeMatching(
  node: unknown,
  match: (p: Record<string, unknown>, type: unknown) => boolean,
): UiNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = nodeMatching(child, match)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    const n = node as UiNode
    if (n.props && match(n.props, n.type)) return n
    return nodeMatching(n.props?.children, match)
  }
}
function composer(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  const cells: { value: unknown }[] = [],
    effects: (() => unknown)[] = [],
    listeners = new Map<string, (e: unknown) => void>()
  let cursor = 0
  const calls: unknown[][] = []
  const cell = (initial: unknown) => {
    const i = cursor++
    return (cells[i] ||= { value: initial })
  }
  const hookStore = Object.assign((selector: (s: Full) => unknown) => selector(f.get()), { getState: f.get })
  const record = (...args: unknown[]) => {
    calls.push(args)
    return 'clear'
  }
  const mocks: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const c = cell(initial)
        return [
          c.value,
          (next: unknown) => {
            c.value = typeof next === 'function' ? (next as (v: unknown) => unknown)(c.value) : next
          },
        ]
      },
      useRef: (initial: unknown) => cell({ current: initial }).value,
      useMemo: (fn: () => unknown) => fn(),
      useEffect: (fn: () => unknown) => effects.push(fn),
    },
    '../store': { useStore: hookStore },
    '../lib/chatDraft': drafts,
    '../lib/util': util,
    '../agent/engine': {
      resolveModel: () => ({ label: 'Synthetic', live: false }),
      sendMessage: record,
      stopTurn: record,
    },
    '../agent/commands': { submit: record },
    '../agent/queue': {
      useQueue: (sel: (s: object) => unknown) => sel({ q: {} }),
      queueFor: () => [],
      queueGet: () => [],
      dequeue: record,
      shiftQueue: record,
      moveQueued: record,
      prioritize: record,
    },
    '../agent/loop': {
      useLoops: (sel: (s: object) => unknown) => sel({ loops: {} }),
      loopFor: () => undefined,
      loopStop: record,
      loopLabel: () => '',
    },
    '../agent/slash': { suggest: () => [], fmtGap: () => '' },
    ...overrides,
  }
  const src = fs.readFileSync(new URL('../workspace/Composer.tsx', import.meta.url), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const mod = { exports: {} as { Composer?: (props: { chatId: string; running: boolean }) => unknown } }
  new Function('require', 'module', 'exports', 'window', js)(
    (id: string) =>
      id === 'react/jsx-runtime'
        ? {
            jsx: (type: unknown, props: unknown) => ({ type, props }),
            jsxs: (type: unknown, props: unknown) => ({ type, props }),
          }
        : mocks[id] || {},
    mod,
    mod.exports,
    {
      addEventListener: (name: string, callback: (e: unknown) => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  )
  const render = () => {
    cursor = 0
    effects.length = 0
    return mod.exports.Composer!({ chatId: f.chat, running: false })
  }
  return { render, effects, listeners, calls }
}

function viewChat(f: ReturnType<typeof fixture>, pid: string) {
  f.get().openProject(pid)
  f.set((s) => {
    s.center = { kind: 'chat', id: f.chat }
    s.toast ||= () => {}
  })
}

test('actual Composer displays scoped draft; old A onChange after B switch cannot overwrite B', () => {
  const f = fixture()
  f.get().setDraft(f.chat, 'PRIVATE A', 'A')
  const bid = f.duplicate()
  viewChat(f, 'A')
  const a = composer(f),
    tree = a.render()
  const input = nodeMatching(tree, (_p, type) => type === 'textarea')!
  assert.equal(input.props?.value, 'PRIVATE A')
  viewChat(f, bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  ;(input.props!.onChange as (e: unknown) => void)({ target: { value: 'LATE A' } })
  const bInput = nodeMatching(composer(f).render(), (_p, type) => type === 'textarea')!
  assert.equal(bInput.props?.value, 'KEEP B')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), 'LATE A')
  const send = nodeMatching(tree, (p) => p['aria-label'] === 'Отправить')!
  ;(send.props!.onClick as () => void)()
  assert.equal(a.calls.length, 0)
})

test('actual Composer hides ambiguous raw and recovery appends only to explicit current target', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'OLD PRIVATE\n'
  })
  const bid = f.duplicate()
  viewChat(f, 'A')
  const a = composer(f),
    oldTree = a.render()
  const recoverA = nodeMatching(oldTree, (p) => p.children === 'Скопировать старый черновик в этот чат')!
  assert.equal(nodeMatching(oldTree, (_p, type) => type === 'textarea')?.props?.value, '')
  viewChat(f, bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  ;(recoverA.props!.onClick as () => void)()
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'KEEP B')
  const b = composer(f),
    recoverB = nodeMatching(b.render(), (p) => p.children === 'Скопировать старый черновик в этот чат')!
  // Reread on click rather than overwrite text entered since render.
  f.get().setDraft(f.chat, 'NEWER B', bid)
  ;(recoverB.props!.onClick as () => void)()
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'NEWER B\n\nOLD PRIVATE\n')
  assert.equal(f.get().drafts[f.chat], 'OLD PRIVATE\n')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
})

test('actual Composer captured recovery/input after origin deletion do not fall back to copy', () => {
  const f = fixture()
  f.set((s) => {
    s.drafts[f.chat] = 'OLD PRIVATE'
  })
  const bid = f.duplicate()
  viewChat(f, 'A')
  const a = composer(f),
    tree = a.render()
  const recover = nodeMatching(tree, (p) => p.children === 'Скопировать старый черновик в этот чат')!
  const input = nodeMatching(tree, (_p, type) => type === 'textarea')!
  f.get().deleteProject('A')
  viewChat(f, bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  const before = { ...f.get().drafts }
  ;(recover.props!.onClick as () => void)()
  ;(input.props!.onChange as (e: unknown) => void)({ target: { value: 'LEAK' } })
  assert.deepEqual(f.get().drafts, before)
})

test('actual Composer uses real scoped queue selectors and captured controls, never clone queue', () => {
  const f = fixture(),
    bid = f.duplicate()
  runtimeQueue.useQueue.setState({ q: {} })
  try {
    runtimeQueue.enqueue(f.chat, 'QUEUE A', [], undefined, 'A')
    viewChat(f, bid)
    const runtime = {
      ...runtimeQueue,
      useQueue: (sel: (s: runtimeQueue.QueueState) => unknown) => sel(runtimeQueue.useQueue.getState()),
    }
    const bEmpty = composer(f, { '../agent/queue': runtime }).render()
    assert.equal(
      nodeMatching(bEmpty, (p) => p['aria-label'] === 'Очередь сообщений'),
      undefined,
    )
    viewChat(f, 'A')
    const aTree = composer(f, { '../agent/queue': runtime }).render()
    const removeA = nodeMatching(aTree, (p) => p['aria-label'] === 'Убрать из очереди')!
    viewChat(f, bid)
    runtimeQueue.enqueue(f.chat, 'KEEP QUEUE B', [], undefined, bid)
    ;(removeA.props!.onClick as () => void)()
    assert.deepEqual(runtimeQueue.queueGet(f.chat, 'A'), [])
    assert.equal(runtimeQueue.queueGet(f.chat, bid)[0].text, 'KEEP QUEUE B')
    const b = composer(f, { '../agent/queue': runtime })
    const sendB = nodeMatching(b.render(), (p) => p.children === 'Отправить')!
    ;(sendB.props!.onClick as () => void)()
    assert.equal(b.calls[0][0], f.chat)
    assert.equal(b.calls[0][1], 'KEEP QUEUE B')
    assert.deepEqual(b.calls[0][5], { pid: bid })
  } finally {
    runtimeQueue.useQueue.setState({ q: {} })
  }
})

test('actual ChatView quote callback requires captured current project and writes fresh scoped text', () => {
  const f = fixture(),
    bid = f.duplicate()
  f.set((s) => {
    s.drafts[f.chat] = 'RAW LEGACY'
  })
  const { render, events } = messageActions(f)
  const quote = (pid: string) => {
    const tree = render({
      pid,
      chatId: f.chat,
      m: { id: 'message', kind: 'human', text: 'QUOTE' },
    })
    return nodeMatching(tree, (p) => p['aria-label'] === 'Ответить цитатой')!.props!.onClick as () => void
  }
  viewChat(f, 'A')
  const oldQuote = quote('A')
  viewChat(f, bid)
  f.get().setDraft(f.chat, 'KEEP B', bid)
  oldQuote()
  assert.equal(events.length, 0)
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'KEEP B')
  const currentQuote = quote(bid)
  f.get().setDraft(f.chat, 'NEWER B', bid)
  currentQuote()
  assert.equal(readChatDraft(f.get(), bid, f.chat), 'NEWER B\n\n> QUOTE\n\n')
  assert.equal(f.get().drafts[f.chat], 'RAW LEGACY')
  assert.equal(readChatDraft(f.get(), 'A', f.chat), '')
  f.get().deleteProject(bid)
  viewChat(f, 'A')
  const before = { ...f.get().drafts }
  currentQuote()
  assert.deepEqual(f.get().drafts, before)
})

function messageActions(f: ReturnType<typeof fixture>) {
  const src = fs.readFileSync(new URL('../workspace/ChatView.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('ChatView.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'MsgActions')!
  assert.ok(fn)
  const js = ts.transpileModule(fn.getText(ast) + '\nexport { MsgActions }', {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const mod = { exports: {} as { MsgActions?: (props: object) => unknown } },
    events: unknown[] = []
  new Function(
    'require',
    'module',
    'exports',
    'useStore',
    'isCurrentDraftTarget',
    'readChatDraft',
    'Icon',
    'window',
    'CustomEvent',
    'getProject',
    js,
  )(
    () => ({
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    }),
    mod,
    mod.exports,
    { getState: f.get },
    drafts.isCurrentDraftTarget,
    drafts.readChatDraft,
    () => null,
    { dispatchEvent: (e: unknown) => events.push(e) },
    class {
      constructor(
        public type: string,
        public detail: unknown,
      ) {}
    },
    () => f.get().projects.find((p) => p.id === f.get().projectId),
  )
  return { render: mod.exports.MsgActions!, events }
}

function messageFixture() {
  const f = fixture()
  f.get().pushMsg(f.chat, { id: 'human', kind: 'human', text: 'A PRIVATE TASK', at: 1, author: 'me' }, 'A')
  const bid = f.duplicate(),
    toasts: Parameters<Full['toast']>[0][] = [],
    modals: unknown[] = []
  f.set((s) => {
    s.toast = (t) => {
      toasts.push(t)
    }
    s.openModal = (m) => {
      modals.push(m)
    }
  })
  const ui = messageActions(f)
  const controls = (pid: string) => {
    const m = f
      .get()
      .projects.find((p) => p.id === pid)!
      .chats.find((c) => c.id === f.chat)!
      .messages.find((m) => m.id === 'human')!
    const tree = ui.render({ pid, chatId: f.chat, m })
    return (label: string) =>
      nodeMatching(tree, (p) => p['aria-label'] === label)!.props!.onClick as () => void
  }
  return { ...f, bid, toasts, modals, controls }
}

test('D08 actual MsgActions stale pin cannot mutate clone and live pin uses captured pid', () => {
  const f = messageFixture()
  viewChat(f, 'A')
  const stale = f.controls('A')('Закрепить сообщение')
  viewChat(f, f.bid)
  const before = f.get().projects
  stale()
  assert.deepEqual(f.get().projects, before)
  const live = f.controls(f.bid)('Закрепить сообщение')
  live()
  assert.equal(
    f
      .get()
      .projects.find((p) => p.id === f.bid)!
      .chats[0].messages.find(
        (m): m is Extract<Message, { kind: 'human' }> => m.id === 'human' && m.kind === 'human',
      )!.pinned,
    true,
  )
  assert.equal(
    f
      .get()
      .projects.find((p) => p.id === 'A')!
      .chats[0].messages.find(
        (m): m is Extract<Message, { kind: 'human' }> => m.id === 'human' && m.kind === 'human',
      )!.pinned,
    undefined,
  )
})

test('D09 actual MsgActions task callback refuses stale project and stale toast never opens clone task', () => {
  const f = messageFixture()
  viewChat(f, 'A')
  const stale = f.controls('A')('Создать задачу из сообщения')
  viewChat(f, f.bid)
  stale()
  assert.equal(
    f.get().projects.reduce((n, p) => n + p.tasks.length, 0),
    0,
  )
  assert.equal(f.toasts.length, 0)
  viewChat(f, 'A')
  f.controls('A')('Создать задачу из сообщения')()
  const task = f.get().projects.find((p) => p.id === 'A')!.tasks[0]
  assert.equal(task.title, 'A PRIVATE TASK')
  assert.equal(f.get().projects.find((p) => p.id === f.bid)!.tasks.length, 0)
  const open = f.toasts[0].action!.run
  viewChat(f, f.bid)
  open()
  assert.equal(f.modals.length, 0)
  viewChat(f, 'A')
  open()
  assert.deepEqual(f.modals, [{ type: 'task', id: task.id }])
  f.set((s) => {
    s.projects.find((p) => p.id === 'A')!.tasks = []
  })
  open()
  assert.equal(f.modals.length, 1)
})

test('D08/D09 actual MsgActions reject deleted or changed source message and deleted project', () => {
  const f = messageFixture()
  viewChat(f, 'A')
  const controls = f.controls('A'),
    pin = controls('Закрепить сообщение'),
    task = controls('Создать задачу из сообщения')
  f.get().patchMsg(f.chat, 'human', { text: 'NEW SOURCE' }, 'A')
  pin()
  task()
  assert.equal(f.get().projects[0].tasks.length, 0)
  assert.equal(
    f
      .get()
      .projects[0].chats[0].messages.find(
        (m): m is Extract<Message, { kind: 'human' }> => m.id === 'human' && m.kind === 'human',
      )!.pinned,
    undefined,
  )
  f.set((s) => {
    s.projects.find((p) => p.id === 'A')!.chats[0].messages = []
  })
  pin()
  task()
  assert.equal(f.toasts.length, 0)
  f.get().deleteProject('A')
  viewChat(f, f.bid)
  const before = f.get().projects
  pin()
  task()
  assert.deepEqual(f.get().projects, before)
})

test('actual ChatView JSX sibling keys are role-distinct and remount both roles across clone pid', () => {
  const src = fs.readFileSync(new URL('../workspace/ChatView.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('ChatView.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const siblings: ts.JsxSelfClosingElement[] = []
  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) && ['Thread', 'Composer'].includes(n.tagName.getText(ast)))
      siblings.push(n)
    ts.forEachChild(n, visit)
  }
  visit(ast)
  assert.equal(siblings.length, 2)
  assert.equal(siblings[0].parent, siblings[1].parent)
  const js = ts.transpileModule(
    `export const render = (p,chat) => { const busy = false; return <>${siblings.map((n) => n.getText(ast)).join('\n')}</> }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText
  type KeyNode = { key: string; props: { children: KeyNode[] } }
  const mod = { exports: {} as { render?: (p: object, chat: object) => KeyNode } }
  const jsx = (type: unknown, props: unknown, key: string) => ({ type, props, key })
  new Function('require', 'module', 'exports', 'draftKey', 'Thread', 'Composer', js)(
    () => ({ jsx, jsxs: jsx }),
    mod,
    mod.exports,
    draftKey,
    () => null,
    () => null,
  )
  const keys = (pid: string, chatId: string) =>
    mod.exports.render!({ id: pid }, { id: chatId, agents: [] }).props.children.map((n) => n.key)
  const a = keys('A', 'same-chat'),
    b = keys('B', 'same-chat')
  assert.equal(new Set(a).size, 2, 'Thread and Composer are siblings: their React keys must differ')
  assert.notEqual(a[0], b[0], 'Thread must remount when project changes')
  assert.notEqual(a[1], b[1], 'Composer must remount when project changes')
  assert.deepEqual(keys('A', 'same-chat'), a, 'same project/chat keys remain stable')
  assert.notEqual(keys('A', 'other-chat')[0], a[0])
  assert.notEqual(keys('A', 'other-chat')[1], a[1])
})
