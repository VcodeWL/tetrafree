import { useEffect, useMemo, useRef, useState } from 'react'
import { rowKeys } from '../lib/a11y'
import { opsFor, type Op } from '../lib/opstack'
import { useStore, useProject } from '../store'
import { Icon, type IconName } from '../components/ui/Icon'
import { Menu, MenuHead, MenuItem, MenuSep, useMenu } from '../components/ui/Menu'
import { HLine } from '../components/ui/Code'
import { tokenize } from '../lib/highlight'
import { ago, clamp, copyText, download, langOf, fmtBytes, plural } from '../lib/util'
import { openExternal, isDesktop } from '../lib/desktop'
import { useEditors, loadEditors, pickEditor, openInEditor } from '../lib/editors'
import type { Project } from '../types'
import { checkPath, PROTECTED } from '../lib/paths'
import { useLiveInProject } from '../agent/live'
import { CodeSurface, MAX_EDIT } from './CodeEditor'
import { hasMarkers, resolveMarkers } from '../lib/merge3'
import { reportCaret, usePeers } from '../lib/team'
import { GitPane } from './GitPane'
import { useGit, refreshGit } from '../lib/git'
import { useBackend, joinPath, bReveal, type GitFile } from '../lib/backend'

export function RightPane() {
  const tab = useStore((s) => s.rightTab)
  const st = useStore.getState
  const gitN = useGit((g) => g.status?.files.length ?? 0)
  const gitOn = useBackend((b) => b.status === 'online' && !!b.info?.git)
  const pid = useStore((s) => s.projectId)
  useEffect(() => {
    if (gitOn && pid) {
      void refreshGit({ quiet: true })
      const t = setInterval(() => {
        if (!document.hidden) void refreshGit({ quiet: true })
      }, 15000)
      return () => clearInterval(t)
    }
  }, [gitOn, pid])
  const segRef = useRef<HTMLDivElement>(null)
  const [line, setLine] = useState({ x: 0, w: 0 })
  useEffect(() => {
    const el = segRef.current?.querySelector<HTMLElement>('.rtab.on')
    if (el) setLine({ x: el.offsetLeft, w: el.offsetWidth })
  }, [tab])
  return (
    <section className="pane-right">
      <Splitter />
      <div className="rtabs">
        <div className="rseg" ref={segRef}>
          <button
            className={'rtab' + (tab === 'code' ? ' on' : '')}
            onClick={() => st().setRight({ rightTab: 'code' })}
          >
            <Icon name="code" size={14} />
            Код
          </button>
          <button
            className={'rtab' + (tab === 'browser' ? ' on' : '')}
            onClick={() => st().setRight({ rightTab: 'browser' })}
          >
            <Icon name="browser" size={14} />
            Браузер
          </button>
          <button
            className={'rtab' + (tab === 'git' ? ' on' : '')}
            onClick={() => st().setRight({ rightTab: 'git' })}
          >
            <Icon name="git" size={14} />
            Git{gitN > 0 && <span className="rbadge">{gitN}</span>}
          </button>
          <span className="rline" style={{ transform: `translateX(${line.x}px)`, width: line.w }} />
        </div>
        <div className="grow" />
        <button
          className="iconbtn"
          title="Найти файл (Ctrl+P)"
          onClick={() => window.dispatchEvent(new CustomEvent('tf:palette', { detail: '/' }))}
        >
          <Icon name="search" size={15} />
        </button>
        <button className="btn sm depl-btn" onClick={() => st().openModal({ type: 'deploy' })}>
          <Icon name="rocket" size={13} />
          Деплой
        </button>
      </div>
      <div className="rpane">
        {tab === 'code' ? <CodePane /> : tab === 'git' ? <GitPane /> : <BrowserPane />}
      </div>
    </section>
  )
}

function Splitter() {
  const set = useStore((s) => s.setRightWidth)
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      title="Потяни, чтобы изменить ширину · двойной клик — сбросить"
      onDoubleClick={() => set(45)}
      onPointerDown={(e) => {
        const host = (e.currentTarget.closest('.split') as HTMLElement).getBoundingClientRect()
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
        const move = (ev: PointerEvent) =>
          set(Math.round(clamp(((host.right - ev.clientX) / host.width) * 100, 26, 68)))
        const upH = () => {
          document.body.classList.remove('resizing')
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', upH)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', upH)
      }}
    />
  )
}

interface TNode {
  name: string
  path: string
  dir: boolean
  children: TNode[]
}
function buildTree(p: Project, extra: string[] = []): TNode[] {
  const root: TNode = { name: '', path: '', dir: true, children: [] }
  const ensure = (path: string) => {
    let cur = root
    path.split('/').forEach((part, i, arr) => {
      const pp = arr.slice(0, i + 1).join('/')
      let n = cur.children.find((c) => c.name === part && c.dir)
      if (!n) {
        n = { name: part, path: pp, dir: true, children: [] }
        cur.children.push(n)
      }
      cur = n
    })
    return cur
  }
  p.dirs.forEach((d) => ensure(d))
  const all = Array.from(new Set([...Object.keys(p.files), ...extra]))
  all.forEach((f) => {
    const parts = f.split('/')
    const name = parts.pop()!
    const parent = parts.length ? ensure(parts.join('/')) : root
    parent.children.push({ name, path: f, dir: false, children: [] })
  })
  const sort = (n: TNode) => {
    n.children.sort(
      (a, b) =>
        Number(b.dir) - Number(a.dir) ||
        Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) ||
        a.name.localeCompare(b.name),
    )
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}
const fileIcon = (f: string): IconName =>
  /\.(md)$/.test(f)
    ? 'doc'
    : /\.ya?ml$/.test(f)
      ? 'gear'
      : /\.html$/.test(f)
        ? 'browser'
        : /\.py$/.test(f)
          ? 'py'
          : /\.sql$/.test(f)
            ? 'db'
            : 'file'

