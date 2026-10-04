import { useSyncExternalStore } from 'react'
import { RELEASES } from '../data/changelog'

const KEY = 'tf.seenRelease'
const ev = new EventTarget()
const latest = () => RELEASES[0].v
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
/* первый запуск: считаем текущую версию увиденной, чтобы не светить точку на пустом месте */
if (read() === null) {
  try {
    localStorage.setItem(KEY, latest())
  } catch {
    /* приватный режим */
  }
}

export const markSeen = () => {
  try {
    localStorage.setItem(KEY, latest())
  } catch {
    /* ignore */
  }
  ev.dispatchEvent(new Event('c'))
}
export function useUnseenRelease() {
  return useSyncExternalStore(
    (cb) => {
      ev.addEventListener('c', cb)
      return () => ev.removeEventListener('c', cb)
    },
    () => read() !== latest(),
  )
}
