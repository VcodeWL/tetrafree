import { useMemo, useState } from 'react'
import { useDesign } from './store'
import { Icon } from '../components/ui/Icon'
import { createPage, moveTo } from './actions'
import { kids, pathKey, ruName, snippet, type Path } from './dom'
import { useProject } from '../store'
import { rowKeys } from '../lib/a11y'

export function Layers() {
  const doc = useDesign((s) => s.doc)
  const rev = useDesign((s) => s.rev)
  const sel = useDesign((s) => s.sel)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [over, setOver] = useState<{ key: string; pos: 'before' | 'after' } | null>(null)
  const dragKey = useState<{ k: string | null }>({ k: null })[0]
  const rows = useMemo(() => {
    if (!doc || !doc.defaultView) return []
    const out: { key: string; path: Path; el: HTMLElement; depth: number; has: boolean }[] = []
    const walk = (el: Element, path: Path, depth: number) =>
      kids(el).forEach((c, i) => {
        const p = [...path, i]
        const k = pathKey(p)
        const ks = kids(c)
        out.push({ key: k, path: p, el: c as HTMLElement, depth, has: ks.length > 0 })
        if (ks.length && !closed.has(k)) walk(c, p, depth + 1)
      })
    walk(doc.body, [], 0)
    return out
  }, [doc, rev, closed]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) =>
    setClosed((c) => {
      const n = new Set(c)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const selKey = pathKey(sel)
  if (!doc) return <div className="dl-empty">Страница загружается…</div>
  return (
    <div
      className="dlayers"
      role="tree"
      aria-label="Слои страницы"
      onMouseLeave={() => useDesign.setState({ hover: null })}
    >
      {rows.map((r, idx) => {
        const on = r.key === selKey
        const anc = !on && selKey.startsWith(r.key + '.')
        const name = ruName(r.el)
        const sn = snippet(r.el, 22)
        return (
          <div
            key={r.key}
            className={
              'dlr' +
              (on ? ' on' : '') +
              (anc ? ' anc' : '') +
              (over?.key === r.key ? ' drop-' + over.pos : '')
            }
            style={{ paddingLeft: 8 + r.depth * 14 }}
            draggable
            role="treeitem"
            aria-level={r.depth + 1}
            aria-selected={on}
            aria-expanded={r.has ? !closed.has(r.key) : undefined}
            tabIndex={on || (idx === 0 && !rows.some((x) => x.key === selKey)) ? 0 : -1}
            onFocus={() => useDesign.setState({ hover: r.path })}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                r.has &&
                (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
              ) {
                const shut = closed.has(r.key)
                if ((e.key === 'ArrowRight') === shut) {
                  e.preventDefault()
                  toggle(r.key)
                }
                return
              }
              rowKeys({ open: () => useDesign.setState({ sel: r.path, editing: false }) }, '.dlayers .dlr')(e)
            }}
            onClick={() => useDesign.setState({ sel: r.path, editing: false })}
            onMouseEnter={() => useDesign.setState({ hover: r.path })}
            onDragStart={(e) => {
              dragKey.k = r.key
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', r.key)
            }}
            onDragOver={(e) => {
              if (dragKey.k && dragKey.k !== r.key && !r.key.startsWith(dragKey.k + '.')) {
                e.preventDefault()
                const b = e.currentTarget.getBoundingClientRect()
                setOver({ key: r.key, pos: e.clientY < b.top + b.height / 2 ? 'before' : 'after' })
              }
            }}
            onDragLeave={() => setOver((o) => (o?.key === r.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragKey.k && rows.find((x) => x.key === dragKey.k)
              if (from && over) moveTo(from.el, r.el, over.pos)
              dragKey.k = null
              setOver(null)
            }}
            onDragEnd={() => {
              dragKey.k = null
              setOver(null)
            }}
          >
            <span
              className="dlt"
              onClick={(e) => {
                e.stopPropagation()
                if (r.has) toggle(r.key)
              }}
            >
              {r.has && <Icon name={closed.has(r.key) ? 'chev' : 'chevd'} size={9} />}
            </span>
            <span className="dli">
              <Icon
                name={
                  r.el.tagName === 'IMG'
                    ? 'image'
                    : /^H[1-6]$/.test(r.el.tagName)
                      ? 'h2'
                      : r.el.tagName === 'P' || r.el.tagName === 'SPAN' || r.el.tagName === 'B'
                        ? 'text'
                        : r.el.tagName === 'A' || r.el.tagName === 'BUTTON'
                          ? 'link'
                          : r.has
                            ? 'frame'
                            : 'dot'
                }
                size={12}
              />
            </span>
            <span className="dln">{name}</span>
            {sn && !r.has && <span className="dls">{sn}</span>}
          </div>
        )
      })}
      {!rows.length && (
        <div className="dl-empty">На странице нет элементов. Добавь первый кнопкой «+» сверху.</div>
      )}
    </div>
  )
}

export function Pages({ page, onPick }: { page: string | null; onPick: (p: string) => void }) {
  const p = useProject()!
  const pages = Object.keys(p.files)
    .filter((f) => /^site\/.*\.html$/.test(f))
    .sort()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="dpages">
      {pages.map((f) => (
        <button key={f} className={'dpg' + (f === page ? ' on' : '')} onClick={() => onPick(f)}>
          <Icon name="browser" size={13} />
          <span>{f.replace(/^site\//, '')}</span>
        </button>
      ))}
      {adding ? (
        <form
          className="dpg-new"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            const np = createPage(name)
            setAdding(false)
            setName('')
            if (np) onPick(np)
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название страницы"
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            onBlur={() => !name && setAdding(false)}
          />
        </form>
      ) : (
        <button className="dpg add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          Страница
        </button>
      )}
    </div>
  )
}
