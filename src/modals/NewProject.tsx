/* Новый проект: настоящая папка на диске. Либо создаём новую (родительская папка + имя), либо открываем существующую. */
import { useEffect, useRef, useState } from 'react'
import { useStore, toast } from '../store'
import { Icon, type IconName } from '../components/ui/Icon'
import { Modal, MHead } from '../components/ui/Modal'
import { Segmented } from '../components/ui/primitives'
import { slug, nFiles } from '../lib/util'
import {
  backendOnline,
  bBrowse,
  bCheckFolder,
  useBackend,
  type DirInfo,
  type FolderCheck,
} from '../lib/backend'
import { reconcile, forgetBase } from '../lib/sync'

const TEMPLATES: { k: string; icon: IconName; d: string }[] = [
  { k: 'Пустой', icon: 'folder', d: 'Только README' },
  { k: 'Сайт', icon: 'browser', d: 'site/index.html с живым превью' },
  { k: 'Node.js', icon: 'node', d: 'package.json, index.js, npm test' },
  { k: 'Python', icon: 'py', d: 'main.py' },
]
const LAST = 'tf.lastParent'

const join = (a: string, b: string, sep: string) =>
  !a ? b : a.endsWith('/') || a.endsWith('\\') ? a + b : a + sep + b
const baseName = (p: string) =>
  p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || ''
const parentOf = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

