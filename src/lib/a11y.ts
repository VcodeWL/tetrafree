/* Клавиатурное управление для «кликабельных div»: Enter / Пробел активируют, стрелки переходят к соседям. */
import type { KeyboardEvent } from 'react'

export interface RowKeys {
  open: () => void
  rename?: () => void
  remove?: () => void
}

/** Что делать по клавише; null — клавиша не наша. Вынесено в чистую функцию ради тестов. */
export function rowAction(key: string): 'open' | 'rename' | 'remove' | 'prev' | 'next' | null {
  switch (key) {
    case 'Enter':
    case ' ':
      return 'open'
    case 'F2':
      return 'rename'
    case 'Delete':
      return 'remove'
    case 'ArrowUp':
      return 'prev'
    case 'ArrowDown':
      return 'next'
    default:
      return null
  }
}

/** onKeyDown для строки списка/дерева; `sel` — CSS-селектор всех строк для стрелок */
export function rowKeys(k: RowKeys, sel: string) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return
    const a = rowAction(e.key)
    if (!a) return
    if (a === 'rename' && !k.rename) return
    if (a === 'remove' && !k.remove) return
    e.preventDefault()
    if (a === 'open') k.open()
    else if (a === 'rename') k.rename!()
    else if (a === 'remove') k.remove!()
    else {
      const all = [...document.querySelectorAll<HTMLElement>(sel)]
      const i = all.indexOf(e.currentTarget)
      all[i + (a === 'next' ? 1 : -1)]?.focus()
    }
  }
}
