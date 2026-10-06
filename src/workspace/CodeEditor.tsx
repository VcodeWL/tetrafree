/* Редактор кода: textarea поверх подсвеченного <pre>. Правки уходят в проект с небольшой задержкой; чужие правки из облака
   вливаются без потери набранного (diff3), курсор остаётся на месте. Коллеги видны на своих строках, к строкам можно оставлять комментарии. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { rowKeys } from '../lib/a11y'
import { Minimap } from './Minimap'
import { useLayout } from '../lib/layout'
import { HLine } from '../components/ui/Code'
import { Icon } from '../components/ui/Icon'
import { merge3, mapCaret } from '../lib/merge3'
import { reportCaret, usePeers } from '../lib/team'
import { ago } from '../lib/util'
import { foldRanges, hiddenLines, unfoldAt, visibleIndex } from '../lib/folds'
import { useEdit, editPending, editSaved, editIdle } from '../lib/editstate'
import type { LineComment, Project } from '../types'

export const MAX_EDIT = 400_000
const LINE_COMMENT: Record<string, string> = {
  ts: '//',
  tsx: '//',
  js: '//',
  jsx: '//',
  py: '#',
  yaml: '#',
  yml: '#',
  sh: '#',
  bash: '#',
  sql: '--',
  json: '',
}
/** языки без строчных комментариев: каждая строка оборачивается парой маркеров */
const BLOCK_COMMENT: Record<string, [string, string]> = {
  css: ['/*', '*/'],
  html: ['<!--', '-->'],
  md: ['<!--', '-->'],
  xml: ['<!--', '-->'],
}
/** закомментировать / раскоммментировать строки; null — язык без комментариев (json) */
export function toggleComment(lines: string[], lang: string): string[] | null {
  const blk = BLOCK_COMMENT[lang]
  const pre = LINE_COMMENT[lang] ?? (blk ? '' : '//')
  if (!blk && !pre) return null
  const body = lines.filter((l) => l.trim())
  if (blk) {
    const [o, c] = blk
    const all = body.every((l) => l.trim().startsWith(o) && l.trim().endsWith(c))
    return lines.map((l) => {
      if (!l.trim()) return l
      if (all) {
        const m = /^(\s*)([\s\S]*?)\s*$/.exec(l)!
        return m[1] + m[2].slice(o.length, m[2].length - c.length).trim()
      }
      return l.replace(/^(\s*)([\s\S]*?)\s*$/, `$1${o} $2 ${c}`)
    })
  }
  const all = body.every((l) => l.trimStart().startsWith(pre))
  return lines.map((l) =>
    !l.trim()
      ? l
      : all
        ? l.replace(new RegExp('^(\\s*)' + pre + ' ?'), '$1')
        : l.replace(/^(\s*)/, `$1${pre} `),
  )
}

/** на какой строке (с 0) сейчас комментарий: если текст съехал — ищем ближайшую такую же строку */
export function placeComment(c: LineComment, lines: string[]): { at: number; stale: boolean } {
  const i = Math.min(Math.max(c.line - 1, 0), Math.max(lines.length - 1, 0))
  if (lines[i] === c.anchor) return { at: i, stale: false }
  if (c.anchor.trim()) {
    for (let d = 1; d < lines.length; d++) {
      if (lines[i - d] === c.anchor) return { at: i - d, stale: false }
      if (lines[i + d] === c.anchor) return { at: i + d, stale: false }
    }
  }
  return { at: i, stale: true }
}

const lineOf = (t: string, pos: number) => {
  let n = 0
  for (let i = 0; i < pos && i < t.length; i++) if (t.charCodeAt(i) === 10) n++
  return n
}

