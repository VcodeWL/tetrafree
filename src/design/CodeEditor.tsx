/* Простой редактор кода: прозрачный textarea поверх подсвеченного pre. Двусторонняя связь с холстом:
   правка кода → файл → холст; выбранный на холсте элемент подсвечивается в коде. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { HLine } from '../components/ui/Code'
import { useDesign } from './store'
import { getEl } from './actions'
import { Icon } from '../components/ui/Icon'

export function CodeEditor({
  value,
  onChange,
  lang = 'html',
  path,
}: {
  value: string
  onChange: (v: string) => void
  lang?: string
  path: string
}) {
  const [text, setText] = useState(value)
  const ta = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLDivElement>(null)
  const typed = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sel = useDesign((s) => s.sel)
  const rev = useDesign((s) => s.rev)
  const lines = useMemo(() => text.split('\n'), [text])

  /* внешняя правка (холст, агент, диск) → обновляем текст, если пользователь сейчас не печатает */
  useEffect(() => {
    if (value !== typed.current) {
      typed.current = value
      setText(value)
    }
  }, [value])
  const push = (v: string) => {
    setText(v)
    typed.current = v
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(v), 350)
  }
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        if (typed.current !== value) onChange(typed.current)
      }
    },
    // размонтирование: сбрасываем отложенную правку с актуальными value/onChange на момент ухода
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /* строка выбранного элемента */
  const hl = useMemo(() => {
    const el = sel ? getEl(sel) : null
    if (!el) return null
    const outer = el.outerHTML
    let i = text.indexOf(outer)
    if (i < 0) {
      const open = outer.slice(0, outer.indexOf('>') + 1)
      i = text.indexOf(open)
      if (i < 0) return null
      const a = text.slice(0, i).split('\n').length - 1
      return { a, b: a }
    }
    const a = text.slice(0, i).split('\n').length - 1
    return { a, b: a + outer.split('\n').length - 1 }
  }, [sel, rev, text]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hl || !ta.current || document.activeElement === ta.current) return
    const top = hl.a * 21 - 60
    ta.current.scrollTop = Math.max(0, top)
    if (pre.current) pre.current.scrollTop = ta.current.scrollTop
  }, [hl?.a]) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = () => {
    if (pre.current && ta.current) {
      pre.current.scrollTop = ta.current.scrollTop
      pre.current.scrollLeft = ta.current.scrollLeft
    }
  }
  return (
    <div className="dce">
      <div className="dce-h">
        <span className="mono">{path}</span>
        <span className="grow" />
        <span className="t4">{lines.length} стр.</span>
        {hl && (
          <span className="chip sm">
            <Icon name="cursor" size={11} />
            строки {hl.a + 1}–{hl.b + 1}
          </span>
        )}
      </div>
      <div className="dce-b">
        <div className="dce-g" ref={pre} aria-hidden>
          <div className="dce-in" style={{ height: lines.length * 21 + 24 }}>
            {hl && <i className="dce-hl" style={{ top: 12 + hl.a * 21, height: (hl.b - hl.a + 1) * 21 }} />}
            {lines.map((l, i) => (
              <div key={i} className="dce-l">
                <span className="n">{i + 1}</span>
                <span className="c">
                  <HLine line={l.replace(/\n$/, '')} lang={lang} />
                </span>
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={ta}
          className="dce-t"
          spellCheck={false}
          value={text}
          wrap="off"
          onScroll={sync}
          onChange={(e) => push(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.currentTarget
              const s = t.selectionStart
              push(text.slice(0, s) + '  ' + text.slice(t.selectionEnd))
              requestAnimationFrame(() => {
                t.selectionStart = t.selectionEnd = s + 2
              })
            }
          }}
          aria-label={'Код ' + path}
        />
      </div>
    </div>
  )
}
