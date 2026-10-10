/* Очередь сообщений: пока агент работает, новые сообщения не теряются — они отправятся по очереди. */
import { create } from 'zustand'
import type { Attachment, ID } from '../types'
import { uid } from '../lib/util'

export interface Queued {
  id: ID
  text: string
  atts: Attachment[]
  /** развёрнутая команда или навык: уходит модели вместе с сообщением */
  extra?: string
}
export const useQueue = create<{ q: Record<ID, Queued[]> }>(() => ({ q: {} }))
export const enqueue = (chatId: ID, text: string, atts: Attachment[], extra?: string) =>
  useQueue.setState((s) => ({
    q: {
      ...s.q,
      [chatId]: [...(s.q[chatId] || []), { id: uid('q'), text, atts, ...(extra ? { extra } : {}) }],
    },
  }))
export const dequeue = (chatId: ID, id: ID) =>
  useQueue.setState((s) => ({ q: { ...s.q, [chatId]: (s.q[chatId] || []).filter((x) => x.id !== id) } }))
export function shiftQueue(chatId: ID): Queued | undefined {
  const list = useQueue.getState().q[chatId] || []
  const first = list[0]
  if (first) dequeue(chatId, first.id)
  return first
}
export const clearQueue = (chatId: ID) => useQueue.setState((s) => ({ q: { ...s.q, [chatId]: [] } }))

/** Сдвиг элемента на `dir` позиций (-1 выше, +1 ниже); за границы не выходит. Чистая функция. */
export function moveItem<T extends { id: string }>(list: T[], id: string, dir: number): T[] {
  const i = list.findIndex((x) => x.id === id)
  if (i < 0) return list
  const j = Math.max(0, Math.min(list.length - 1, i + dir))
  if (i === j) return list
  const out = [...list]
  out.splice(j, 0, out.splice(i, 1)[0])
  return out
}
export const moveQueued = (chatId: ID, id: ID, dir: number) =>
  useQueue.setState((s) => ({ q: { ...s.q, [chatId]: moveItem(s.q[chatId] || [], id, dir) } }))
/** «Срочно»: в самое начало очереди — уйдёт сразу, как агент освободится */
export const prioritize = (chatId: ID, id: ID) =>
  useQueue.setState((s) => ({ q: { ...s.q, [chatId]: moveItem(s.q[chatId] || [], id, -1e9) } }))