function replaceRange(ta: HTMLTextAreaElement, a: number, b: number, str: string, sel: [number, number]) {
  ta.focus()
  ta.setSelectionRange(a, b)
  /* execCommand сохраняет историю отмены (Ctrl+Z); setRangeText — запасной путь */
  if (!document.execCommand('insertText', false, str)) {
    ta.setRangeText(str, a, b, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ta.setSelectionRange(sel[0], sel[1])
}

export const CodeSurface = memo(function CodeSurface({
  p,
  file,
  lang,
  content,
  editing,
}: {
  p: Project
  file: string
  lang: string
  content: string
  editing: boolean
}) {
  const st = useStore.getState
  const [text, setText] = useState(content)
  const textRef = useRef(content)
  textRef.current = text
  const last = useRef(content) // что в проекте с нашей точки зрения (записали сами или приняли снаружи)
  const timer = useRef<number>(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const sel = useRef<[number, number] | null>(null)
  const [caretLine, setCaretLine] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const peers = usePeers((s) => s.by[p.id])
  const stack = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(0)
  /* свёрнутые блоки (номера первых строк); живут только в режиме просмотра — при правке строки сдвигаются */
  const [folded, setFolded] = useState<Set<number>>(() => new Set())
  const rangesRef = useRef<Map<number, number>>(new Map())
  useEffect(() => setFolded(new Set()), [file, editing])
  useEffect(() => {
    let t = 0
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ file: string; line: number }>).detail
      if (d.file !== file) return
      setFlash(d.line)
      setFolded((f) => unfoldAt(rangesRef.current, f, d.line - 1))
      const sc = stack.current?.parentElement
      if (sc) sc.scrollTop = Math.max(0, (d.line - 6) * parseFloat(getComputedStyle(sc).fontSize) * 1.7)
      window.clearTimeout(t)
      t = window.setTimeout(() => setFlash(0), 2200)
    }
    window.addEventListener('tf:goto', h)
    return () => {
      window.removeEventListener('tf:goto', h)
      window.clearTimeout(t)
    }
  }, [file])

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    if (textRef.current !== last.current) {
      last.current = textRef.current
      st().writeFile(file, textRef.current, p.id)
      editSaved(file)
    } else if (useEdit.getState().pending) editIdle()
  }, [file, p.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* изменение пришло снаружи (облако, агент, диск, откат) */
  useEffect(() => {
    if (content === last.current) return
    const ours = textRef.current
    let next = content
    if (ours !== last.current) {
      const m = merge3(last.current, ours, content, { ours: 'мои правки', theirs: 'коллега' })
      next = m ? m.text : ours
    }
    if (document.activeElement === ta.current && ta.current)
      sel.current = [
        mapCaret(ours, next, ta.current.selectionStart),
        mapCaret(ours, next, ta.current.selectionEnd),
      ]
    last.current = content
    setText(next)
    if (next !== content) {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 120)
    }
  }, [content, flush])
  useLayoutEffect(() => {
    if (sel.current && ta.current) {
      ta.current.setSelectionRange(sel.current[0], sel.current[1])
      sel.current = null
    }
  }, [text])
  useEffect(() => flush, [flush])
  useEffect(() => {
    if (!editing) flush()
  }, [editing, flush])

  const onChange = (v: string) => {
    setText(v)
    editPending(file)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 220)
  }
  const report = () => {
    const t = ta.current
    if (!t) return
    const l = lineOf(t.value, t.selectionStart)
    setCaretLine(l)
    reportCaret(file, l + 1)
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget
    const v = t.value
    const a = t.selectionStart,
      b = t.selectionEnd
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      flush()
      st().toast({ title: 'Сохранено', desc: file, icon: 'check' })
      return
    }
    if (e.key === 'Escape') {
      t.blur()
      return
    }
    if (mod && e.key === '/') {
      const s0 = a > 0 ? v.lastIndexOf('\n', a - 1) + 1 : 0
      let e0 = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b)
      if (e0 < 0) e0 = v.length
      const res = toggleComment(v.slice(s0, e0).split('\n'), lang)
      if (!res) return
      e.preventDefault()
      const out = res.join('\n')
      replaceRange(t, s0, e0, out, [s0, s0 + out.length])
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (a === b && !e.shiftKey) {
        replaceRange(t, a, b, '  ', [a + 2, a + 2])
        return
      }
      const s0 = a > 0 ? v.lastIndexOf('\n', a - 1) + 1 : 0
      let e0 = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b)
      if (e0 < 0) e0 = v.length
      const out = v
        .slice(s0, e0)
        .split('\n')
        .map((l) => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l))
        .join('\n')
      replaceRange(t, s0, e0, out, [s0, s0 + out.length])
      return
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      const s0 = a > 0 ? v.lastIndexOf('\n', a - 1) + 1 : 0
      const cur = v.slice(s0, a)
      const ind = /^[ \t]*/.exec(cur)![0]
      const before = v[a - 1],
        after = v[b]
      const more = /[{(\[:]$/.test(cur.trimEnd()) && before !== undefined ? '  ' : ''
      if (!ind && !more) return
      e.preventDefault()
      if (
        (before === '{' && after === '}') ||
        (before === '[' && after === ']') ||
        (before === '(' && after === ')')
      ) {
        const ins = '\n' + ind + '  ' + '\n' + ind
        replaceRange(t, a, b, ins, [a + 1 + ind.length + 2, a + 1 + ind.length + 2])
        return
      }
      const ins = '\n' + ind + more
      replaceRange(t, a, b, ins, [a + ins.length, a + ins.length])
    }
  }

  const lines = useMemo(() => text.split('\n'), [text])
  const ranges = useMemo(() => foldRanges(lines), [lines])
  rangesRef.current = ranges
  const hidden = useMemo(() => hiddenLines(ranges, editing ? new Set() : folded), [ranges, folded, editing])
  const vis = useMemo(() => visibleIndex(lines.length, hidden), [lines.length, hidden])
  const toggleFold = (i: number) =>
    setFolded((f) => {
      const n = new Set(f)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  /* «Свернуть/развернуть всё» из палитры команд */
  useEffect(() => {
    const h = (e: Event) => {
      const all = (e as CustomEvent<{ all: boolean }>).detail.all
      setFolded(
        all ? new Set([...rangesRef.current.keys()].filter((k) => rangesRef.current.get(k)! > k)) : new Set(),
      )
    }
    window.addEventListener('tf:fold', h)
    return () => window.removeEventListener('tf:fold', h)
  }, [])
  const mine = useMemo(
    () => (p.comments || []).filter((c) => c.file === file).map((c) => ({ c, ...placeComment(c, lines) })),
    [p.comments, file, lines],
  )
  const byLine = useMemo(() => {
    const m = new Map<number, typeof mine>()
    for (const x of mine) m.set(x.at, [...(m.get(x.at) || []), x])
    return m
  }, [mine])
  const here = (peers || []).filter((q) => q.file === file && Date.now() - q.at < 60_000)
  const people = useStore((s) => s.people)
  const mapOn = useLayout((l) => l.minimap)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => setScroller(stack.current?.parentElement ?? null), [])
  const showMap = mapOn && lines.length > 30

  return (
    <>
      <div className="gutter">
        {lines.map((_, i) => {
          if (hidden.has(i)) return null
          const cs = byLine.get(i)
          const openC = cs?.filter((x) => !x.c.done).length || 0
          return (
            <div
              key={i}
              className={
                'gl' +
                (cs ? ' hascm' : '') +
                (editing && i === caretLine ? ' cur' : '') +
                (open === i ? ' sel' : '')
              }
              onClick={() => setOpen(open === i ? null : i)}
              role="button"
              tabIndex={i === (editing ? caretLine : 0) ? 0 : -1}
              aria-label={`Строка ${i + 1}: ${cs ? `комментариев ${cs.length}` : 'добавить комментарий'}`}
              onKeyDown={rowKeys({ open: () => setOpen(open === i ? null : i) }, '.gutter .gl')}
              title={cs ? `Комментариев: ${cs.length}` : 'Добавить комментарий'}
            >
              {!editing && ranges.has(i) && (
                <b
                  className={'fold' + (folded.has(i) ? ' shut' : '')}
                  role="button"
                  aria-label={folded.has(i) ? 'Развернуть блок' : 'Свернуть блок'}
                  aria-expanded={!folded.has(i)}
                  title={folded.has(i) ? 'Развернуть блок' : 'Свернуть блок'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFold(i)
                  }}
                >
                  <Icon name="chevd" size={10} />
                </b>
              )}
              {cs ? <i className={'cdot' + (openC ? '' : ' done')} /> : <i className="cplus">+</i>}
              {i + 1}
            </div>
          )
        })}
      </div>
      <div ref={stack} className={'ed-stack' + (editing ? ' editing' : '')}>
        {flash > 0 && (
          <div
            className="peer-band flash"
            style={{ top: `calc(14px + ${vis[Math.min(flash, lines.length) - 1] ?? 0} * 1.7em)` }}
          />
        )}
        {here.map((q) => {
          const l = vis[Math.min(Math.max(q.line - 1, 0), lines.length - 1)] ?? 0
          return (
            q.line > 0 && (
              <div
                key={q.uid}
                className="peer-band"
                style={{ top: `calc(14px + ${l} * 1.7em)`, ['--ph' as string]: q.hue }}
              >
                <span className="peer-tag">{q.name.split(' ')[0]}</span>
              </div>
            )
          )
        })}
        <pre className="ed-hl" aria-hidden={editing}>
          {lines.map((l, i) =>
            hidden.has(i) ? null : (
              <HLine
                key={i}
                line={l}
                lang={lang}
                tail={
                  folded.has(i) && !editing && ranges.has(i) ? (
                    <span className="fold-ph">⋯ {ranges.get(i)! - i} стр.</span>
                  ) : undefined
                }
              />
            ),
          )}
        </pre>
        {editing && (
          <textarea
            ref={ta}
            className="ed-ta"
            value={text}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoComplete="off"
            aria-label={'Редактор: ' + file}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            onKeyUp={report}
            onClick={report}
            onFocus={report}
            onBlur={flush}
          />
        )}
        {open !== null && (
          <CommentPop
            file={file}
            line={open}
            anchor={lines[open] ?? ''}
            items={byLine.get(open) || []}
            people={people}
            onClose={() => setOpen(null)}
          />
        )}
      </div>
      {showMap && <Minimap scroller={scroller} lines={lines} hidden={hidden} />}
    </>
  )
})

