import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as React from 'react'
import { renderToString } from 'react-dom/server'

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] }
function compile(file: string, imports: Record<string, unknown>, react: unknown) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'React', js)(
    (n: string) => {
      if (n in imports) return imports[n]
      if (n.startsWith('./')) return {} // All dynamically imported modals remain cold for synchronous SSR.
      throw new Error('Unexpected dependency ' + n)
    },
    mod,
    mod.exports,
    react,
  )
  return mod.exports
}
function fixture() {
  let closed = 0
  const state = {
    modal: { type: 'recovery' },
    screen: 'workspace',
    projectId: 'A',
    projects: [{ id: 'A' }],
    closeModal() {
      closed++
    },
  }
  const useStore = (selector: (s: typeof state) => unknown) => selector(state)
  return { useStore, closed: () => closed }
}

test('actual nested Suspense renders visible status and cancel for a cold RecoveryModal (SSR)', () => {
  const f = fixture()
  // Real Modal shell and React Suspense; focus effect mocked because no DOM is involved.
  const modal = compile(
    '../components/ui/Modal.tsx',
    {
      react: React,
      '../../store': { useStore: f.useStore },
      '../../hooks/useFocus': { useModalFocus() {} },
      './Icon': { Icon: () => null },
    },
    React,
  )
  const root = compile(
    './ModalRoot.tsx',
    { react: React, '../store': { useStore: f.useStore }, '../components/ui/Modal': modal },
    React,
  ) as { ModalRoot: React.ComponentType }
  const html = renderToString(React.createElement(root.ModalRoot))
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-label="Загрузка окна"/)
  assert.match(html, /role="status"/)
  assert.match(html, /Загружаю окно/)
  assert.match(html, /Отмена/)
})

test('inner fallback uses cancellable Modal shell; cancellation calls only closeModal', () => {
  const f = fixture()
  const react = {
    lazy: () => Symbol('lazy'),
    Suspense: Symbol('Suspense'),
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): Element => ({ type, props: props || {}, children }),
  }
  const Modal = Symbol('Modal'),
    MHead = Symbol('MHead')
  const root = compile(
    './ModalRoot.tsx',
    { react, '../store': { useStore: f.useStore }, '../components/ui/Modal': { Modal, MHead } },
    react,
  ) as { ModalRoot: () => Element }
  const suspense = root.ModalRoot()
  assert.equal(suspense.type, react.Suspense)
  const fallback = suspense.props.fallback as Element
  const body = (fallback.type as () => Element)()
  assert.equal(body.type, Modal)
  assert.equal(body.props.label, 'Загрузка окна')
  assert.equal(body.props.busy, undefined) // Esc/backdrop/head remain enabled in existing Modal shell.
  assert.equal((body.children[0] as Element).type, MHead)
  const cancel = body.children.find((n) => (n as Element).type === 'button') as Element
  assert.equal(cancel.props.type, 'button')
  ;(cancel.props.onClick as () => void)()
  assert.equal(f.closed(), 1)
})
