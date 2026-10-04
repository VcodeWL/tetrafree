/* Холст в духе Figma: реальные страницы проекта во фреймах, панорама и зум, выделение, ресайз,
   перетаскивание, правка текста двойным кликом. Всё — по живому DOM страницы. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDesign, DEVICE_W, DEVICE_RU, type Device } from './store'
import { commitDoc, getEl, moveTo, setStyles } from './actions'
import { describe, elAt, isBody, kids, pathOf, cs, type Path } from './dom'
import { clamp } from '../lib/util'

const EDITOR_CSS = `html{overflow:hidden}*{cursor:default!important}[contenteditable]{outline:2px solid #8fa6ff!important;outline-offset:3px;cursor:text!important;caret-color:#8fa6ff}`
const INLINE = new Set([
  'A',
  'B',
  'I',
  'EM',
  'STRONG',
  'SPAN',
  'SMALL',
  'BR',
  'CODE',
  'U',
  'S',
  'MARK',
  'SUP',
  'SUB',
])
export const canEditText = (el: Element) =>
  !['IMG', 'HR', 'INPUT', 'VIDEO', 'SVG', 'BODY', 'HTML'].includes(el.tagName) &&
  (el.textContent || '').trim().length > 0 &&
  Array.from(el.children).every((c) => INLINE.has(c.tagName))

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const boxOf = (el: Element | null): Box | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

export function Canvas({
  base,
  html,
  frames,
  flash,
}: {
  base: string
  html: string
  frames: Device[]
  flash: number
}) {
  const zoom = useDesign((s) => s.zoom)
  const grid = useDesign((s) => s.grid)
  const pan = useDesign((s) => s.pan)
  const tool = useDesign((s) => s.tool)
  const fit = useDesign((s) => s.fit)
  const wrap = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const setH = useCallback(
    (k: string, h: number) =>
      setHeights((cur) => (Math.abs((cur[k] || 0) - h) < 2 ? cur : { ...cur, [k]: h })),
    [],
  )
  const worldW = frames.reduce((a, f) => a + DEVICE_W[f], 0) + (frames.length - 1) * 96
  const worldH = Math.max(...frames.map((f) => heights[f] || 720)) + 28

  /* вписать в окно */
  const doFit = useCallback(() => {
    const el = wrap.current
    if (!el) return
    const z = clamp(
      Math.min((el.clientWidth - 96) / worldW, (el.clientHeight - 150) / Math.min(worldH, 1100)),
      0.12,
      1,
    )
    useDesign.setState({ zoom: z, pan: { x: Math.max(24, (el.clientWidth - worldW * z) / 2), y: 28 } })
  }, [worldW, worldH])
  useLayoutEffect(() => {
    if (fit) doFit()
  }, [fit, doFit, frames.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (useDesign.getState().fit) doFit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [doFit])

  /* колесо: Ctrl/⌘ — зум к курсору, иначе панорама */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useDesign.getState()
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const mx = e.clientX - r.left,
          my = e.clientY - r.top
        const z = clamp(s.zoom * Math.exp(-e.deltaY * 0.0022), 0.1, 3)
        const k = z / s.zoom
        useDesign.setState({
          zoom: z,
          fit: false,
          pan: { x: mx - (mx - s.pan.x) * k, y: my - (my - s.pan.y) * k },
        })
      } else useDesign.setState({ fit: false, pan: { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY } })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    if (
      useDesign.getState().tool !== 'hand' &&
      (e.target as HTMLElement).closest('.dfr-ov') &&
      e.button === 0
    )
      return
    const s = useDesign.getState()
    const sx = e.clientX,
      sy = e.clientY,
      p0 = s.pan
    let moved = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      moved = true
      useDesign.setState({ fit: false, pan: { x: p0.x + ev.clientX - sx, y: p0.y + ev.clientY - sy } })
    }
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      if (!moved) useDesign.setState({ sel: null, editing: false })
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={'dcv' + (grid ? ' grid' : '') + (tool === 'hand' ? ' hand' : '')}
      ref={wrap}
      onPointerDown={onBgDown}
      style={
        grid
          ? { backgroundSize: `${16 * zoom}px ${16 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }
          : undefined
      }
    >
      <div className="dcv-world" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
        {frames.map((f, i) => (
          <Frame
            key={f}
            device={f}
            primary={i === 0}
            base={base}
            html={html}
            height={heights[f] || 720}
            setH={setH}
            zoom={zoom}
            flash={flash}
          />
        ))}
      </div>
    </div>
  )
}

function Frame({
  device,
  primary,
  base,
  html,
  height,
  setH,
  zoom,
  flash,
}: {
  device: Device
  primary: boolean
  base: string
  html: string
  height: number
  setH: (k: string, h: number) => void
  zoom: number
  flash: number
}) {
  const W = DEVICE_W[device]
  const ifr = useRef<HTMLIFrameElement>(null)
  const ov = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<Document | null>(null)
  const sel = useDesign((s) => s.sel)
  const hover = useDesign((s) => s.hover)
  const editing = useDesign((s) => s.editing)
  const rev = useDesign((s) => s.rev)
  const [tick, setTick] = useState(0)
  const [drag, setDrag] = useState<{ ghost: Box; drop: { line: Box } | null } | null>(null)
  const dragRef = useRef<{
    el: HTMLElement
    sx: number
    sy: number
    active: boolean
    target?: HTMLElement
    pos?: 'before' | 'after' | 'inside'
  } | null>(null)

  const onLoad = () => {
    const d = ifr.current?.contentDocument
    const w = ifr.current?.contentWindow
    if (!d || !w) return
    const st = d.createElement('style')
    st.setAttribute('data-tf-editor', '')
    st.textContent = EDITOR_CSS
    d.head.append(st)
    setDoc(d)
    if (primary) {
      useDesign.setState({ doc: d })
      useDesign.getState().bump()
    }
    const measure = () => {
      const h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight)
      setH(device, Math.max(480, h))
      setTick((t) => t + 1)
    }
    measure()
    const RO = (w as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver
    if (RO) new RO(measure).observe(d.body)
    d.fonts?.ready.then(measure).catch(() => {})
    d.querySelectorAll('img').forEach((im) => im.addEventListener('load', measure))
  }
  useEffect(() => {
    setTick((t) => t + 1)
  }, [rev, sel, zoom, height])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ov.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }
  }
  const pick = (e: { clientX: number; clientY: number }) => {
    if (!doc) return null
    const { x, y } = local(e)
    const el = doc.elementFromPoint(x, y) as HTMLElement | null
    return !el || isBody(el, doc) ? null : el
  }

  const startEdit = (el: HTMLElement) => {
    if (!doc || !canEditText(el)) return
    useDesign.setState({ editing: true, sel: pathOf(el, doc) })
    el.setAttribute('contenteditable', 'plaintext-only')
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true')
    el.setAttribute('spellcheck', 'false')
    el.focus()
    const w = doc.defaultView!
    const range = doc.createRange()
    range.selectNodeContents(el)
    const s = w.getSelection()
    s?.removeAllRanges()
    s?.addRange(range)
    const onInput = () => commitDoc('Текст', 'text')
    const done = () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('blur', done)
      el.removeEventListener('keydown', onKey)
      el.removeAttribute('contenteditable')
      el.removeAttribute('spellcheck')
      useDesign.setState({ editing: false })
      commitDoc('Текст', 'text')
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
        ev.preventDefault()
        el.blur()
      }
      ev.stopPropagation()
    }
    el.addEventListener('input', onInput)
    el.addEventListener('blur', done)
    el.addEventListener('keydown', onKey)
  }
  useEffect(() => {
    const h = (e: Event) => {
      if (primary) {
        const el = getEl(useDesign.getState().sel)
        if (el) startEdit(el)
      }
      void e
    }
    window.addEventListener('tf:design-edit', h)
    return () => window.removeEventListener('tf:design-edit', h)
  })

  const onMove = (e: React.PointerEvent) => {
    if (editing) return
    const dr = dragRef.current
    if (dr && primary) {
      if (!dr.active && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 6) return
      dr.active = true
      const { x, y } = local(e)
      const t0 = doc!.elementFromPoint(x, y) as HTMLElement | null
      let target: HTMLElement | undefined,
        pos: 'before' | 'after' | 'inside' | undefined,
        line: Box | null = null
      if (t0 && !isBody(t0, doc!) && !dr.el.contains(t0)) {
        target = t0
        const r = t0.getBoundingClientRect()
        const par = t0.parentElement ? cs(t0.parentElement) : null
        const row = par && par.display.includes('flex') && par.flexDirection.startsWith('row')
        const empty =
          kids(t0).length === 0 && !canEditText(t0) && !['IMG', 'HR', 'INPUT'].includes(t0.tagName)
        if (empty) {
          pos = 'inside'
          line = { x: r.left, y: r.top, w: r.width, h: r.height }
        } else {
          const before = row ? x < r.left + r.width / 2 : y < r.top + r.height / 2
          pos = before ? 'before' : 'after'
          line = row
            ? { x: before ? r.left - 1 : r.right - 1, y: r.top, w: 3, h: r.height }
            : { x: r.left, y: before ? r.top - 1 : r.bottom - 1, w: r.width, h: 3 }
        }
      }
      dr.target = target
      dr.pos = pos
      const b = boxOf(dr.el)!
      setDrag({
        ghost: { x: x - b.w / 2, y: y - 10, w: Math.min(b.w, 420), h: Math.min(b.h, 80) },
        drop: line ? { line } : null,
      })
      return
    }
    const el = pick(e)
    const p = el && doc ? pathOf(el, doc) : null
    const cur = useDesign.getState().hover
    if ((p ? p.join('.') : '') !== (cur ? cur.join('.') : '')) useDesign.setState({ hover: p })
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return
    e.stopPropagation()
    const el = pick(e)
    if (!el || !doc) {
      useDesign.setState({ sel: null })
      return
    }
    useDesign.setState({ sel: pathOf(el, doc) })
    if (!primary) return
    ov.current!.setPointerCapture(e.pointerId)
    dragRef.current = { el, sx: e.clientX, sy: e.clientY, active: false }
  }
  const onUp = () => {
    const dr = dragRef.current
    dragRef.current = null
    if (dr?.active && dr.target && dr.pos) moveTo(dr.el, dr.target, dr.pos)
    setDrag(null)
  }
  const onDbl = (e: React.MouseEvent) => {
    const el = pick(e)
    if (el && primary) startEdit(el)
  }

  /* ресайз за ручки */
  const resize = (dir: 'e' | 's' | 'se') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const el = getEl(useDesign.getState().sel)
    if (!el) return
    const r = el.getBoundingClientRect()
    const sx = e.clientX,
      sy = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom,
        dy = (ev.clientY - sy) / zoom
      const patch: Record<string, string> = {}
      if (dir !== 's') patch.width = Math.max(8, Math.round(r.width + dx)) + 'px'
      if (dir !== 'e') patch.height = Math.max(8, Math.round(r.height + dy)) + 'px'
      Object.entries(patch).forEach(([k, v]) => el.style.setProperty(k, v))
      setTick((t) => t + 1)
    }
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      setStyles(el, {}, 'Размер')
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }

  const live = !!doc && !!doc.defaultView && doc === ifr.current?.contentDocument
  const selEl = live && sel ? elAt(doc!, sel as Path) : null
  const hovEl = live && hover ? elAt(doc!, hover as Path) : null
  const sb = boxOf(selEl),
    hb = hovEl && hovEl !== selEl ? boxOf(hovEl) : null
  void tick
  const z = 1 / zoom
  return (
    <div className="dfr" style={{ width: W }}>
      <div
        className="dfr-h"
        style={{ transform: `scale(${Math.max(1, z * 0.9)})`, transformOrigin: 'left bottom' }}
      >
        <b>{DEVICE_RU[device]}</b>
        <span>{W}</span>
        {!primary && <i>отражение</i>}
      </div>
      <div className={'dfr-box' + (flash ? ' flash' : '')} key={flash} style={{ width: W, height }}>
        <iframe
          ref={ifr}
          title={DEVICE_RU[device]}
          srcDoc={primary ? base : html}
          sandbox="allow-same-origin"
          onLoad={onLoad}
          style={{ width: W, height }}
        />
        <div
          className="dfr-ov"
          ref={ov}
          style={{ pointerEvents: editing ? 'none' : 'auto', ['--z' as string]: z }}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => !dragRef.current && useDesign.setState({ hover: null })}
          onDoubleClick={onDbl}
        >
          {hb && <i className="hbox" style={{ left: hb.x, top: hb.y, width: hb.w, height: hb.h }} />}
          {sb && (
            <div
              className={'sbox' + (primary ? '' : ' ghost')}
              style={{ left: sb.x, top: sb.y, width: sb.w, height: sb.h }}
            >
              {primary && selEl && (
                <span className="slab">
                  {describe(selEl)} · {Math.round(sb.w)}×{Math.round(sb.h)}
                </span>
              )}
              {primary && !editing && (
                <>
                  <b className="rh e" onPointerDown={resize('e')} />
                  <b className="rh s" onPointerDown={resize('s')} />
                  <b className="rh se" onPointerDown={resize('se')} />
                </>
              )}
            </div>
          )}
          {drag?.drop && (
            <i
              className="dropl"
              style={{
                left: drag.drop.line.x,
                top: drag.drop.line.y,
                width: drag.drop.line.w,
                height: drag.drop.line.h,
              }}
            />
          )}
          {drag && (
            <i
              className="gbox"
              style={{ left: drag.ghost.x, top: drag.ghost.y, width: drag.ghost.w, height: drag.ghost.h }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
