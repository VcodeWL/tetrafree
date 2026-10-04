/* Режим «Дизайн»: реальный сайт проекта на холсте. Три подрежима — Холст (правка как в Figma),
   Превью (живая страница со скриптами) и Код (HTML рядом с холстом). Файл проекта — общий источник правды. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, useProject } from '../store'
import { useDesign, DEVICE_W, DEVICE_RU, type Device, type SubMode } from './store'
import { Canvas } from './Canvas'
import { Layers, Pages } from './Layers'
import { Inspector } from './Inspector'
import { CodeEditor } from './CodeEditor'
import { AiBar } from './AiBar'
import {
  commitDoc,
  createPage,
  duplicateEl,
  flushVersion,
  getEl,
  insertBlock,
  redo,
  removeEl,
  selectParent,
  setLastWritten,
  getLastWritten,
  undo,
  moveEl,
} from './actions'
import { BLOCKS } from './dom'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/iconData'
import { Logo } from '../components/ui/primitives'
import { Menu, MenuHead, MenuItem, useMenu } from '../components/ui/Menu'
import { SECTION_HTML, blankSite } from '../data/site'
import { backendOnline, previewUrl } from '../lib/backend'
import { ago, clamp, modKey } from '../lib/util'
import { openExternal } from '../lib/desktop'

/* блоки в левой панели: иконка, подпись, горячая клавиша */
const RAIL_BLOCKS: { key: string; icon: IconName; label: string; hot: string; shift?: boolean }[] = [
  { key: 'h2', icon: 'h2', label: 'Заголовок', hot: 't', shift: true },
  { key: 'p', icon: 'text', label: 'Текст', hot: 't' },
  { key: 'btn', icon: 'btnblock', label: 'Кнопка', hot: 'b' },
  { key: 'img', icon: 'imgblock', label: 'Картинка', hot: 'i' },
  { key: 'card', icon: 'cardblock', label: 'Карточка', hot: 'c' },
  { key: 'row', icon: 'rowblock', label: 'Ряд (flex)', hot: 'r' },
  { key: 'hr', icon: 'divblock', label: 'Разделитель', hot: 'd' },
]
function addBlock(key: string) {
  const b = BLOCKS.find((x) => x.key === key)
  if (!b) return
  const sel = getEl(useDesign.getState().sel)
  const el = insertBlock(b.html, sel)
  if (el && /^(H\d|P)$/.test(el.tagName))
    setTimeout(() => window.dispatchEvent(new Event('tf:design-edit')), 60)
}

const SUBS: [SubMode, string, 'frame' | 'play' | 'code'][] = [
  ['canvas', 'Холст', 'frame'],
  ['preview', 'Превью', 'play'],
  ['code', 'Код', 'code'],
]

