import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Индекс, на который переходит фокус по Tab / Shift+Tab внутри замкнутой области; -1 — пусть решает браузер */
export function wrapIndex(count: number, current: number, back: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return back ? count - 1 : 0
  if (back) return current === 0 ? count - 1 : -1
  return current === count - 1 ? 0 : -1
}

export const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )

/** Модальное окно: фокус внутри (Tab не уходит на страницу под ним), при закрытии возвращается туда, откуда пришли */
export function useModalFocus(ref: RefObject<HTMLElement>) {
  /* запоминаем фокус во время рендера: autoFocus полей окна срабатывает при коммите, раньше любого эффекта */
  const before = useRef<HTMLElement | null | undefined>(undefined)
  if (before.current === undefined) before.current = document.activeElement as HTMLElement | null
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const prev = before.current
    /* подпись для скринридера: если aria-label не задан — берём заголовок окна */
    if (!root.getAttribute('aria-label') && !root.getAttribute('aria-labelledby')) {
      const h = root.querySelector('h2,h1')
      if (h) {
        h.id ||= 'mh' + Math.random().toString(36).slice(2, 7)
        root.setAttribute('aria-labelledby', h.id)
      }
    }
    /* если форма сама не взяла фокус — отдаём первому полю ввода, иначе самому окну */
    const t = setTimeout(() => {
      if (root.contains(document.activeElement) && document.activeElement !== root) return
      const first =
        root.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]),textarea') ||
        focusables(root).find((el) => !el.classList.contains('mclose'))
      if (first) first.focus()
      else {
        root.tabIndex = -1
        root.focus()
      }
    }, 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const list = focusables(root)
      const idx = wrapIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey)
      if (idx >= 0) {
        e.preventDefault()
        list[idx].focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      root.removeEventListener('keydown', onKey)
      setTimeout(() => {
        const a = document.activeElement
        if ((!a || a === document.body) && prev && prev.isConnected) prev.focus()
      }, 0)
    }
  }, [ref])
}

/** Для палитры и подобных оверлеев: после закрытия фокус возвращается на прежний элемент */
export function useReturnFocus(active: boolean) {
  const before = useRef<HTMLElement | null>(null)
  if (!active) before.current = document.activeElement as HTMLElement | null
  useEffect(() => {
    if (!active) return
    const prev = before.current
    return () => {
      setTimeout(() => {
        const a = document.activeElement
        if ((!a || a === document.body) && prev && prev.isConnected) prev.focus()
      }, 0)
    }
  }, [active])
}