export function NewProjectModal({ mode: m0 = 'new' }: { mode?: 'new' | 'open' }) {
  const st = useStore.getState
  const projects = useStore((s) => s.projects)
  const info = useBackend((b) => b.info)
  const online = backendOnline()
  const sep = info?.sep || '/'
  const [mode, setMode] = useState<'new' | 'open'>(m0)
  const [name, setName] = useState('')
  const [parent, setParent] = useState(() => localStorage.getItem(LAST) || '')
  const [folder, setFolder] = useState('') // режим «открыть»
  const [tpl, setTpl] = useState('Пустой')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<null | 'parent' | 'folder'>(null)
  const [chk, setChk] = useState<FolderCheck | null>(null)

  /* родительская папка по умолчанию — корень проектов, который сообщил сервер */
  useEffect(() => {
    if (!parent && info?.root) setParent(info.root)
  }, [info?.root, parent])

  const s = slug(name)
  const target = mode === 'new' ? (parent && s ? join(parent.trim(), s, sep) : '') : folder.trim()
  const projName = mode === 'new' ? s : slug(name) || slug(baseName(folder))
  const dup = projects.find((p) => p.path && p.path.replace(/[\\/]+$/, '') === target.replace(/[\\/]+$/, ''))
  const nameErr =
    mode === 'new' && name.trim() && !s
      ? 'Используй буквы, цифры и дефисы'
      : projName && projects.some((p) => p.name === projName)
        ? 'Проект с таким именем уже есть'
        : ''

  /* проверка пути на сервере: права, существует ли, не пуста ли */
  const seq = useRef(0)
  useEffect(() => {
    setChk(null)
    if (!online || !target) return
    const my = ++seq.current
    const t = setTimeout(() => {
      bCheckFolder(target)
        .then((r) => my === seq.current && setChk(r))
        .catch((e) => my === seq.current && setChk({ ok: false, reason: (e as Error).message }))
    }, 250)
    return () => clearTimeout(t)
  }, [target, online])

  const nonEmpty = mode === 'new' && !!chk?.ok && !!chk.entries
  const missing = mode === 'open' && !!chk?.ok && !chk.exists
  const err = !online
    ? ''
    : dup
      ? `Эта папка уже открыта как проект «${dup.name}»`
      : chk && !chk.ok
        ? chk.reason || 'Папка недоступна'
        : nonEmpty
          ? 'В этой папке уже есть файлы — чтобы не затереть их, открой её как существующий проект'
          : missing
            ? 'Такой папки нет'
            : nameErr
  const ready = online && !!target && !!projName && !!chk?.ok && !err && !busy

  const create = async () => {
    if (!ready || !chk?.dir) return
    setBusy(true)
    if (mode === 'new') localStorage.setItem(LAST, parent.trim())
    const id = st().createProject({
      name: projName,
      path: chk.dir,
      template: mode === 'new' ? tpl : 'Пустой',
      adopt: mode === 'open',
    })
    const r = await reconcile(id, { quiet: true })
    if (mode === 'open')
      toast({
        title: `Открыто: ${projName}`,
        desc: r
          ? r.truncated
            ? `Папка большая — прочитана часть файлов (${nFiles(r.pulled)})`
            : `Прочитано файлов: ${r.pulled}`
          : chk.dir,
        icon: r?.truncated ? 'warn' : 'check',
        tone: r?.truncated ? 'warn' : 'ok',
      })
    else toast({ title: `Проект ${projName} создан`, desc: chk.dir, icon: 'check', tone: 'ok' })
  }

  if (picking)
    return (
      <Modal label="Выбор папки" busy={false}>
        <FolderPicker
          start={picking === 'parent' ? parent : folder || parent}
          sep={sep}
          onCancel={() => setPicking(null)}
          onPick={(dir) => {
            if (picking === 'parent') setParent(dir)
            else {
              setFolder(dir)
              if (!name.trim()) setName(baseName(dir))
            }
            setPicking(null)
          }}
        />
      </Modal>
    )

  return (
    <Modal label="Новый проект" busy={busy}>
      <MHead
        icon={mode === 'new' ? 'plus' : 'folder'}
        title={mode === 'new' ? 'Новый проект' : 'Открыть папку как проект'}
        sub="Проект — это настоящая папка на твоём диске: файлы, git и терминал работают прямо в ней."
      />
      <div className="field">
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as 'new' | 'open')}
          options={[
            { k: 'new', t: 'Создать новый' },
            { k: 'open', t: 'Открыть существующую папку' },
          ]}
        />
      </div>
      {!online && (
        <div className="diff-note">
          <Icon name="warn" size={14} />
          Сервер TetraFree не запущен. Он создаёт папку на диске — в десктопной сборке стартует сам, в
          браузере: <code>npm run server</code>.
        </div>
      )}
      {mode === 'new' ? (
        <>
          <div className={'field' + (nameErr ? ' bad' : '')}>
            <label htmlFor="np-name">Название</label>
            <input
              id="np-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ready && void create()}
              placeholder="my-app"
            />
            {nameErr ? (
              <div className="ferr">{nameErr}</div>
            ) : (
              s &&
              s !== name.trim() && (
                <div className="fhint">
                  Имя папки: <span className="mono">{s}</span>
                </div>
              )
            )}
          </div>
          <div className="field">
            <label htmlFor="np-parent">Где создать</label>
            <div className="pathrow">
              <div className="pathin">
                <Icon name="folder" size={14} />
                <input
                  id="np-parent"
                  className="mono"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  placeholder={info?.root || 'C:\\Users\\you\\projects'}
                  spellCheck={false}
                />
              </div>
              <button className="btn" disabled={!online} onClick={() => setPicking('parent')}>
                Обзор…
              </button>
            </div>
          </div>
          <div className="field">
            <label>Шаблон</label>
            <div className="tpls">
              {TEMPLATES.map((t) => (
                <button
                  key={t.k}
                  className={'tpl' + (tpl === t.k ? ' on' : '')}
                  aria-pressed={tpl === t.k}
                  onClick={() => setTpl(t.k)}
                >
                  <span className="tpl-i">
                    <Icon name={t.icon} size={18} />
                  </span>
                  <b>{t.k}</b>
                  <span>{t.d}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="np-folder">Папка</label>
            <div className="pathrow">
              <div className="pathin">
                <Icon name="folder" size={14} />
                <input
                  id="np-folder"
                  className="mono"
                  autoFocus
                  value={folder}
                  onChange={(e) => {
                    setFolder(e.target.value)
                    if (!name.trim() || name === slug(baseName(folder)))
                      setName(slug(baseName(e.target.value)))
                  }}
                  placeholder="C:\Users\you\work\my-app"
                  spellCheck={false}
                />
              </div>
              <button className="btn" disabled={!online} onClick={() => setPicking('folder')}>
                Обзор…
              </button>
            </div>
            <div className="fhint">
              Файлы папки читаются в проект как есть (текстовые, до 1 МБ каждый; node_modules, .git, dist и
              подобное пропускаются). Ничего не удаляется и не перезаписывается.
            </div>
          </div>
          <div className={'field' + (nameErr ? ' bad' : '')}>
            <label htmlFor="np-name2">Название проекта</label>
            <input
              id="np-name2"
              value={name || slug(baseName(folder))}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ready && void create()}
            />
          </div>
        </>
      )}
      {target && (
        <div className={'np-sum' + (err ? ' bad' : '')}>
          <Icon name={err ? 'warn' : 'info'} size={14} />
          <span>
            {err ? (
              <>
                {err}
                {nonEmpty && (
                  <>
                    {' '}
                    <button
                      className="linkbtn"
                      onClick={() => {
                        setFolder(target)
                        setMode('open')
                      }}
                    >
                      Открыть эту папку
                    </button>
                  </>
                )}
              </>
            ) : chk?.ok ? (
              <>
                {mode === 'new' ? 'Будет создана: ' : 'Откроется: '}
                <b className="mono">{chk.dir}</b>
                {mode === 'open' && chk.git ? ' · есть git' : ''}
                {mode === 'open' && !chk.entries ? ' · папка пуста' : ''}
              </>
            ) : (
              'Проверяю путь…'
            )}
          </span>
        </div>
      )}
      <div className="mfoot">
        <span className="grow" />
        <button className="btn gho" disabled={busy} onClick={() => st().closeModal()}>
          Отмена
        </button>
        <button className="btn pri" disabled={!ready} onClick={() => void create()}>
          {busy ? (
            <>
              <span className="bspin" />
              Читаю папку…
            </>
          ) : mode === 'new' ? (
            'Создать проект'
          ) : (
            'Открыть проект'
          )}
        </button>
      </div>
    </Modal>
  )
}