export function Studio() {
  const p = useProject()!
  const d = useDesign()
  const pages = Object.keys(p.files)
    .filter((f) => /^site\/.*\.html$/.test(f))
    .sort()
  const page =
    d.page && d.page in p.files
      ? d.page
      : pages.includes('site/index.html')
        ? 'site/index.html'
        : pages[0] || null
  const html = page ? p.files[page] : ''
  const [base, setBase] = useState(html)
  const [flash, setFlash] = useState(0)
  const ins = useMenu()
  const prev = useRef<{ page: string | null; pid: string }>({ page: null, pid: '' })

  /* смена страницы / проекта */
  useEffect(() => {
    if (prev.current.page === page && prev.current.pid === p.id) return
    flushVersion()
    prev.current = { page, pid: p.id }
    useDesign.setState({
      page,
      sel: null,
      hover: null,
      editing: false,
      undo: [],
      redo: [],
      doc: null,
      fit: true,
    })
    setBase(html)
    setLastWritten(html)
  }, [page, p.id, html])
  /* внешняя правка (агент, диск, код) → перезагрузить холст */
  useEffect(() => {
    if (!page || html === getLastWritten()) return
    setLastWritten(html)
    useDesign.setState({ doc: null })
    setBase(html)
    setFlash((f) => f + 1)
  }, [html, page])
  useEffect(() => () => flushVersion(), [])

  /* горячие клавиши */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (
        t.closest('input,textarea,select,[contenteditable]') ||
        document.querySelector('.modal-root, .overlay')
      )
        return
      const mod = e.ctrlKey || e.metaKey
      const s = useDesign.getState()
      if (s.sub !== 'canvas' && s.sub !== 'code') return
      const el = getEl(s.sel)
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd' && el) {
        e.preventDefault()
        duplicateEl(el)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && el) {
        e.preventDefault()
        removeEl(el)
        return
      }
      if (e.key === 'Escape') {
        selectParent()
        return
      }
      if (e.key === 'Enter' && el) {
        e.preventDefault()
        window.dispatchEvent(new Event('tf:design-edit'))
        return
      }
      if (e.altKey && e.key === 'ArrowUp' && el) {
        e.preventDefault()
        moveEl(el, -1)
        return
      }
      if (e.altKey && e.key === 'ArrowDown' && el) {
        e.preventDefault()
        moveEl(el, 1)
        return
      }
      if (s.sub === 'canvas' && !mod && !e.altKey) {
        const k = e.key.toLowerCase()
        const code = e.code.replace('Key', '').toLowerCase()
        const key = /^[a-z]$/.test(k) ? k : code.length === 1 ? code : ''
        if (key === 'v') return void useDesign.setState({ tool: 'select' })
        if (key === 'h' && !e.shiftKey) return void useDesign.setState({ tool: 'hand' })
        if (key === 'g') return void useDesign.setState({ grid: !s.grid })
        const blk = RAIL_BLOCKS.find((b) => b.hot === key && !!b.shift === e.shiftKey)
        if (blk) {
          e.preventDefault()
          addBlock(blk.key)
          return
        }
      }
      if (s.sub === 'canvas' && !mod) {
        if (e.key === '=' || e.key === '+')
          useDesign.setState({ zoom: clamp(s.zoom * 1.2, 0.1, 3), fit: false })
        else if (e.key === '-') useDesign.setState({ zoom: clamp(s.zoom / 1.2, 0.1, 3), fit: false })
        else if (e.key === '0') useDesign.setState({ fit: true })
        else if (e.key === '1') useDesign.setState({ zoom: 1, fit: false })
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const setSub = (m: SubMode) => {
    if (m !== 'canvas') flushVersion()
    useDesign.setState({ sub: m, editing: false })
  }
  const sel = getEl(d.sel)
  const hasGrid = html.includes('.grid')

  if (!page) return <EmptyStudio />
  const frames: Device[] = d.sub === 'code' ? ['desktop'] : d.frames
  return (
    <div className="studio">
      <div className="st-tb">
        <div className="st-sub" role="tablist" aria-label="Подрежим дизайна">
          {SUBS.map(([k, t, ic]) => (
            <button
              key={k}
              role="tab"
              aria-selected={d.sub === k}
              className={d.sub === k ? 'on' : ''}
              onClick={() => setSub(k)}
            >
              <Icon name={ic === 'play' ? 'play' : ic === 'code' ? 'code' : 'frame'} size={13} />
              {t}
            </button>
          ))}
        </div>
        <button
          className="st-page"
          onClick={() => useDesign.setState({ leftTab: 'pages' })}
          title="Страницы проекта"
        >
          <Icon name="browser" size={13} />
          <span>{page.replace(/^site\//, '')}</span>
          {pages.length > 1 && <i>{pages.length}</i>}
        </button>
        <div className="st-sync" title="Файл проекта — общий источник правды для холста, кода и агентов">
          <i className={Date.now() - d.saved < 2500 ? 'pulse' : ''} />
          {d.saved ? `Записано в ${page} · ${ago(d.saved)}` : `Синхронно с ${page}`}
        </div>
        <span className="grow" />
        {d.sub === 'canvas' && (
          <>
            <button
              className="iconbtn sm"
              title={`Отменить (${modKey}+Z)`}
              disabled={!d.undo.length}
              onClick={undo}
            >
              <Icon name="undo" size={15} />
            </button>
            <button
              className="iconbtn sm"
              title={`Повторить (${modKey}+Shift+Z)`}
              disabled={!d.redo.length}
              onClick={redo}
            >
              <Icon name="redo" size={15} />
            </button>
            <span className="st-sep" />
            <button className="btn sm" onClick={ins.open} title="Добавить элемент после выбранного">
              <Icon name="plus" size={13} />
              Добавить
            </button>
            <div className="st-zoom">
              <button
                onClick={() => useDesign.setState({ zoom: clamp(d.zoom / 1.2, 0.1, 3), fit: false })}
                aria-label="Уменьшить"
              >
                <Icon name="minus" size={12} />
              </button>
              <button
                className="zoomval"
                onClick={() => useDesign.setState({ fit: true })}
                title="Вписать (0)"
                aria-label={`Масштаб ${Math.round(d.zoom * 100)}% — вписать в окно`}
              >
                {Math.round(d.zoom * 100)}%
              </button>
              <button
                onClick={() => useDesign.setState({ zoom: clamp(d.zoom * 1.2, 0.1, 3), fit: false })}
                aria-label="Увеличить"
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
          </>
        )}
        {page && p.files[page] !== undefined && (
          <button
            className="iconbtn sm"
            title="Скачать страницу как HTML"
            onClick={() => {
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([p.files[page]], { type: 'text/html' }))
              a.download = page.split('/').pop() || 'page.html'
              a.click()
              setTimeout(() => URL.revokeObjectURL(a.href), 1000)
            }}
          >
            <Icon name="down" size={15} />
          </button>
        )}
        {backendOnline() && (
          <button
            className="iconbtn sm"
            title="Открыть страницу из папки проекта в браузере"
            onClick={() => openExternal(previewUrl(p, page))}
          >
            <Icon name="external" size={15} />
          </button>
        )}
      </div>

      <div className={'st-body sub-' + d.sub}>
        {d.sub === 'canvas' && <Rail sel={!!sel} />}
        {d.sub !== 'preview' && (
          <aside className="st-left" aria-label="Слои и страницы">
            <div className="dtabs">
              <button
                className={d.leftTab === 'layers' ? 'on' : ''}
                onClick={() => useDesign.setState({ leftTab: 'layers' })}
              >
                Слои
              </button>
              <button
                className={d.leftTab === 'pages' ? 'on' : ''}
                onClick={() => useDesign.setState({ leftTab: 'pages' })}
              >
                Страницы
              </button>
            </div>
            <div className="dscroll">
              {d.leftTab === 'layers' ? (
                <Layers />
              ) : (
                <Pages page={page} onPick={(pg) => useDesign.setState({ page: pg, leftTab: 'layers' })} />
              )}
            </div>
          </aside>
        )}
        <div className="st-center">
          {d.sub === 'preview' ? (
            <Preview html={html} />
          ) : (
            <div className={'st-split' + (d.sub === 'code' ? ' two' : '')}>
              <div className="st-cv">
                <Canvas base={base} html={html} frames={frames} flash={flash} />
                {d.sub === 'canvas' && <AiBar page={page} />}
              </div>
              {d.sub === 'code' && (
                <div className="st-code">
                  <CodeEditor
                    value={html}
                    path={page}
                    onChange={(v) => {
                      if (v !== p.files[page]) useStore.getState().writeFile(page, v)
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {d.sub !== 'preview' && <Inspector />}
      </div>

      {ins.st && (
        <Menu anchor={ins.st.anchor} onClose={ins.close} width={240}>
          <MenuHead>{sel ? 'Добавить после выбранного' : 'Добавить на страницу'}</MenuHead>
          {BLOCKS.map((b) => (
            <MenuItem
              key={b.key}
              label={b.label}
              onClick={() => {
                ins.close()
                const el = insertBlock(b.html, sel)
                if (el && /^(H\d|P)$/.test(el.tagName))
                  setTimeout(() => window.dispatchEvent(new Event('tf:design-edit')), 60)
              }}
            />
          ))}
          {hasGrid && <MenuHead>Готовые секции</MenuHead>}
          {hasGrid &&
            Object.entries({
              features: 'Возможности',
              pricing: 'Тарифы',
              faq: 'Вопросы',
              testimonials: 'Отзыв',
            }).map(([k, t]) => (
              <MenuItem
                key={k}
                label={t}
                onClick={() => {
                  ins.close()
                  insertBlock(SECTION_HTML[k], sel)
                }}
              />
            ))}
        </Menu>
      )}
    </div>
  )
}

function EmptyStudio() {
  const p = useProject()!
  const [name, setName] = useState('Главная')
  const st = useStore.getState
  return (
    <div className="studio empty">
      <div className="st-empty">
        <Logo size={46} />
        <h2>В проекте пока нет страниц</h2>
        <p>
          Режим «Дизайн» рисует настоящие HTML-страницы из папки <code>site/</code>. Создай первую — или
          попроси дизайнера собрать её по описанию.
        </p>
        <div className="row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название страницы"
            aria-label="Название страницы"
          />
          <button
            className="btn pri"
            onClick={() => {
              const path = 'site/index.html'
              if (!(path in p.files)) {
                st().writeFile(path, blankSite(p.name))
                st().commit({
                  title: 'Первая страница',
                  by: 'human',
                  author: st().people.me.name,
                  tag: 'build',
                  feats: ['site/index.html'],
                  changes: [],
                  fixes: [],
                  details: [],
                })
              } else createPage(name)
              useDesign.setState({ page: null })
            }}
          >
            <Icon name="plus" size={14} />
            Создать страницу
          </button>
        </div>
        <span className="t4">Или в чате: «собери лендинг для …» — страница появится здесь сама</span>
      </div>
    </div>
  )
}

function Preview({ html }: { html: string }) {
  const dev = useDesign((s) => s.previewDevice)
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [key, setKey] = useState(0)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const W = DEVICE_W[dev]
  const k = Math.min(1, (box.w - 40) / W)
  const reload = useCallback(() => setKey((x) => x + 1), [])
  return (
    <div className="dprev">
      <div className="dprev-bar">
        <div className="dseg">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
            <button
              key={d}
              className={d === dev ? 'on' : ''}
              onClick={() => useDesign.setState({ previewDevice: d })}
            >
              <Icon name={d} size={13} />
              {DEVICE_RU[d]} · {DEVICE_W[d]}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="t4">Живая страница: скрипты и ссылки работают. Правки — на холсте или в коде.</span>
        <button className="btn sm" onClick={reload}>
          <Icon name="refresh" size={13} />
          Перезагрузить
        </button>
      </div>
      <div className="dprev-stage" ref={stage}>
        <div className="dprev-dev" style={{ width: W * k, height: Math.max(300, box.h - 40) }}>
          <iframe
            key={key}
            title="Превью"
            srcDoc={html}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            style={{
              width: W,
              height: Math.max(300, box.h - 40) / k,
              transform: `scale(${k})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>
    </div>
  )
}
void commitDoc

function RailBtn({
  icon,
  tip,
  hot,
  on,
  disabled,
  onClick,
  i = 0,
}: {
  icon: IconName
  tip: string
  hot?: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
  i?: number
}) {
  return (
    <button
      className={'rb' + (on ? ' on' : '')}
      style={{ animationDelay: i * 22 + 'ms' }}
      aria-label={tip + (hot ? ` (${hot})` : '')}
      aria-pressed={on === undefined ? undefined : on}
      data-tip={tip}
      data-hot={hot}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={17} />
    </button>
  )
}

/* вертикальная панель инструментов: курсор/рука, блоки, действия над выбранным, устройства и сетка */
function Rail({ sel }: { sel: boolean }) {
  const tool = useDesign((s) => s.tool)
  const grid = useDesign((s) => s.grid)
  const frames = useDesign((s) => s.frames)
  const mobile = frames.includes('mobile')
  const tablet = frames.includes('tablet')
  let n = 0
  return (
    <nav className="st-rail" aria-label="Инструменты дизайна">
      <RailBtn
        i={n++}
        icon="cursor"
        tip="Выбор"
        hot="V"
        on={tool === 'select'}
        onClick={() => useDesign.setState({ tool: 'select' })}
      />
      <RailBtn
        i={n++}
        icon="hand"
        tip="Рука — двигать холст"
        hot="H"
        on={tool === 'hand'}
        onClick={() => useDesign.setState({ tool: 'hand' })}
      />
      <i className="rsep" />
      {RAIL_BLOCKS.map((b) => (
        <RailBtn
          key={b.key}
          i={n++}
          icon={b.icon}
          tip={'Добавить: ' + b.label.toLowerCase()}
          hot={(b.shift ? 'Shift+' : '') + b.hot.toUpperCase()}
          onClick={() => addBlock(b.key)}
        />
      ))}
      <i className="rsep" />
      <RailBtn
        i={n++}
        icon="copy"
        tip="Дублировать"
        hot={modKey + '+D'}
        disabled={!sel}
        onClick={() => {
          const el = getEl(useDesign.getState().sel)
          if (el) duplicateEl(el)
        }}
      />
      <RailBtn
        i={n++}
        icon="trash"
        tip="Удалить"
        hot="Del"
        disabled={!sel}
        onClick={() => {
          const el = getEl(useDesign.getState().sel)
          if (el) removeEl(el)
        }}
      />
      <span className="grow" />
      <RailBtn
        i={n++}
        icon="grid"
        tip="Сетка 16 px"
        hot="G"
        on={grid}
        onClick={() => useDesign.setState({ grid: !grid })}
      />
      <RailBtn
        i={n++}
        icon="tablet"
        tip="Показать планшет"
        on={tablet}
        onClick={() =>
          useDesign.setState({
            frames: tablet
              ? frames.filter((f) => f !== 'tablet')
              : (['desktop', 'tablet', ...frames.filter((f) => f === 'mobile')] as Device[]),
            fit: true,
          })
        }
      />
      <RailBtn
        i={n++}
        icon="mobile"
        tip="Показать телефон рядом"
        on={mobile}
        onClick={() =>
          useDesign.setState({ frames: mobile ? ['desktop'] : ['desktop', 'mobile'], fit: true })
        }
      />
    </nav>
  )
}
