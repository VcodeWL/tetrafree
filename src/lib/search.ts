/* Поиск по содержимому проекта: код, документы, задачи, переписка, память агентов. Без индекса — проект целиком в памяти. */
import { useStore } from '../store'
import type { Project } from '../types'
import { blockText } from './docmd'

export interface Hit {
  id: string
  group: 'Код' | 'Документы' | 'Задачи' | 'Чаты' | 'Память'
  label: string
  sub: string
  run: () => void
}
const clip = (s: string, i: number, q: number) => {
  const a = Math.max(0, i - 28)
  const t = s
    .slice(a, i + q + 60)
    .replace(/\s+/g, ' ')
    .trim()
  return (a > 0 ? '…' : '') + t + (a + 88 + q < s.length ? '…' : '')
}

export function searchProject(p: Project, query: string, limit = 80): Hit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const st = useStore.getState
  const out: Hit[] = []
  const full = () => out.length >= limit
  for (const [file, text] of Object.entries(p.files)) {
    if (full()) break
    if (text.length > 1_500_000) continue
    const low = text.toLowerCase()
    let from = 0,
      n = 0
    while (!full() && n < 6) {
      const i = low.indexOf(q, from)
      if (i < 0) break
      const line = low.slice(0, i).split('\n').length
      const ls = text.lastIndexOf('\n', i - 1) + 1
      let le = text.indexOf('\n', i)
      if (le < 0) le = text.length
      out.push({
        id: `f:${file}:${line}`,
        group: 'Код',
        label: clip(text.slice(ls, le), i - ls, q.length),
        sub: `${file}:${line}`,
        run: () => {
          st().openFile(file)
          setTimeout(() => window.dispatchEvent(new CustomEvent('tf:goto', { detail: { file, line } })), 60)
        },
      })
      from = le + 1
      n++
    }
  }
  for (const d of p.docs) {
    if (full()) break
    const body = d.blocks.map(blockText).join('\n')
    const hay = (d.title + '\n' + body).toLowerCase()
    const i = hay.indexOf(q)
    if (i >= 0)
      out.push({
        id: 'd:' + d.id,
        group: 'Документы',
        label: d.title,
        sub: clip(d.title + '\n' + body, i, q.length),
        run: () => st().setCenter({ kind: 'doc', id: d.id }),
      })
  }
  for (const t of p.tasks) {
    if (full()) break
    const hay = (t.title + ' ' + t.desc).toLowerCase()
    const i = hay.indexOf(q)
    if (i >= 0)
      out.push({
        id: 't:' + t.id,
        group: 'Задачи',
        label: '#' + t.key + ' ' + t.title,
        sub: clip(t.title + ' ' + t.desc, i, q.length),
        run: () => st().openModal({ type: 'task', id: t.id }),
      })
  }
  for (const c of p.chats) {
    let n = 0
    for (const m of c.messages) {
      if (full() || n >= 3) break
      const txt = 'text' in m && typeof m.text === 'string' ? m.text : ''
      const i = txt.toLowerCase().indexOf(q)
      if (i >= 0) {
        out.push({
          id: `c:${c.id}:${m.id}`,
          group: 'Чаты',
          label: clip(txt, i, q.length),
          sub: c.title,
          run: () => st().setCenter({ kind: 'chat', id: c.id }),
        })
        n++
      }
    }
  }
  for (const m of p.memory) {
    if (full()) break
    const i = m.text.toLowerCase().indexOf(q)
    if (i >= 0)
      out.push({
        id: 'm:' + m.id,
        group: 'Память',
        label: clip(m.text, i, q.length),
        sub: m.kind === 'decision' ? 'решение' : 'факт',
        run: () => st().openModal({ type: 'activity' }),
      })
  }
  return out
}
