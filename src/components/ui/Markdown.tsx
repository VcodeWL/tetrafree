import { Fragment, memo, type ReactNode } from 'react'
import { CodeBlock } from './Code'

/* Небольшой безопасный markdown: абзацы, списки, ```код```, `инлайн`, **жирный**, _курсив_, [ссылки](url) */
function inline(s: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((https?:[^)\s]+)\)|(?:^|(?<=\s))_[^_]+_(?=\s|$|[.,!?]))/g
  let last = 0,
    m: RegExpExecArray | null,
    i = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    const k = key + '-' + i++
    if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('**')) out.push(<b key={k}>{t.slice(2, -2)}</b>)
    else if (t.startsWith('[')) {
      const lm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      out.push(
        <a key={k} href={lm[2]} target="_blank" rel="noreferrer">
          {lm[1]}
        </a>,
      )
    } else out.push(<i key={k}>{t.slice(1, -1)}</i>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export const Markdown = memo(function Markdown({ text, caret }: { text: string; caret?: boolean }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let i = 0,
    k = 0,
    caretDone = false
  while (i < lines.length) {
    const l = lines[i]
    const fence = l.match(/^```\s*([\w+-]*)\s*([^\s`]*)\s*$/)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++])
      i++
      blocks.push(
        <CodeBlock
          key={k++}
          code={buf.join('\n')}
          lang={fence[1] || undefined}
          file={fence[2] || undefined}
        />,
      )
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const L = ordered ? 'ol' : 'ul'
      blocks.push(
        <L key={k++} className="md-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it, 'l' + j)}</li>
          ))}
        </L>,
      )
      continue
    }
    if (/^#{1,3}\s/.test(l)) {
      blocks.push(
        <p key={k++} className="md-h">
          {inline(l.replace(/^#+\s/, ''))}
        </p>,
      )
      i++
      continue
    }
    if (!l.trim()) {
      i++
      continue
    }
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    )
      buf.push(lines[i++])
    const endHere = caret && i >= lines.length
    if (endHere) caretDone = true
    blocks.push(
      <p key={k++}>
        {buf.map((b, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(b, 'p' + j)}
          </Fragment>
        ))}
        {endHere && <span className="caret" />}
      </p>,
    )
  }
  if (caret && !caretDone)
    blocks.push(
      <p key="caret">
        <span className="caret" />
      </p>,
    )
  return <div className="md">{blocks}</div>
})
