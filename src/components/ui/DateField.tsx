import { useRef, useState } from 'react'
import { Menu } from './Menu'
import { Icon } from './Icon'
import { WEEKDAYS, MONTHS, grid, parseIso, parseTyped, shiftMonth, fmtRu } from '../../lib/cal'
import { localDay } from '../../lib/util'

/** Поле даты: можно печатать (31.12.2025) или выбрать в календаре. Значение — YYYY-MM-DD или ''. */
export function DateField({
  value,
  onChange,
  label,
  min,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  min?: string
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const [open, setOpen] = useState<DOMRect | null>(null)
  const today = localDay()
  const base = parseIso(value) || parseIso(today)!
  const [view, setView] = useState({ y: base.y, m: base.m })
  const box = useRef<HTMLDivElement>(null)
  const shown = typed ?? fmtRu(value)
  const bad = typed !== null && typed.trim() !== '' && !parseTyped(typed)
  const commit = () => {
    if (typed === null) return
    const t = typed.trim()
    if (!t) onChange('')
    else {
      const v = parseTyped(t)
      if (!v) return
      onChange(v)
    }
    setTyped(null)
  }
  const pick = (v: string) => {
    onChange(v)
    setTyped(null)
    setOpen(null)
  }
  const openCal = () => {
    const b = parseIso(value) || parseIso(today)!
    setView({ y: b.y, m: b.m })
    setOpen(box.current!.getBoundingClientRect())
  }
  return (
    <div className={'datef' + (bad ? ' bad' : '')} ref={box}>
      <input
        aria-label={label}
        inputMode="numeric"
        placeholder="дд.мм.гггг"
        value={shown}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'ArrowDown' && e.altKey) openCal()
        }}
      />
      {value && (
        <button type="button" className="datef-x" aria-label={label + ': очистить'} onClick={() => pick('')}>
          ×
        </button>
      )}
      <button
        type="button"
        className="datef-b"
        aria-label={label + ': открыть календарь'}
        aria-haspopup="dialog"
        onClick={openCal}
      >
        <Icon name="calendar" size={14} />
      </button>
      {open && (
        <Menu anchor={open} onClose={() => setOpen(null)} className="cal-menu">
          <div className="cal" role="dialog" aria-label="Календарь">
            <div className="cal-h">
              <button
                type="button"
                className="iconbtn sm"
                aria-label="Предыдущий месяц"
                onClick={() => setView(shiftMonth(view.y, view.m, -1))}
              >
                <Icon name="chev" size={13} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <b>
                {MONTHS[view.m]} {view.y}
              </b>
              <button
                type="button"
                className="iconbtn sm"
                aria-label="Следующий месяц"
                onClick={() => setView(shiftMonth(view.y, view.m, 1))}
              >
                <Icon name="chev" size={13} />
              </button>
            </div>
            <div className="cal-g">
              {WEEKDAYS.map((w, i) => (
                <span key={w} className={'cal-w' + (i > 4 ? ' we' : '')}>
                  {w}
                </span>
              ))}
              {grid(view.y, view.m).map((c) => (
                <button
                  type="button"
                  key={c.iso}
                  disabled={!!min && c.iso < min}
                  className={
                    'cal-d' +
                    (c.out ? ' out' : '') +
                    (c.iso === today ? ' today' : '') +
                    (c.iso === value ? ' on' : '')
                  }
                  aria-pressed={c.iso === value}
                  aria-label={fmtRu(c.iso)}
                  onClick={() => pick(c.iso)}
                >
                  {c.day}
                </button>
              ))}
            </div>
            <div className="cal-f">
              <button type="button" onClick={() => pick(today)}>
                Сегодня
              </button>
              {value && (
                <button type="button" onClick={() => pick('')}>
                  Очистить
                </button>
              )}
            </div>
          </div>
        </Menu>
      )}
    </div>
  )
}
