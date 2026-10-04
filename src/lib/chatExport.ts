import type { Chat } from '../types'
import { useStore } from '../store'
import { download, slug } from './util'

/* Чат → Markdown: удобно приложить к PR или сохранить решение */
export function chatToMd(chat: Chat): string {
  const people = useStore.getState().people
  const out = [`# ${chat.title}`, '', `_Экспорт ${new Date().toLocaleString('ru-RU')}_`, '']
  for (const m of chat.messages) {
    const t = new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    if (m.kind === 'sys') out.push(`> ${m.text}`, '')
    else if (m.kind === 'human') out.push(`### ${people[m.author]?.name || 'Человек'} · ${t}`, '', m.text, '')
    else if (m.kind === 'agent') out.push(`### ${m.agent} · ${t}`, '', m.text, '')
  }
  return out.join('\n')
}
export const exportChat = (chat: Chat) => download(slug(chat.title) + '.md', chatToMd(chat), 'text/markdown')