function CommentPop({
  file,
  line,
  anchor,
  items,
  people,
  onClose,
}: {
  file: string
  line: number
  anchor: string
  items: { c: LineComment; stale: boolean }[]
  people: Record<string, { name: string }>
  onClose: () => void
}) {
  const [v, setV] = useState('')
  const st = useStore.getState
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const add = () => {
    const t = v.trim()
    if (!t) return
    st().addComment({ file, line: line + 1, anchor, text: t })
    setV('')
  }
  return (
    <div
      className="cmt-pop"
      style={{ top: `calc(14px + ${line + 1} * 1.7em)` }}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Комментарии к строке ${line + 1}`}
    >
      <div className="cp-h">
        <Icon name="chat" size={12} />
        Строка {line + 1}
        <span className="grow" />
        <button className="iconbtn sm" onClick={onClose} aria-label="Закрыть">
          <Icon name="x" size={12} />
        </button>
      </div>
      {items.map(({ c, stale }) => (
        <div key={c.id} className={'cp-i' + (c.done ? ' done' : '')}>
          <div className="cp-m">
            <b>{people[c.by]?.name || 'Участник'}</b>
            <span className="t4">{ago(c.at)}</span>
            {stale && (
              <span className="chip sm" title="Строка, к которой был комментарий, изменилась">
                строка изменилась
              </span>
            )}
          </div>
          <div className="cp-t">{c.text}</div>
          <div className="cp-a">
            <button className="linkbtn" onClick={() => st().toggleComment(c.id)}>
              {c.done ? 'Вернуть' : 'Решено'}
            </button>
            <button className="linkbtn" onClick={() => st().deleteComment(c.id)}>
              Удалить
            </button>
          </div>
        </div>
      ))}
      <textarea
        ref={ref}
        value={v}
        placeholder="Написать коллегам…"
        rows={2}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            add()
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <div className="cp-f">
        <span className="t4">Ctrl+Enter</span>
        <button className="btn sm pri" disabled={!v.trim()} onClick={add}>
          Комментировать
        </button>
      </div>
    </div>
  )
}
