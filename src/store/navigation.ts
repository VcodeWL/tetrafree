/* Навигация не зависит от скорости загрузки UI. Один goto, подтверждаемый редактором;
   текст compose сразу становится черновиком, а не потеряемым DOM-событием. */
import { useStore } from './index'
import { readChatDraft } from '../lib/chatDraft'

const MAX_AGE = 60_000
let pending: { pid: string; file: string; line: number; text: string; until: number } | undefined
let off: (() => void) | undefined
const consumers = new Set<{ pid: string; file: string; receive: (line: number) => void }>()

function clear() {
  pending = undefined
  off?.()
  off = undefined
}
function deliver() {
  const intent = pending
  if (!intent) return
  const s = useStore.getState()
  const p = s.projects.find((p) => p.id === intent.pid)
  if (
    Date.now() >= intent.until ||
    s.screen !== 'workspace' ||
    s.projectId !== intent.pid ||
    s.activeFile !== intent.file ||
    s.rightTab !== 'code' ||
    !s.rightOpen ||
    p?.files[intent.file] !== intent.text
  ) {
    clear()
    return
  }
  const consumer = [...consumers].find((c) => c.pid === intent.pid && c.file === intent.file)
  if (consumer) {
    clear() // ACK before callback: remounts/reentrant store updates cannot replay it.
    consumer.receive(intent.line)
  }
}

export function gotoFile(pid: string, file: string, line: number): boolean {
  const s = useStore.getState()
  const p = s.projects.find((p) => p.id === pid)
  if (
    s.screen !== 'workspace' ||
    s.projectId !== pid ||
    !p ||
    !Object.prototype.hasOwnProperty.call(p.files, file) ||
    !Number.isSafeInteger(line) ||
    line < 1
  )
    return false
  clear()
  s.openFile(file)
  pending = { pid, file, line, text: p.files[file], until: Date.now() + MAX_AGE }
  off = useStore.subscribe(deliver)
  deliver()
  return true
}

export function consumeGoto(pid: string, file: string, receive: (line: number) => void) {
  const consumer = { pid, file, receive }
  consumers.add(consumer)
  deliver()
  return () => {
    consumers.delete(consumer)
  }
}

export function composeToChat(pid: string, chatId: string, text: string): boolean {
  const s = useStore.getState()
  const p = s.projects.find((p) => p.id === pid)
  if (s.screen !== 'workspace' || s.projectId !== pid || !p?.chats.some((c) => c.id === chatId)) return false
  const current = readChatDraft(s, pid, chatId)
  // Prefill must not erase an unsent user draft.
  s.setDraft(chatId, current ? current + '\n\n' + text : text, pid)
  useStore.getState().setCenter({ kind: 'chat', id: chatId })
  window.dispatchEvent(new CustomEvent('tf:compose-focus', { detail: { pid, chatId } }))
  return true
}