function CodePane() {
  const p = useProject()!
  const active = useStore((s) => s.activeFile)
  const closed = useStore((s) => s.closedDirs)
  const st = useStore.getState
  const liveFiles = useLiveInProject(p.id)
  const follow = useStore((s) => s.settings.followAgent !== false)
  const liveMap = useMemo(() => Object.fromEntries(liveFiles.map((f) => [f.path, f])), [liveFiles])
  const liveNew = liveFiles
    .filter((f) => !(f.path in p.files))
    .map((f) => f.path)
    .join('|')
  const tree = useMemo(() => buildTree(p, liveNew ? liveNew.split('|') : []), [p.files, p.dirs, liveNew]) // eslint-disable-line react-hooks/exhaustive-deps
  const fm = useMenu<string>()
  const dm = useMenu<string>()
  const [q, setQ] = useState('')
  useEffect(() => {
    setQ('')
  }, [p.id])
  const om = useMenu()
  const editors = useEditors((x) => x.list)
  const defEditor = useStore((x) => x.settings.editor)
  const file = active && (active in p.files || active in liveMap) ? active : null
  const lv = file ? liveMap[file] : undefined
  const content = lv ? lv.text : file ? (p.files[file] ?? '') : ''
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (el && lv) el.scrollTop = el.scrollHeight
  }, [lv?.text.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const lang = file ? langOf(file) : 'ts'
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setEditing(false)
    reportCaret(file || '', 0)
  }, [file])
  const canEdit = !!file && !lv && content.length <= MAX_EDIT
  /* узкая панель: дерево прячется в выезжающий список, широкая: дерево тянется за ручку */
  const wrap = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [tw, setTw] = useState(() => Math.min(320, Math.max(150, +(localStorage.getItem('tf.treeW') || 200))))
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 560))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dragTree = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX,
      w0 = tw
    let w = w0
    const mv = (m: PointerEvent) => {
      w = Math.min(320, Math.max(150, w0 + m.clientX - x0))
      setTw(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem('tf.treeW', String(w))
      } catch {
        /* хранилище недоступно */
      }
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }
  const showTree = !narrow || treeOpen || !file
  /* вкладки открытых файлов (на проект) */
  const [tabs, setTabs] = useState<string[]>([])
  const [pins, setPins] = useState<string[]>([])
  const skipSave = useRef(true)
  /* открытые и закреплённые вкладки переживают перезапуск (на проект) */
  useEffect(() => {
    let t: string[] = [],
      pn: string[] = []
    try {
      const raw = JSON.parse(localStorage.getItem('tf.tabs:' + p.id) || 'null')
      if (raw) {
        t = (raw.tabs || []).filter((f: unknown) => typeof f === 'string' && f in p.files).slice(0, 12)
        pn = (raw.pins || []).filter((f: string) => t.includes(f))
      }
    } catch {
      /* битая запись — начинаем с нуля */
    }
    skipSave.current = true
    setTabs(t)
    setPins(pn)
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    try {
      localStorage.setItem(
        'tf.tabs:' + p.id,
        JSON.stringify({ tabs, pins: pins.filter((f) => tabs.includes(f)) }),
      )
    } catch {
      /* квота */
    }
  }, [tabs, pins]) // eslint-disable-line react-hooks/exhaustive-deps
  const togglePin = (f: string) => {
    const on = pins.includes(f)
    const np = on ? pins.filter((x) => x !== f) : [...pins, f]
    setPins(np)
    setTabs((t) => {
      const rest = t.filter((x) => x !== f)
      const pinned = rest.filter((x) => np.includes(x))
      const others = rest.filter((x) => !np.includes(x))
      return [...pinned, f, ...others]
    })
  }
  useEffect(() => {
    if (file) setTabs((t) => (t.includes(file) ? t : [...t, file].slice(-8)))
  }, [file])
  const nFiles = Object.keys(p.files).length
  useEffect(() => {
    setTabs((t) => {
      const n = t.filter((f) => f in p.files)
      return n.length === t.length ? t : n
    })
  }, [nFiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeTab = (f: string) => {
    if (pins.includes(f)) return
    const i = tabs.indexOf(f)
    const rest = tabs.filter((x) => x !== f)
    setTabs(rest)
    if (f === file && rest.length) st().openFile(rest[Math.min(i, rest.length - 1)])
  }
  const tm = useMenu<string>()
  const [dragTab, setDragTab] = useState<string | null>(null)
  const moveTab = (from: string, to: string) =>
    setTabs((t) => {
      if (from === to) return t
      const n = t.filter((x) => x !== from)
      n.splice(n.indexOf(to) + (t.indexOf(from) < t.indexOf(to) ? 1 : 0), 0, from)
      return n
    })
  /* Ctrl+W — закрыть вкладку; Alt+←/→ — соседняя вкладка (не мешаем полям ввода и терминалу) */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!file || tabs.length < 2 || st().modal || st().palette) return
      if ((e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable],.xterm')) return
      const i = tabs.indexOf(file)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        closeTab(file)
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        st().openFile(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  const peers = usePeers((x) => x.by[p.id])
  const inFile = (peers || []).filter((q) => q.file === file && Date.now() - q.at < 60_000)
  const lines = content.split('\n')
  const last = p.versions[p.versions.length - 1]
  const changed = !lv && file && last && last.snapshot[file] !== undefined && last.snapshot[file] !== content
  const lastTouch = file
    ? [...p.versions].reverse().find((v, i, arr) => v.snapshot[file] !== arr[i + 1]?.snapshot[file])
    : undefined

  const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
  const guard = (path: string, what: string) => {
    if (PROTECTED.includes(path)) {
      st().toast({
        title: 'Файл защищён',
        desc: `${path}: ${what} — через «Окружение проекта»`,
        tone: 'err',
        icon: 'warn',
      })
      return false
    }
    return true
  }
  /* ---- история файловых операций: Ctrl+Z / Ctrl+Shift+Z в дереве ---- */
  const stack = opsFor(p.id)
  const retab = (from: string, to: string) =>
    setTabs((t) => t.map((x) => (x === from ? to : x.startsWith(from + '/') ? to + x.slice(from.length) : x)))
  /** перед отменой/повтором убеждаемся, что целевой путь не занят чужим файлом */
  const assertFree = (paths: string[]) => {
    const cur = useStore.getState().projects.find((q) => q.id === p.id)
    const busy = paths.find((x) => cur && (x in cur.files || cur.dirs.includes(x)))
    if (busy) throw new Error(`Путь «${busy}» уже занят`)
  }
  const doneToast = (op: Op, title: string, desc: string, icon: 'edit' | 'folder' | 'trash' | 'plus') => {
    stack.push(op)
    st().toast({
      title,
      desc,
      icon,
      action: {
        label: 'Отменить',
        run: () => {
          if (st().projectId !== p.id) return
          try {
            stack.undoOp(op)
          } catch (e) {
            st().toast({
              title: 'Не удалось отменить',
              desc: (e as Error).message,
              icon: 'warn',
              tone: 'err',
            })
          }
        },
      },
    })
  }
  const history = (kind: 'undo' | 'redo') => {
    try {
      const op = stack[kind]()
      st().toast(
        op
          ? {
              title: (kind === 'undo' ? 'Отменено: ' : 'Повторено: ') + op.label,
              icon: kind === 'undo' ? 'undo' : 'redo',
            }
          : { title: kind === 'undo' ? 'Нечего отменять' : 'Нечего повторять', icon: 'info' },
      )
    } catch (e) {
      st().toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'err' })
    }
  }
  const newAt = (dir: string, kind: 'file' | 'dir') =>
    st().openModal({
      type: 'rename',
      title: kind === 'file' ? 'Новый файл' : 'Новая папка',
      value: dir ? dir + '/' : '',
      label: 'Создать',
      hint: dir ? `в «${dir}»` : 'в корне проекта',
      check: (v) => checkPath(p, v),
      run: (v) => {
        if (kind === 'dir') {
          st().addDir(v)
          doneToast(
            {
              label: `папка «${v}» создана`,
              undo: () => st().deletePath(v),
              redo: () => {
                assertFree([v])
                st().addDir(v)
              },
            },
            'Папка создана',
            v,
            'folder',
          )
        } else {
          st().writeFile(v, '')
          st().openFile(v)
          setEditing(true)
          stack.push({
            label: `файл «${v}» создан`,
            undo: () => st().deletePath(v),
            redo: () => {
              assertFree([v])
              st().writeFile(v, '')
            },
          })
        }
      },
    })
  const renameAt = (path: string, isDir: boolean) => {
    if (!guard(path, 'переименование')) return
    st().openModal({
      type: 'rename',
      title: isDir ? 'Переименовать папку' : 'Переименовать файл',
      value: path,
      label: 'Переименовать',
      hint: 'Можно указать новый путь целиком, это переместит файл',
      check: (v) => checkPath(p, v, path),
      run: (v) => {
        st().renamePath(path, v)
        retab(path, v)
        doneToast(
          {
            label: `«${path}» → «${v}»`,
            undo: () => {
              assertFree([path])
              st().renamePath(v, path)
              retab(v, path)
            },
            redo: () => {
              assertFree([v])
              st().renamePath(path, v)
              retab(path, v)
            },
          },
          'Переименовано',
          v,
          'edit',
        )
      },
    })
  }
  const removeAt = (path: string, isDir: boolean) => {
    if (!guard(path, 'удаление')) return
    const n = isDir ? Object.keys(p.files).filter((f) => f.startsWith(path + '/')).length : 0
    st().openModal({
      type: 'confirm',
      danger: true,
      confirm: 'Удалить',
      title: isDir ? `Удалить папку «${path.split('/').pop()}»?` : `Удалить «${path.split('/').pop()}»?`,
      body: isDir
        ? n
          ? `Вместе с ${n} ${plural(n, ['файлом', 'файлами', 'файлами'])}. Удалённое 30 дней лежит в корзине (Ctrl+K → «Корзина»).`
          : 'Папка пуста.'
        : 'Вернуть можно из истории версий, если файл уже попадал в версию.',
      run: () => {
        const snap = Object.fromEntries(
          Object.entries(p.files).filter(([f]) => f === path || f.startsWith(path + '/')),
        )
        const dirs = p.dirs.filter((d) => d === path || d.startsWith(path + '/'))
        const pid = p.id
        st().deletePath(path)
        doneToast(
          {
            label: `«${path}» удалён`,
            undo: () => {
              assertFree([...Object.keys(snap), ...dirs])
              Object.entries(snap).forEach(([f, c]) => st().writeFile(f, c, pid))
              dirs.forEach((d) => st().addDir(d))
            },
            redo: () => st().deletePath(path),
          },
          'Удалено',
          path,
          'trash',
        )
      },
    })
  }
  const [dragNode, setDragNode] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const moveInto = (src: string, dir: string) => {
    const to = (dir ? dir + '/' : '') + src.split('/').pop()
    if (to === src || !guard(src, 'перемещение')) return
    const err = checkPath(p, to, src)
    if (err) {
      st().toast({ title: 'Не удалось переместить', desc: err, icon: 'warn', tone: 'err' })
      return
    }
    st().renamePath(src, to)
    retab(src, to)
    doneToast(
      {
        label: `«${src}» перемещён в «${to}»`,
        undo: () => {
          assertFree([src])
          st().renamePath(to, src)
          retab(to, src)
        },
        redo: () => {
          assertFree([to])
          st().renamePath(src, to)
          retab(src, to)
        },
      },
      'Перемещено',
      to,
      'folder',
    )
  }
  const allDirs = useMemo(() => Array.from(new Set(p.dirs)), [p.dirs])
  const collapseAll = () =>
    useStore.setState((s) => {
      const c = { ...s.closedDirs }
      allDirs.forEach((d) => {
        c[p.id + ':' + d] = true
      })
      return { closedDirs: c }
    })
  const expandAll = () =>
    useStore.setState((s) => {
      const c = { ...s.closedDirs }
      allDirs.forEach((d) => {
        c[p.id + ':' + d] = false
      })
      return { closedDirs: c }
    })
  const ql = q.trim().toLowerCase()
  const hits = ql
    ? Object.keys(p.files)
        .filter((f) => f.toLowerCase().includes(ql))
        .sort(
          (a, b) =>
            a.split('/').pop()!.toLowerCase().indexOf(ql) - b.split('/').pop()!.toLowerCase().indexOf(ql) ||
            a.localeCompare(b),
        )
        .slice(0, 200)
    : []

  const gst = useGit((g) => (g.pid === p.id ? g.status : null))
  const gmap = useMemo(() => {
    const m: Record<string, GitFile['kind']> = {}
    gst?.files.forEach((f) => {
      m[f.path] = f.kind
    })
    return m
  }, [gst])
  const gdirs = useMemo(() => {
    const d = new Set<string>()
    Object.keys(gmap).forEach((f) => {
      const seg = f.split('/')
      seg.pop()
      for (let i = 1; i <= seg.length; i++) d.add(seg.slice(0, i).join('/'))
    })
    return d
  }, [gmap])
  const GL = { new: 'A', mod: 'M', del: 'D', ren: 'R', conflict: '!' } as const
  const render = (nodes: TNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const isClosed = closed[p.id + ':' + n.path] ?? n.name.startsWith('.')
      return n.dir ? (
        <div key={n.path}>
          <div
            className={'tnode' + (isClosed ? '' : ' open')}
            style={{ paddingLeft: 8 + depth * 12 }}
            role="button"
            tabIndex={0}
            aria-expanded={!isClosed}
            aria-label={'Папка ' + n.name}
            onKeyDown={rowKeys(
              {
                open: () =>
                  useStore.setState((s) => ({
                    closedDirs: { ...s.closedDirs, [p.id + ':' + n.path]: !isClosed },
                  })),
                rename: () => renameAt(n.path, true),
                remove: () => removeAt(n.path, true),
              },
              '.tree-col .tnode',
            )}
            onContextMenu={(e) => dm.at(e, n.path)}
            draggable
            onDragStart={(e) => {
              setDragNode(n.path)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', n.path)
            }}
            onDragEnd={() => {
              setDragNode(null)
              setDropDir(null)
            }}
            onDragOver={(e) => {
              if (dragNode && dragNode !== n.path && !n.path.startsWith(dragNode + '/')) {
                e.preventDefault()
                setDropDir(n.path)
              }
            }}
            onDragLeave={() => setDropDir((d) => (d === n.path ? null : d))}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (dragNode) moveInto(dragNode, n.path)
              setDragNode(null)
              setDropDir(null)
            }}
            data-drop={dropDir === n.path ? '1' : undefined}
            onClick={() =>
              useStore.setState((s) => ({
                closedDirs: { ...s.closedDirs, [p.id + ':' + n.path]: !isClosed },
              }))
            }
          >
            <span className="tw">
              <Icon name="chev" size={11} />
            </span>
            <span className="fi">
              <Icon name="folder" size={14} />
            </span>
            {n.name}
            {isClosed && gdirs.has(n.path) && <i className="tdot" title="Внутри есть изменения git" />}
          </div>
          {!isClosed && render(n.children, depth + 1)}
        </div>
      ) : (
        <div
          key={n.path}
          className={'tnode' + (n.path === file ? ' on' : '')}
          style={{ paddingLeft: 20 + depth * 12 }}
          role="button"
          tabIndex={0}
          aria-current={n.path === file ? 'true' : undefined}
          aria-label={'Файл ' + n.name}
          onKeyDown={rowKeys(
            {
              open: () => {
                st().openFile(n.path)
                setTreeOpen(false)
              },
              rename: () => renameAt(n.path, false),
              remove: () => removeAt(n.path, false),
            },
            '.tree-col .tnode',
          )}
          onClick={() => {
            st().openFile(n.path)
            setTreeOpen(false)
          }}
          onContextMenu={(e) => fm.at(e, n.path)}
          title={n.path}
          draggable
          onDragStart={(e) => {
            setDragNode(n.path)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', n.path)
          }}
          onDragEnd={() => {
            setDragNode(null)
            setDropDir(null)
          }}
        >
          <span className="fi">
            <Icon name={fileIcon(n.name)} size={14} />
          </span>
          <span className="tn">{n.name}</span>
          {liveMap[n.path] && (
            <i className={'tlive ' + liveMap[n.path].op} title={liveMap[n.path].agent + ' пишет'} />
          )}
          {gmap[n.path] && (
            <i className={'tgit k-' + gmap[n.path]} title="Изменён относительно последнего коммита">
              {GL[gmap[n.path]]}
            </i>
          )}
        </div>
      )
    })

  return (
    <div className={'cp' + (narrow ? ' narrow' : '')} ref={wrap}>
      {showTree && (
        <div
          className="tree-col"
          tabIndex={-1}
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).tagName === 'INPUT' || !(e.ctrlKey || e.metaKey)) return
            if (e.code !== 'KeyZ' && e.code !== 'KeyY') return
            e.preventDefault()
            history(e.code === 'KeyZ' && !e.shiftKey ? 'undo' : 'redo')
          }}
          style={narrow ? undefined : { width: tw }}
          onDragOver={(e) => {
            if (dragNode) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragNode) moveInto(dragNode, '')
            setDragNode(null)
            setDropDir(null)
          }}
        >
          <label className="tfilter">
            <Icon name="search" size={12} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.stopPropagation()
                  setQ('')
                } else if (e.key === 'Enter' && hits[0]) {
                  st().openFile(hits[0])
                  setTreeOpen(false)
                }
              }}
              placeholder="Фильтр файлов"
              aria-label="Фильтр файлов"
            />
          </label>
          <div className="tree-tools">
            <span className="tt-l">Файлы · {nFiles}</span>
            <button
              className="iconbtn sm"
              title="Новый файл"
              aria-label="Новый файл"
              onClick={() => newAt(file ? parentOf(file) : '', 'file')}
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              className="iconbtn sm"
              title="Новая папка"
              aria-label="Новая папка"
              onClick={() => newAt('', 'dir')}
            >
              <Icon name="folder" size={14} />
            </button>
            <button
              className="iconbtn sm"
              title="Свернуть все папки"
              aria-label="Свернуть все папки"
              onClick={collapseAll}
            >
              <Icon name="chev" size={13} style={{ transform: 'rotate(-90deg)' }} />
            </button>
            <button
              className="iconbtn sm"
              title="Развернуть все папки"
              aria-label="Развернуть все папки"
              onClick={expandAll}
            >
              <Icon name="chev" size={13} style={{ transform: 'rotate(90deg)' }} />
            </button>
          </div>
          {ql ? (
            hits.length ? (
              hits.map((f) => (
                <div
                  key={f}
                  className={'tnode' + (f === file ? ' on' : '')}
                  role="button"
                  tabIndex={0}
                  aria-label={'Файл ' + f}
                  onKeyDown={rowKeys(
                    {
                      open: () => {
                        st().openFile(f)
                        setTreeOpen(false)
                      },
                    },
                    '.tree-col .tnode',
                  )}
                  onClick={() => {
                    st().openFile(f)
                    setTreeOpen(false)
                  }}
                  onContextMenu={(e) => fm.at(e, f)}
                  title={f}
                >
                  <span className="fi">
                    <Icon name={fileIcon(f.split('/').pop()!)} size={14} />
                  </span>
                  <span className="tn">{f.split('/').pop()}</span>
                  <span className="tdir">{parentOf(f)}</span>
                </div>
              ))
            ) : (
              <div className="tempty">Ничего не найдено</div>
            )
          ) : (
            render(tree, 0)
          )}
        </div>
      )}
      {!narrow && (
        <div
          className="tree-grip"
          onPointerDown={dragTree}
          onDoubleClick={() => {
            setTw(200)
            localStorage.removeItem('tf.treeW')
          }}
          role="separator"
          aria-orientation="vertical"
          title="Потяни, чтобы изменить ширину · двойной клик — сбросить"
        />
      )}
      {narrow && treeOpen && file && (
        <div className="tree-scrim" aria-hidden="true" onClick={() => setTreeOpen(false)} />
      )}
      <div className="code-view">
        {file ? (
          <>
            {tabs.length > 1 && (
              <div className="ftabs" role="group" aria-label="Открытые файлы">
                {tabs.map((f) => (
                  <div
                    key={f}
                    aria-current={f === file ? 'true' : undefined}
                    tabIndex={0}
                    className={'ftab' + (f === file ? ' on' : '')}
                    title={f}
                    onClick={() => st().openFile(f)}
                    draggable
                    onDragStart={(e) => {
                      setDragTab(f)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', f)
                    }}
                    onDragOver={(e) => {
                      if (dragTab) e.preventDefault()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragTab) moveTab(dragTab, f)
                      setDragTab(null)
                    }}
                    onDragEnd={() => setDragTab(null)}
                    onContextMenu={(e) => tm.at(e, f)}
                    onAuxClick={(e) => {
                      if (e.button === 1) closeTab(f)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') st().openFile(f)
                    }}
                  >
                    <Icon name={fileIcon(f.split('/').pop()!)} size={12} />
                    <span>{f.split('/').pop()}</span>
                    {pins.includes(f) ? (
                      <button
                        className="ftx pinned"
                        aria-label={'Открепить ' + f}
                        title="Открепить"
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(f)
                        }}
                      >
                        <Icon name="pin" size={11} />
                      </button>
                    ) : (
                      <button
                        className="ftx"
                        aria-label={'Закрыть ' + f}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(f)
                        }}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="cv-head">
              {narrow && (
                <button
                  className={'iconbtn sm' + (treeOpen ? ' on' : '')}
                  title="Файлы проекта"
                  aria-pressed={treeOpen}
                  onClick={() => setTreeOpen(!treeOpen)}
                >
                  <Icon name="folder" size={14} />
                </button>
              )}
              <span className="fp" title={file}>
                <bdi>{file}</bdi>
              </span>
              {lv && (
                <span className="chip sm livechip">
                  <i />
                  {lv.agent} {lv.op === 'create' ? 'создаёт' : 'правит'}
                </span>
              )}
              {changed && <span className="chip sm">не в версии</span>}
              {!lv && hasMarkers(content) && (
                <span
                  className="chip sm warn conflictchip"
                  title="Правки с коллегой пересеклись в одной строке. Пока маркеры не убраны, файл не уходит в облако."
                >
                  <Icon name="warn" size={11} />
                  конфликт
                  {(['ours', 'theirs', 'both'] as const).map((m) => (
                    <button
                      key={m}
                      className="linkbtn"
                      onClick={() => st().writeFile(file, resolveMarkers(content, m), p.id)}
                    >
                      {m === 'ours' ? 'мои' : m === 'theirs' ? 'чужие' : 'обе'}
                    </button>
                  ))}
                </span>
              )}
              {inFile.map((q) => (
                <span
                  key={q.uid}
                  className="chip sm peerchip"
                  style={{ ['--ph' as string]: q.hue }}
                  title={q.line ? `${q.name} — строка ${q.line}` : q.name + ' смотрит этот файл'}
                >
                  <i />
                  {q.name.split(' ')[0]}
                  {q.line ? ' · ' + q.line : ''}
                </span>
              ))}
              <span className="grow" />
              {changed && (
                <button
                  className="btn sm"
                  title="Зафиксировать правки как версию"
                  onClick={() => {
                    st().commit(
                      {
                        title: `Правка вручную: ${file}`,
                        by: 'human',
                        author: st().people.me.name,
                        tag: 'build',
                        feats: [],
                        changes: ['Изменён ' + file],
                        fixes: [],
                        details: [],
                      },
                      p.id,
                    )
                    st().toast({ title: 'Версия создана', desc: file, icon: 'check', tone: 'ok' })
                  }}
                >
                  <Icon name="check" size={13} />В версию
                </button>
              )}
              {canEdit && (
                <button
                  className={'btn sm' + (editing ? ' on' : '')}
                  aria-pressed={editing}
                  title={editing ? 'Закончить правку (Esc)' : 'Править файл'}
                  onClick={() => setEditing(!editing)}
                >
                  <Icon name="edit" size={13} />
                  {editing ? 'Готово' : 'Править'}
                </button>
              )}
              <button
                className={'iconbtn sm' + (follow ? ' on' : '')}
                title={
                  follow
                    ? 'Следить за агентом: включено — файлы открываются по мере записи'
                    : 'Следить за агентом: выключено'
                }
                onClick={() => st().setSetting('followAgent', !follow)}
              >
                <Icon name="eye" size={14} />
              </button>
              <span className="t4 cvmeta">
                {lines.length} стр · {fmtBytes(new Blob([content]).size)}
                {lastTouch ? ` · v${lastTouch.n}` : ''}
              </span>
              <button
                className="iconbtn sm"
                title="Скопировать"
                onClick={() => {
                  copyText(content)
                  st().toast({ title: 'Скопировано', desc: file, icon: 'copy' })
                }}
              >
                <Icon name="copy" size={14} />
              </button>
              <button
                className="iconbtn sm"
                title="Скачать"
                onClick={() => download(file.split('/').pop()!, content)}
              >
                <Icon name="down" size={14} />
              </button>
              <button
                className="btn sm ext"
                title="Открыть во внешнем редакторе"
                onClick={(e) => {
                  void loadEditors()
                  om.open(e)
                }}
              >
                <Icon name="external" size={13} />
                <span>Открыть в…</span>
              </button>
            </div>
            <div className="code-body" ref={bodyRef}>
              {lv ? (
                <>
                  <div className="gutter">
                    {lines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <pre>
                    {lines.map((l, i) =>
                      i === lines.length - 1 ? (
                        <span key={i}>
                          {tokenize(l, lang).map((t, k) =>
                            t.c ? (
                              <span key={k} className={'tok-' + t.c}>
                                {t.t}
                              </span>
                            ) : (
                              t.t
                            ),
                          )}
                          <i className="tcaret" />
                          {'\n'}
                        </span>
                      ) : (
                        <HLine key={i} line={l} lang={lang} />
                      ),
                    )}
                  </pre>
                </>
              ) : (
                <CodeSurface
                  key={file}
                  p={p}
                  file={file}
                  lang={lang}
                  content={content}
                  editing={editing && canEdit}
                />
              )}
            </div>
            <div className="cv-foot">
              <Icon name="info" size={13} />
              {lv
                ? `${lv.agent} пишет прямо сейчас — файл применится, когда агент закончит.`
                : editing
                  ? 'Tab — отступ · Ctrl+/ — комментарий · Ctrl+S — сохранить · Esc — выйти'
                  : content.length > MAX_EDIT
                    ? 'Файл больше 400 КБ — открыт только для чтения.'
                    : '«Править» — изменить файл. Клик по номеру строки — комментарий.'}
            </div>
          </>
        ) : (
          <div className="empty-pane">
            <div>
              <Icon name="file" size={22} />
              <p>Выбери файл слева</p>
            </div>
          </div>
        )}
      </div>
      {tm.st && (
        <Menu anchor={tm.st.anchor} onClose={tm.close}>
          <MenuItem
            icon="pin"
            label={pins.includes(tm.st.data) ? 'Открепить' : 'Закрепить'}
            onClick={() => {
              togglePin(tm.st!.data)
              tm.close()
            }}
          />
          <MenuItem
            icon="x"
            label="Закрыть"
            disabled={pins.includes(tm.st.data)}
            onClick={() => {
              closeTab(tm.st!.data)
              tm.close()
            }}
          />
          <MenuItem
            icon="x"
            label="Закрыть остальные"
            onClick={() => {
              const f = tm.st!.data
              setTabs(tabs.filter((x) => x === f || pins.includes(x)))
              st().openFile(f)
              tm.close()
            }}
          />
          <MenuItem
            icon="chev"
            label="Закрыть справа"
            onClick={() => {
              const f = tm.st!.data
              const i = tabs.indexOf(f)
              setTabs(tabs.slice(0, i + 1))
              if (tabs.indexOf(file!) > i) st().openFile(f)
              tm.close()
            }}
          />
          <MenuSep />
          <MenuItem
            icon="copy"
            label="Копировать путь"
            onClick={() => {
              copyText(tm.st!.data)
              tm.close()
            }}
          />
        </Menu>
      )}
      {dm.st && (
        <Menu anchor={dm.st.anchor} onClose={dm.close}>
          <MenuItem
            icon="plus"
            label="Новый файл здесь"
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              newAt(d, 'file')
            }}
          />
          <MenuItem
            icon="folder"
            label="Новая папка здесь"
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              newAt(d, 'dir')
            }}
          />
          <MenuSep />
          <MenuItem
            icon="edit"
            label="Переименовать"
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              renameAt(d, true)
            }}
          />
          <MenuItem
            icon="trash"
            label="Удалить папку"
            onClick={() => {
              const d = dm.st!.data
              dm.close()
              removeAt(d, true)
            }}
          />
          <MenuSep />
          <MenuItem
            icon="copy"
            label="Копировать путь"
            onClick={() => {
              copyText(dm.st!.data)
              dm.close()
            }}
          />
        </Menu>
      )}
      {fm.st && (
        <Menu anchor={fm.st.anchor} onClose={fm.close}>
          <MenuItem
            icon="layers"
            label="Сравнить с…"
            onClick={() => {
              st().openModal({ type: 'compare', a: fm.st!.data })
              fm.close()
            }}
          />
          <MenuItem
            icon="down"
            label="Скачать"
            onClick={() => {
              download(fm.st!.data.split('/').pop()!, p.files[fm.st!.data])
              fm.close()
            }}
          />
          <MenuItem
            icon="copy"
            label="Копировать путь"
            onClick={() => {
              copyText(fm.st!.data)
              fm.close()
            }}
          />
          <MenuItem
            icon="clock"
            label="История версий"
            onClick={() => {
              fm.close()
              st().openModal({ type: 'versions' })
            }}
          />
          <MenuSep />
          <MenuItem
            icon="edit"
            label="Переименовать"
            onClick={() => {
              const f = fm.st!.data
              fm.close()
              renameAt(f, false)
            }}
          />
          <MenuItem
            icon="trash"
            label="Удалить"
            onClick={() => {
              const f = fm.st!.data
              fm.close()
              removeAt(f, false)
            }}
          />
          <MenuSep />
          <MenuItem
            icon="chat"
            label="Попросить агента изменить"
            onClick={() => {
              const f = fm.st!.data
              fm.close()
              askAgent(`Посмотри \`${f}\` и `)
            }}
          />
        </Menu>
      )}
      {om.st && file && (
        <Menu anchor={om.st.anchor} onClose={om.close} place="bottom-end">
          <MenuHead>Внешний редактор</MenuHead>
          {editors.length ? (
            editors.map((e) => (
              <MenuItem
                key={e.id}
                icon="code"
                label={e.name}
                right={e.id === (pickEditor(editors, defEditor)?.id ?? '') ? 'по умолчанию' : undefined}
                onClick={() => {
                  om.close()
                  st().setSetting('editor', e.id)
                  void openInEditor(p.id, { file, editor: e.id })
                }}
              />
            ))
          ) : (
            <>
              <MenuItem
                icon="code"
                label="VS Code"
                onClick={() => {
                  openExternal('vscode://file/' + joinPath(p.path, file).replace(/\\/g, '/'))
                  om.close()
                }}
              />
              <MenuItem
                icon="bolt"
                label="Zed"
                onClick={() => {
                  openExternal('zed://file/' + joinPath(p.path, file).replace(/\\/g, '/'))
                  om.close()
                }}
              />
            </>
          )}
          <MenuItem
            icon="folder"
            label="Показать в проводнике"
            onClick={() => {
              om.close()
              bReveal(p, file).then(
                (r) =>
                  !r.ok && st().toast({ title: 'Не открылось', desc: r.reason, icon: 'warn', tone: 'warn' }),
                () => st().toast({ title: 'Нужен сервер TetraFree', icon: 'warn', tone: 'warn' }),
              )
            }}
          />
          <MenuItem
            icon="copy"
            label="Скопировать путь"
            right={p.path}
            onClick={() => {
              copyText(joinPath(p.path, file))
              om.close()
              st().toast({ title: 'Путь скопирован', desc: joinPath(p.path, file), icon: 'folder' })
            }}
          />
          {file.startsWith('docs/') && (
            <MenuItem
              icon="doc"
              label="Obsidian"
              onClick={() => {
                openExternal(`obsidian://open?path=${encodeURIComponent(joinPath(p.path, file))}`)
                om.close()
              }}
            />
          )}
        </Menu>
      )}
    </div>
  )
}