/* ---------- выбор папки на диске ---------- */
function FolderPicker({
  start,
  sep,
  onPick,
  onCancel,
}: {
  start: string
  sep: string
  onPick: (dir: string) => void
  onCancel: () => void
}) {
  const [cur, setCur] = useState(start)
  const [typed, setTyped] = useState(start)
  const [d, setD] = useState<DirInfo | null>(null)
  const [err, setErr] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let live = true
    setErr('')
    bBrowse(cur)
      .then((r) => {
        if (!live) return
        setD(r)
        setTyped(r.dir)
      })
      .catch((e) => {
        if (!live) return
        setErr((e as Error).message)
        setD(null)
      })
    return () => {
      live = false
    }
  }, [cur])
  /* путь ещё не существует: показываем ближайшую существующую папку выше */
  const up = d?.parent ?? (d && d.dir ? '' : null)
  const nearest = d && !d.exists ? parentOf(d.dir) : ''
  useEffect(() => {
    if (d && !d.exists && nearest && nearest !== d.dir) setCur(nearest)
  }, [d, nearest])
  const chosen = d?.dir || ''
  return (
    <>
      <MHead icon="folder" title="Выбери папку" sub="Нажми на папку, чтобы войти в неё." />
      <div className="field">
        <div className="pathrow">
          <button
            className="iconbtn"
            title="На уровень выше"
            aria-label="На уровень выше"
            disabled={up === null}
            onClick={() => up !== null && setCur(up)}
          >
            <Icon name="chevl" size={14} />
          </button>
          <div className="pathin">
            <Icon name="folder" size={14} />
            <input
              className="mono"
              aria-label="Путь"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setCur(typed.trim())}
              spellCheck={false}
            />
          </div>
          <button className="btn" onClick={() => setCur(typed.trim())}>
            Перейти
          </button>
        </div>
      </div>
      <div className="fpick" role="listbox" aria-label="Папки">
        {err && <div className="ferr">{err}</div>}
        {d && !d.dir && <div className="fhint">Начальные места</div>}
        {d?.dirs.map((x) => (
          <button
            key={x.path}
            role="option"
            aria-selected={false}
            className="fp-row"
            onClick={() => setCur(x.path)}
          >
            <Icon name="folder" size={14} />
            <span>{x.name}</span>
            <Icon name="chev" size={12} />
          </button>
        ))}
        {d && d.dir && !d.dirs.length && <div className="fhint">Подпапок нет</div>}
      </div>
      {adding ? (
        <div className="pathrow">
          <div className="pathin">
            <Icon name="plus" size={14} />
            <input
              autoFocus
              className="mono"
              aria-label="Имя новой папки"
              placeholder="имя новой папки"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim() && d?.dir) onPick(join(d.dir, newName.trim(), sep))
                if (e.key === 'Escape') setAdding(false)
              }}
            />
          </div>
          <button
            className="btn"
            disabled={!newName.trim() || !d?.dir}
            onClick={() => d?.dir && onPick(join(d.dir, newName.trim(), sep))}
          >
            Создать и выбрать
          </button>
        </div>
      ) : null}
      <div className="mfoot">
        <button className="btn gho" disabled={!d?.dir} onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          Новая папка
        </button>
        <span className="grow" />
        <button className="btn gho" onClick={onCancel}>
          Назад
        </button>
        <button className="btn pri" disabled={!chosen} onClick={() => onPick(chosen)}>
          Выбрать «{baseName(chosen) || chosen || '…'}»
        </button>
      </div>
    </>
  )
}

