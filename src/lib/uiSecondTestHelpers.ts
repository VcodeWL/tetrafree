/* Controlled TS-module execution for UI integrity regressions; no browser or listeners. */
import { readFileSync } from 'node:fs'
import { createStore } from 'zustand/vanilla'
import { produce } from 'immer'
import ts from 'typescript'
import { initialPersisted, initialUI } from '../store/defaults'
import { filesActions } from '../store/slices/files'
import type { Full, SetState, Toast, ModalState } from '../store/types'
import type { Project } from '../types'

export function executeSource(
  path: string,
  imports: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  return executeText(readFileSync(new URL(path, import.meta.url), 'utf8'), imports, globals)
}
export function executeText(
  source: string,
  imports: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(
    (name: string) => {
      if (!(name in imports)) throw new Error('Unexpected test import: ' + name)
      return imports[name]
    },
    module,
    module.exports,
    ...Object.values(globals),
  )
  return module.exports
}
export function initializer(path: string, name: string) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      result = node.initializer!.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (!result) throw new Error('Missing test initializer: ' + name)
  return result
}
export function timerFixture() {
  let id = 0
  const tasks = new Map<number, () => void>()
  return {
    tasks,
    setTimeout: (fn: () => void) => {
      tasks.set(++id, fn)
      return id
    },
    clearTimeout: (key: number) => {
      tasks.delete(key)
    },
    run: () => {
      const batch = [...tasks.values()]
      tasks.clear()
      batch.forEach((fn) => fn())
    },
  }
}
export function fileFixture(files: Record<string, string> = { 'site/index.html': 'base' }) {
  const events: Omit<Toast, 'id'>[] = []
  const projects = ['A', 'B'].map(
    (id) =>
      ({
        id,
        name: id,
        files: id === 'A' ? { ...files } : { 'site/index.html': 'other' },
        dirs: ['site'],
        versions: [],
        trash: [],
      }) as unknown as Project,
  )
  const store = createStore<Full>()(
    () => ({ ...initialPersisted(), ...initialUI(), projects, projectId: 'A' }) as Full,
  )
  const set: SetState = (fn) => store.setState((state) => produce(state, fn))
  const actions = filesActions(set)
  set((s) => {
    Object.assign(s, actions)
    s.toast = (event) => {
      events.push(event)
    }
    s.openModal = (modal) =>
      set((state) => {
        state.modal = modal
      })
  })
  const api = { getState: store.getState, setState: set, subscribe: store.subscribe }
  return {
    store: api,
    set,
    events,
    project: (pid = 'A') => store.getState().projects.find((p) => p.id === pid)!,
    external: (path: string, text: string | undefined, pid = 'A') =>
      set((s) => {
        const p = s.projects.find((project) => project.id === pid)!
        if (text === undefined) delete p.files[path]
        else p.files[path] = text
      }),
    dialog: () => store.getState().modal as Extract<ModalState, { type: 'rename' }>,
  }
}
