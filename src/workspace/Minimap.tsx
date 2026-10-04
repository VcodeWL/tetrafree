import { useEffect, useRef, useState } from 'react'
import { contentH, mmRows, MAX_COLS, ROW, scrollForY, viewRect, type MmRow } from '../lib/minimap'

/** Мини-карта справа в окне кода: рисует строки файла, показывает видимую область, клик/перетаскивание — прокрутка */
export function Minimap({
  scroller,
  lines,
  hidden,
}: {
  scroller: HTMLElement | null
  lines: string[]
  hidden: ReadonlySet<number>
}) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [geo, setGeo] = useState({ h: 0, top: 0, vh: 0, ch: 0 })
  const rows = useRef<MmRow[]>([])
  const [area, setArea] = useState(0)

  /* высота области и позиция прокрутки */
  useEffect(() => {
    if (!scroller) return
    const upd = () => {
      const ch = contentH(rows.current.length, scroller.clientHeight)
      const r = viewRect(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight, ch)
      setArea(scroller.clientHeight)
      setGeo({ h: scroller.clientHeight, top: r.top, vh: r.h, ch })
    }
    upd()
    scroller.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd)
    ro.observe(scroller)
    const t = window.setTimeout(upd, 60) // высота содержимого устаканивается после рендера
    return () => {
      scroller.removeEventListener('scroll', upd)
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [scroller, lines, hidden])

  /* рисование */
  useEffect(() => {
    rows.current = mmRows(lines, hidden)
    const c = cv.current
    if (!c || !area) return
    const draw = () => {
      const n = rows.current.length
      const ch = contentH(n, area)
      const dpr = window.devicePixelRatio || 1
      const W = 90
      c.width = W * dpr
      c.height = Math.max(1, ch) * dpr
      c.style.height = ch + 'px'
      const g = c.getContext('2d')
      if (!g) return
      g.scale(dpr, dpr)
      const col = getComputedStyle(c).color
      const step = n * ROW > ch ? n / ch : 1 // строк на пиксель при сжатии
      for (let y = 0; y < ch; y++) {
        const i = Math.floor(y * step),
          r = rows.current[i]
        if (!r || r.k === 'e') continue
        g.globalAlpha = r.k === 'c' ? 0.16 : 0.34
        g.fillStyle = col
        g.fillRect(
          4 + (r.indent * (W - 8)) / MAX_COLS,
          y,
          Math.max(1, (r.len * (W - 8)) / MAX_COLS),
          Math.min(ROW - 0.5, 1.5),
        )
      }
    }
    draw()
    const mo = new MutationObserver(draw) // смена темы
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [lines, hidden, area])

  const jump = (e: React.PointerEvent) => {
    if (!scroller) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    scroller.scrollTop = scrollForY(y, geo.ch, scroller.scrollHeight, scroller.clientHeight)
  }
  if (!scroller || geo.ch <= 0) return null
  return (
    <div
      className="mm"
      style={{ height: geo.h }}
      aria-hidden="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && jump(e)}
    >
      <canvas ref={cv} />
      <i className="mm-view" style={{ top: geo.top, height: geo.vh }} />
    </div>
  )
}
