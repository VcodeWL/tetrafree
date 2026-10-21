/* Очередь сообщений: пока агент работает, новые сообщения не теряются — они отправятся по очереди. */
import { create } from 'zustand'
import type { Attachment, ID } from '../types'
import { runtimeKey } from './runtimeKey'
import { uid } from '../lib/util'

export interface Queued {
  id: ID
  text: string
  atts: Attachment[]
  /** развёрнутая команда или навык: уходит модели вместе с сообщением */
  extra?: string
}
export interface QueueState {
  q: Record<string, Queued[]>
}
export const useQueue = create<QueueState>(() => ({ q: {} }))
const EMPTY: readonly Queued[] = Object.freeze([])
export const queueFor = (state: QueueState, pid: ID | undefined, chatId: ID): readonly Queued[] =>
  state.q[runtimeKey(pid, chatId)] || EMPTY
export const queueGet = (chatId: ID, pid?: ID): readonly Queued[] =>
  queueFor(useQueue.getState(), pid, chatId)
export const enqueue = (chatId: ID, text: string, atts: Attachment[], extra?: string, pid?: ID) => {
  const k = runtimeKey(pid, chatId)
  useQueue.setState((s) => ({
    q: { ...s.q, [k]: [...(s.q[k] || []), { id: uid('q'), text, atts, ...(extra ? { extra } : {}) }] },
  }))
}
export const dequeue = (chatId: ID, id: ID, pid?: ID) => {
  const k = runtimeKey(pid, chatId)
  useQueue.setState((s) => ({ q: { ...s.q, [k]: (s.q[k] || []).filter((x) => x.id !== id) } }))
}
export const peekQueue = (chatId: ID, pid?: ID): Queued | undefined => queueGet(chatId, pid)[0]
export function shiftQueue(chatId: ID, pid?: ID): Queued | undefined {
  const first = peekQueue(chatId, pid)
  if (first) dequeue(chatId, first.id, pid)
  return first
}
const generations = new Map<string, number>()
export const queueGeneration = (chatId: ID, pid?: ID) => generations.get(runtimeKey(pid, chatId)) || 0
export const clearQueue = (chatId: ID, pid?: ID) => {
  const k = runtimeKey(pid, chatId)
  generations.set(k, (generations.get(k) || 0) + 1)
  useQueue.setState((s) => ({ q: { ...s.q, [k]: [] } }))
}
export function clearAllQueues() {
  for (const k of Object.keys(useQueue.getState().q)) generations.set(k, (generations.get(k) || 0) + 1)
  useQueue.setState({ q: {} })
}

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
export const moveQueued = (chatId: ID, id: ID, dir: number, pid?: ID) => {
  const k = runtimeKey(pid, chatId)
  useQueue.setState((s) => ({ q: { ...s.q, [k]: moveItem(s.q[k] || [], id, dir) } }))
}
/** «Срочно»: в самое начало очереди этого проекта, не его копии. */
export const prioritize = (chatId: ID, id: ID, pid?: ID) => moveQueued(chatId, id, -1e9, pid)
