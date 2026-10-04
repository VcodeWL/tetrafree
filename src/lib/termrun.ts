/* Отправить команду в терминал: открывает панель, если она закрыта, и вводит команду как будто её набрали. */
import { useStore } from '../store'
let pending: string | null = null
export const takePendingPeek = () => pending !== null
export const takePending = () => {
  const c = pending
  pending = null
  return c
}
export function runInTerminal(cmd: string) {
  pending = cmd
  useStore.getState().setDock(true)
  window.dispatchEvent(new Event('tf:termrun'))
}
