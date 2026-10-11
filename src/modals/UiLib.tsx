/* Режим «Дизайн» → Компоненты: библиотеки shadcn/ui, Magic UI, React Bits и свой реестр.
   Живой предпросмотр, вставка на страницу и добавление файлов в проект. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { useDesign } from '../design/store'
import { getEl, insertBlock } from '../design/actions'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { Segmented } from '../components/ui/primitives'
import {
  UI_SOURCES,
  loadIndex,
  filterUi,
  resolveBundle,
  materialize,
  detectLayout,
  customSource,
  getJson,
  addDeps,
  npmLatest,
  mergeCss,
  type UiItem,
  type UiSource,
  type RegItem,
  type Materialized,
} from '../lib/uireg'
import { previewDoc, embedBlock } from '../lib/uirun'

type Prev = { state: 'load' | 'ready' | 'error'; msg?: string; doc?: string; m?: Materialized }
type Plan = { m: Materialized; clash: string[]; hasPkg: boolean; cssPath?: string }

export function UiLibModal() {
  const p = useProject()!
  const [srcId, setSrcId] = useState('shadcn')
  const [custom, setCustom] = useState<UiSource | null>(null)
  const [urlText, setUrlText] = useState('')
  const [items, setItems] = useState<UiItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [lim, setLim] = useState(60)
  const [sel, setSel] = useState<UiItem | null>(null)
  const [dark, setDark] = useState(() => !document.documentElement.classList.contains('light'))
  const [prev, setPrev] = useState<Prev | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [pkgOn, setPkgOn] = useState(true)
  const frame = useRef<HTMLIFrameElement>(null)
  const canInsert = !!useDesign((s) => s.doc)

  const src: UiSource | null = srcId === 'custom' ? custom : (UI_SOURCES.find((s) => s.id === srcId) ?? null)

  /* список выбранного реестра */
  useEffect(() => {
    setItems([])
    setSel(null)
    setErr('')
    setLim(60)
    if (!src || srcId === 'custom') return
    let live = true
    setLoading(true)
    loadIndex(src)
      .then((x) => live && setItems(x))
      .catch((e: Error) => live && setErr(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [srcId, src])

  const shown = useMemo(() => filterUi(items, q), [items, q])

  /* предпросмотр выбранного */
  useEffect(() => {
    setPlan(null)
    if (!sel || !src) return setPrev(null)
    let live = true
    setPrev({ state: 'load' })
    void (async () => {
      try {
        const b = await resolveBundle(src, sel.demo || sel.name)
        const m = materialize(b)
        if (!m.entry) throw new Error('В компоненте нет файла, который можно показать')
        const doc = previewDoc({
          files: m.files,
          entry: m.entry,
          deps: m.deps,
          css: m.css,
          dark,
          sample: !sel.demo,
        })
        if (live) setPrev({ state: 'load', doc, m })
      } catch (e) {
        if (live) setPrev({ state: 'error', msg: (e as Error).message })
      }
    })()
    return () => {
      live = false
    }
  }, [sel, src, dark])

  /* статус из iframe */
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data?.tfui
      if (d?.state === 'ready') setPrev((x) => (x ? { ...x, state: 'ready' } : x))
      if (d?.state === 'error') setPrev((x) => (x ? { ...x, state: 'error', msg: String(d.msg || '') } : x))
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])

  const openCustom = async () => {
    setErr('')
    try {
      const { src: s, single } = customSource(urlText)
      setLoading(true)
      setCustom(s)
      if (single) {
        const j = (await getJson(s.index)) as RegItem
        if (!j?.name) throw new Error('Это не описание компонента')
        setItems([
          {
            source: 'custom',
            name: s.index,
            title: j.title || j.name,
            desc: j.description || '',
            type: j.type || '',
          },
        ])
      } else setItems(await loadIndex(s))
      setSel(null)
    } catch (e) {
      setErr((e as Error).message)
      setCustom(null)
    }
    setLoading(false)
  }

  const insert = () => {
    if (!sel || !prev?.m) return
    const id = Math.random().toString(36).slice(2, 8)
    const m = prev.m
    const html = embedBlock(
      { files: m.files, entry: m.entry, deps: m.deps, css: m.css, dark, sample: !sel.demo },
      id,
      sel.title,
    )
    const el = insertBlock(html, getEl(useDesign.getState().sel))
    if (!el)
      return toast({
        title: 'Не вставлено',
        desc: 'Откройте страницу в режиме «Дизайн»',
        icon: 'warn',
        tone: 'warn',
      })
    useStore.getState().closeModal()
    toast({
      title: `Вставлено: ${sel.title}`,
      desc: 'На холсте это рамка-заглушка; живой компонент виден на вкладке «Превью». Нужен интернет.',
      icon: 'check',
      action: { label: 'Превью', run: () => useDesign.setState({ sub: 'preview', editing: false }) },
    })
  }

  const prepare = async () => {
    if (!sel || !src || busy) return
    setBusy(true)
    try {
      const b = await resolveBundle(src, sel.name)
      const m = materialize(b, detectLayout(p.files), p.files)
      const clash = Object.keys(m.files).filter((f) => f in p.files && !m.same.includes(f))
      setPlan({
        m,
        clash,
        hasPkg: 'package.json' in p.files,
        cssPath: mergeCss(p.files, sel.name, m.css)?.path,
      })
    } catch (e) {
      toast({
        title: 'Не удалось собрать',
        desc: (e as Error).message.slice(0, 300),
        icon: 'warn',
        tone: 'warn',
      })
    }
    setBusy(false)
  }

  const apply = async () => {
    if (!plan || !sel) return
    setBusy(true)
    const st = useStore.getState()
    const { m } = plan
    let n = 0
    for (const [path, text] of Object.entries(m.files))
      if (!m.same.includes(path)) {
        st.writeFile(path, text, p.id)
        n++
      }
    let depsNote = ''
    if (plan.hasPkg && pkgOn && (Object.keys(m.deps).length || Object.keys(m.dev).length)) {
      const r = await addDeps(p.files['package.json'], m.deps, m.dev, npmLatest)
      if (r.error) depsNote = r.error
      else if (r.added.length) {
        st.writeFile('package.json', r.text, p.id)
        depsNote = `В package.json добавлено: ${r.added.join(', ')} — выполните npm install.`
      }
    }
    const css = mergeCss(
      useStore.getState().projects.find((x) => x.id === p.id)?.files ?? p.files,
      sel.name,
      m.css,
    )
    if (css) st.writeFile(css.path, css.text, p.id)
    setBusy(false)
    setPlan(null)
    st.closeModal()
    toast({
      title: `Добавлено: ${sel.title}`,
      desc:
        `${n} ф. в проект.` +
        (depsNote ? ' ' + depsNote : '') +
        (m.css && !css ? ' Стили компонента не записаны — нет CSS с Tailwind, скопируйте их вручную.' : '') +
        ' Откат — в истории версий.',
      icon: 'check',
    })
  }

  return (
    <Modal kind="bare" label="Библиотека компонентов">
      <div className="mcard ul-card">
        <div className="mcard-in">
          <MHead
            icon="layers"
            title="Библиотека компонентов"
            sub="Готовые компоненты с анимациями: смотрите вживую, вставляйте на страницу или добавляйте в проект."
          />
          <div className="ul-top">
            <Segmented
              value={srcId}
              onChange={(v) => setSrcId(v)}
              options={[
                ...UI_SOURCES.map((s) => ({ k: s.id, t: s.name })),
                { k: 'custom', t: 'Свой реестр' },
              ]}
              label="Источник"
            />
            {srcId === 'custom' ? (
              <form
                className="ec-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void openCustom()
                }}
              >
                <input
                  className="inp"
                  placeholder="https://…/registry.json или https://…/компонент.json"
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  aria-label="Ссылка на реестр"
                />
                <button className="btn sm pri" type="submit" disabled={!urlText.trim() || loading}>
                  Открыть
                </button>
              </form>
            ) : (
              <input
                className="inp"
                placeholder="Поиск: marquee, кнопка, text, dialog…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Поиск компонента"
              />
            )}
          </div>
          <div className="ul-body">
            <div className="ul-list" role="listbox" aria-label="Компоненты">
              {loading && <div className="dim ul-pad">Загружаю список…</div>}
              {err && <div className="ext-note bad">{err}</div>}
              {!loading && !err && !shown.length && src && (
                <div className="dim ul-pad">Ничего не найдено</div>
              )}
              {shown.slice(0, lim).map((i) => (
                <button
                  key={i.name}
                  role="option"
                  aria-selected={sel?.name === i.name}
                  className={'ul-it' + (sel?.name === i.name ? ' on' : '')}
                  onClick={() => setSel(i)}
                >
                  <b>{i.title}</b>
                  <span className="dim">{i.desc || i.name}</span>
                </button>
              ))}
              {shown.length > lim && (
                <button className="btn sm gho" onClick={() => setLim(lim + 60)}>
                  Показать ещё ({shown.length - lim})
                </button>
              )}
            </div>
            <div className="ul-view">
              {!sel ? (
                <div className="ul-empty dim">Выберите компонент слева — он запустится прямо здесь.</div>
              ) : (
                <>
                  <div className="ul-head">
                    <b>{sel.title}</b>
                    <span className="ec-tag">{src?.name}</span>
                    <span className="grow" />
                    <button className="btn sm gho" onClick={() => setDark(!dark)} aria-pressed={dark}>
                      {dark ? 'Тёмный фон' : 'Светлый фон'}
                    </button>
                  </div>
                  <div className="ul-frame">
                    {prev?.doc && prev.state !== 'error' && (
                      <iframe
                        ref={frame}
                        title={'Предпросмотр: ' + sel.title}
                        sandbox="allow-scripts"
                        srcDoc={prev.doc}
                      />
                    )}
                    {prev?.state === 'load' && <div className="ul-state dim">Загружаю и запускаю…</div>}
                    {prev?.state === 'error' && <div className="ext-note bad ul-state">{prev.msg}</div>}
                  </div>
                  {!plan ? (
                    <div className="ec-act">
                      <button
                        className="btn sm pri"
                        disabled={!canInsert || prev?.state !== 'ready'}
                        onClick={insert}
                      >
                        <Icon name="plus" size={13} /> Вставить на страницу
                      </button>
                      <button className="btn sm" disabled={busy} onClick={() => void prepare()}>
                        <Icon name="down" size={13} /> {busy ? 'Собираю…' : 'Добавить в проект'}
                      </button>
                      {src && (
                        <a className="linkbtn" href={src.site} target="_blank" rel="noreferrer noopener">
                          Сайт
                        </a>
                      )}
                    </div>
                  ) : (
                    <PlanView
                      plan={plan}
                      pkgOn={pkgOn}
                      setPkgOn={setPkgOn}
                      busy={busy}
                      apply={() => void apply()}
                      cancel={() => setPlan(null)}
                    />
                  )}
                  {!canInsert && !plan && (
                    <div className="dim ul-hint">
                      Чтобы вставить на страницу, откройте её в режиме «Дизайн».
                    </div>
                  )}
                  <div className="dim ul-hint">
                    Предпросмотр и вставка на страницу загружают пакеты из интернета (esm.sh, Tailwind). Для
                    настоящего сайта используйте «Добавить в проект».
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function PlanView({
  plan,
  pkgOn,
  setPkgOn,
  busy,
  apply,
  cancel,
}: {
  plan: Plan
  pkgOn: boolean
  setPkgOn: (v: boolean) => void
  busy: boolean
  apply: () => void
  cancel: () => void
}) {
  const { m } = plan
  const deps = [...Object.keys(m.deps), ...Object.keys(m.dev)]
  return (
    <div className="mk-det">
      <div className="mk-files">
        <div className="dim">Файлы в проекте:</div>
        {Object.keys(m.files).map((f) => (
          <code key={f}>
            {f}
            {m.same.includes(f) ? ' — уже такой же' : plan.clash.includes(f) ? ' — заменит существующий' : ''}
          </code>
        ))}
      </div>
      {plan.clash.length > 0 && (
        <div className="ext-note warn">
          Существующие файлы будут заменены. Вернуть можно через историю версий.
        </div>
      )}
      {deps.length > 0 && (
        <label className="ul-chk">
          <input
            type="checkbox"
            checked={pkgOn}
            disabled={!plan.hasPkg}
            onChange={(e) => setPkgOn(e.target.checked)}
          />
          <span>
            {plan.hasPkg
              ? `Добавить в package.json: ${deps.join(', ')}`
              : `Нужны пакеты: ${deps.join(', ')} (в проекте нет package.json — поставьте сами)`}
          </span>
        </label>
      )}
      {m.css && (
        <div className="dim">
          {plan.cssPath
            ? `Стили компонента допишутся в ${plan.cssPath}.`
            : 'В проекте нет CSS с Tailwind — стили компонента придётся добавить вручную.'}
        </div>
      )}
      {m.notes.map((n) => (
        <div className="ext-note" key={n}>
          {n}
        </div>
      ))}
      <div className="ec-act">
        <button className="btn sm pri" disabled={busy} onClick={apply}>
          {plan.clash.length ? 'Заменить и добавить' : 'Добавить'}
        </button>
        <button className="btn sm gho" onClick={cancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}
