/* Обратные ссылки: кто упоминает этот документ. Явная ссылка — [[Название]]; упоминание названия целиком (от 4 символов) тоже считается. */
import type { Doc, Task } from '../types'
import { blockText } from './docmd'

export interface Backlink {
  kind: 'doc' | 'task'
  id: string
  title: string
  snippet: string
  explicit: boolean
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

function find(text: string, title: string): { at: number; explicit: boolean } | null {
  const t = norm(text),
    k = norm(title)
  if (!k) return null
  const ex = t.indexOf('[[' + k + ']]')
  if (ex >= 0) return { at: ex, explicit: true }
  if (k.length < 4) return null
  const i = t.indexOf(k)
  return i >= 0 ? { at: i, explicit: false } : null
}

const clip = (s: string, at: number) => {
  const a = Math.max(0, at - 30),
    z = Math.min(s.length, at + 70)
  return (a > 0 ? '…' : '') + s.slice(a, z).replace(/\s+/g, ' ').trim() + (z < s.length ? '…' : '')
}

export function backlinks(doc: Doc, docs: Doc[], tasks: Task[]): Backlink[] {
  const out: Backlink[] = []
  for (const d of docs) {
    if (d.id === doc.id) continue
    for (const b of d.blocks) {
      const m = find(blockText(b), doc.title)
      if (m) {
        out.push({
          kind: 'doc',
          id: d.id,
          title: d.title || 'Без названия',
          snippet: clip(blockText(b), m.at),
          explicit: m.explicit,
        })
        break
      }
    }
  }
  for (const t of tasks) {
    const body = t.title + '\n' + (t.desc || '')
    const m = find(body, doc.title)
    if (m)
      out.push({ kind: 'task', id: t.id, title: t.title, snippet: clip(body, m.at), explicit: m.explicit })
  }
  return out.sort((a, b) => Number(b.explicit) - Number(a.explicit))
}
