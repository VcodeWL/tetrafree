import { merge3 } from './merge3'

export interface EditorTarget {
  read: () => string | undefined
  write: (text: string) => void
  recover: (text: string) => void
}

/** One mounted document, not merely one pathname. A deleted generation never writes again. */
export function editorSession(target: EditorTarget) {
  let removed = target.read() === undefined
  return {
    observe() {
      if (target.read() === undefined) removed = true
    },
    save(base: string, text: string): { text: string; recovered: boolean } {
      if (base === text) return { text, recovered: false }
      const current = target.read()
      if (removed || current === undefined) {
        removed = true
        target.recover(text)
        return { text, recovered: true }
      }
      const merged =
        current === base
          ? text
          : merge3(base, text, current, { ours: 'мои правки', theirs: 'внешние правки' })?.text
      if (merged === undefined) {
        target.recover(text)
        return { text: current, recovered: true }
      }
      if (merged !== current) target.write(merged)
      return { text: merged, recovered: false }
    },
  }
}