/* ---------- сменить папку существующего проекта ---------- */
export function ProjectFolderModal({ id }: { id: string }) {
  const st = useStore.getState
  const p = useStore((s) => s.projects.find((x) => x.id === id))
  const info = useBackend((b) => b.info)
  const [sel, setSel] = useState<string | null>(null)
  const [chk, setChk] = useState<FolderCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const taken = useStore((s) => s.projects.find((x) => x.id !== id && !!sel && x.path === sel))
  useEffect(() => {
    setChk(null)
    if (sel)
      bCheckFolder(sel)
        .then(setChk)
        .catch((e) => setChk({ ok: false, reason: (e as Error).message }))
  }, [sel])
  if (!p) return null
  if (!sel)
    return (
      <Modal label="Папка проекта" busy={false}>
        <FolderPicker
          start={p.path || info?.root || ''}
          sep={info?.sep || '/'}
          onCancel={() => st().closeModal()}
          onPick={setSel}
        />
      </Modal>
    )
  const err = taken
    ? `Эта папка уже занята проектом «${taken.name}»`
    : chk && !chk.ok
      ? chk.reason
      : sel === p.path
        ? 'Это та же папка'
        : ''
  const go = async () => {
    if (!chk?.dir || err) return
    setBusy(true)
    st().up((x) => {
      x.path = chk.dir!
    }, id)
    forgetBase(id)
    await reconcile(id, { quiet: true })
    toast({ title: 'Папка проекта изменена', desc: chk.dir, icon: 'folder', tone: 'ok' })
    st().closeModal()
  }
  return (
    <Modal label="Папка проекта" busy={busy}>
      <MHead
        icon="folder"
        title="Сменить папку проекта"
        sub="Файлы старой папки остаются на месте — приложение перестаёт с ней работать."
      />
      <div className="np-sum">
        <Icon name="info" size={14} />
        <span>
          Новая папка: <b className="mono">{sel}</b>
        </span>
      </div>
      {chk?.ok && !!chk.entries && !err && (
        <div className="diff-note">
          <Icon name="warn" size={14} />
          Здесь уже есть файлы ({chk.entries}). Файлы проекта с теми же именами будут <b>заменены</b> версиями
          из приложения, остальные — подтянутся в проект.
        </div>
      )}
      {err && <div className="ferr">{err}</div>}
      <div className="mfoot">
        <button className="btn gho" disabled={busy} onClick={() => setSel(null)}>
          Другая папка
        </button>
        <span className="grow" />
        <button className="btn pri" disabled={busy || !chk?.ok || !!err} onClick={() => void go()}>
          {busy ? 'Переношу…' : 'Использовать эту папку'}
        </button>
      </div>
    </Modal>
  )
}
