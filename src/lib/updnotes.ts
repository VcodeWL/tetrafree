/** Первые строки заметок релиза для окна обновления: markdown-маркеры и пустые строки убираются. */
export function notesLines(notes: string | null | undefined, max = 4): string[] {
  if (!notes) return []
  const out: string[] = []
  for (const raw of notes.split(/\r?\n/)) {
    let l = raw.trim()
    if (!l || /^#{1,6}\s/.test(l) || /^[-*_]{3,}$/.test(l)) continue
    l = l
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim()
    if (!l) continue
    out.push(l.length > 140 ? l.slice(0, 137) + '…' : l)
    if (out.length >= max) break
  }
  return out
}