export function askAgent(text: string) {
  const st = useStore.getState()
  const p = st.projects.find((x) => x.id === st.projectId)
  let chatId = st.center.kind === 'chat' ? st.center.id : p?.chats[0]?.id
  if (!chatId)
    chatId = st.createChat({
      title: 'Правки кода',
      creator: { kind: 'human', id: 'me' },
      agents: [{ name: 'builder', tier: 'Спросить', sub: [] }],
    })
  st.setCenter({ kind: 'chat', id: chatId })
  setTimeout(() => window.dispatchEvent(new CustomEvent('tf:compose', { detail: { chatId, text } })), 30)
}

const DEVICES = [
  { k: 'desktop', w: 0, i: 'desktop' as IconName, t: 'Десктоп' },
  { k: 'tablet', w: 768, i: 'tablet' as IconName, t: 'Планшет 768' },
  { k: 'mobile', w: 375, i: 'mobile' as IconName, t: 'Мобильный 375' },
]

function BrowserPane() {
  const p = useProject()!
  const vv = useStore((s) => s.viewVersion[p.id] ?? null)
  const st = useStore.getState
  const [dev, setDev] = useState('desktop')
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const vm = useMenu()
  const last = p.versions[p.versions.length - 1]
  const ver = vv ? p.versions.find((v) => v.n === vv) : null
  const html = ver ? ver.snapshot['site/index.html'] : p.files['site/index.html']
  const url = `site/index.html${ver ? ' · v' + ver.n : ''}`
  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 380)
    return () => clearTimeout(t)
  }, [html, nonce])
  const w = DEVICES.find((d) => d.k === dev)!.w
  const openWin = () => {
    if (!html) return
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(u, '_blank')
    setTimeout(() => URL.revokeObjectURL(u), 60_000)
  }
  return (
    <div className="brz">
      <div className="brz-bar">
        <button className="iconbtn sm" title="Обновить" onClick={() => setNonce((n) => n + 1)}>
          <Icon name="refresh" size={14} />
        </button>
        <div className="brz-url">
          <Icon name={ver ? 'clock' : 'lock'} size={12} />
          <span className="u">{url}</span>
          {loading && <span className="uload" />}
        </div>
        <div className="devsw">
          {DEVICES.map((d) => (
            <button key={d.k} className={dev === d.k ? 'on' : ''} title={d.t} onClick={() => setDev(d.k)}>
              <Icon name={d.i} size={14} />
            </button>
          ))}
        </div>
        <button className="ver-sel" onClick={vm.open}>
          <Icon name="git" size={13} />
          <span className="vn">v{ver?.n ?? last?.n ?? 0}</span>
          {!ver && <span className="livedot" />}
          <Icon name="chevd" size={12} />
        </button>
      </div>
      {ver && (
        <div className="oldbar">
          <Icon name="clock" size={13} />
          Смотришь v{ver.n} от {ago(ver.at)} — «{ver.title}»
          <button className="linkbtn" onClick={() => st().setViewVersion(null)}>
            Вернуться к текущей
          </button>
        </div>
      )}
      <div className="brz-view">
        {html ? (
          <div className={'frame-host' + (w ? ' dev' : '')} style={w ? { width: w } : undefined}>
            <iframe
              key={nonce + ':' + (ver?.n ?? 'live')}
              title="Превью сайта"
              srcDoc={html}
              sandbox="allow-same-origin"
            />
          </div>
        ) : (
          <div className="empty-pane">
            <div>
              <Icon name="browser" size={24} />
              <p>
                <b>Нет страницы для превью</b>
              </p>
              <p className="t4">
                В {ver ? 'этой версии' : 'проекте'} нет site/index.html. Попроси агента собрать интерфейс —
                превью появится здесь.
              </p>
              <button className="btn sm" onClick={() => askAgent('Собери стартовую страницу для превью')}>
                Попросить агента
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="brz-foot">
        <button className="btn gho sm" onClick={() => st().openModal({ type: 'versions', focus: ver?.n })}>
          <Icon name="clock" size={13} />
          История и дифф
        </button>
        <button className="btn gho sm" onClick={() => st().openModal({ type: 'activity' })}>
          <Icon name="bolt" size={13} />
          Активность
        </button>
        <span className="grow" />
        {!isDesktop && (
          <button className="btn gho sm" onClick={openWin} disabled={!html}>
            <Icon name="external" size={13} />В отдельном окне
          </button>
        )}
      </div>
      {vm.st && (
        <Menu anchor={vm.st.anchor} onClose={vm.close} place="bottom-end" className="ver-dd">
          <MenuHead>Версии проекта</MenuHead>
          {[...p.versions]
            .reverse()
            .slice(0, 8)
            .map((v) => {
              const sel = (vv ?? last?.n) === v.n
              return (
                <MenuItem
                  key={v.n}
                  sel={sel}
                  onClick={() => {
                    st().setViewVersion(v.n === last?.n ? null : v.n)
                    vm.close()
                  }}
                >
                  <div className="vinfo">
                    <div className="vtop">
                      v{v.n}
                      {v.tag === 'release' && <span className="chip sm iris">релиз</span>}
                      {v.n === last?.n && <span className="chip sm">текущая</span>}
                    </div>
                    <div className="vsub">
                      {v.title} · {v.by === 'agent' ? v.author : 'вручную'} · {ago(v.at)}
                    </div>
                  </div>
                  {sel && <Icon name="check" size={14} />}
                </MenuItem>
              )
            })}
          <div className="dd-foot">
            <button
              className="btn sm"
              onClick={() => {
                vm.close()
                st().openModal({ type: 'versions', focus: vv ?? undefined })
              }}
            >
              <Icon name="clock" size={13} />
              История и дифф
            </button>
          </div>
        </Menu>
      )}
    </div>
  )
}
