import type { Chat, Part } from '../types'
import { useStore } from '../store'
import { download, slug } from './util'

const FILE_OP: Record<string, string> = {
  create: 'создан',
  edit: 'изменён',
  delete: 'удалён',
  rename: 'переименован',
}
/** Действия агента по порядку: текст, шаги, файлы, команды с выводом */
export function agentParts(parts: Part[] | undefined): string {
  const out: string[] = []
  for (const p of parts || []) {
    if (p.k === 'text') {
      if (p.text.trim()) out.push(p.text.trim())
    } else if (p.k === 'step') out.push(`- ${p.done ? '[x]' : '[ ]'} ${p.text}`)
    else if (p.k === 'file')
      out.push(
        `- Файл \`${p.path}\`${p.to ? ' → \`' + p.to + '\`' : ''}: ${FILE_OP[p.op] || p.op}` +
          (p.add || p.del ? ` (+${p.add} −${p.del})` : '') +
          (p.error ? ` — ошибка: ${p.error}` : ''),
      )
    else if (p.k === 'cmd') {
      const o = p.out.trim()
      out.push('```sh', '$ ' + p.cmd, ...(o ? [o.length > 2000 ? o.slice(0, 2000) + '\n…' : o] : []), '```')
    } else if (p.k === 'read') out.push(`- Прочитан \`${p.path}\`${p.ok ? '' : ' (не удалось)'}`)
  }
  return out.join('\n')
}

/* Чат → Markdown: удобно приложить к PR или сохранить решение */
export function chatToMd(chat: Chat): string {
  const people = useStore.getState().people
  const out = [`# ${chat.title}`, '', `_Экспорт ${new Date().toLocaleString('ru-RU')}_`, '']
  for (const m of chat.messages) {
    const t = new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    if (m.kind === 'sys') out.push(`> ${m.text}`, '')
    else if (m.kind === 'human') out.push(`### ${people[m.author]?.name || 'Человек'} · ${t}`, '', m.text, '')
    else if (m.kind === 'agent') {
      out.push(`### ${m.agent} · ${t}`, '')
      const body = agentParts(m.parts)
      out.push(body || m.text || '_(без текста)_', '')
    }
  }
  return out.join('\n')
}
export const exportChat = (chat: Chat) => download(slug(chat.title) + '.md', chatToMd(chat), 'text/markdown')
