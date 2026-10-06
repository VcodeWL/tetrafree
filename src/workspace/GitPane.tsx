import { useCallback, useEffect, useMemo, useState } from 'react'
import { fireTrigger } from '../agent/ci'
import { useStore, useProject } from '../store'
import { Icon } from '../components/ui/Icon'
import { Skel, SkelRow } from '../components/ui/Skel'
import { bGit, backendOnline, useBackend, type GitCommit, type GitFile } from '../lib/backend'
import { useGit, refreshGit, parseDiff } from '../lib/git'
import { ago, plural, modKey } from '../lib/util'
import { Menu, MenuItem, MenuHead, MenuSep, useMenu } from '../components/ui/Menu'
import { suggestMessage } from '../lib/commitmsg'
import { resyncNow } from '../lib/sync'

const KIND: Record<GitFile['kind'], { l: string; t: string }> = {
  new: { l: 'A', t: 'Новый' },
  mod: { l: 'M', t: 'Изменён' },
  del: { l: 'D', t: 'Удалён' },
  ren: { l: 'R', t: 'Переименован' },
  conflict: { l: '!', t: 'Конфликт' },
}
/** Выборочный коммит: номера отмеченных блоков (hunks) файла и сколько их было в diff при выборе */
type HunkSel = { idx: number[]; total: number }
type View = { kind: 'file'; path: string } | { kind: 'commit'; hash: string; title: string } | null

/** Панель Git: изменения, коммит, история. Работает через локальный сервер (git CLI). */
export function GitPane() {
  const p = useProject()!
  const st = useStore.getState
  const online = useBackend((b) => b.status === 'online')
  const canGit = useBackend((b) => !!b.info?.git)
  const { status, loading, error } = useGit()
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [hunks, setHunks] = useState<Record<string, HunkSel>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>(null)
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [net, setNet] = useState<'fetch' | 'pull' | 'push' | null>(null)
  const bm = useMenu()
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])
  const [remote, setRemote] = useState('')
  const [amend, setAmend] = useState(false)
  const [stashes, setStashes] = useState<{ ref: string; subject: string; at: number }[]>([])

  const loadLog = useCallback(async () => {
    if (!backendOnline()) return
    try {
      setCommits((await bGit<{ commits: GitCommit[] }>('log', p, { limit: 40 })).commits)
    } catch {
      setCommits([])
    }
  }, [p])
  useEffect(() => {
    setView(null)
    setSkip({})
    setMsg('')
    setCommits(null)
    void refreshGit()
    void loadLog()
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) void refreshGit({ quiet: true })
    }, 5000)
    const f = () => void refreshGit({ quiet: true })
    window.addEventListener('focus', f)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', f)
    }
  }, [])

  const files = useMemo(() => status?.files ?? [], [status])
  const picked = useMemo(() => files.filter((f) => !skip[f.path]), [files, skip])
  const conflicts = files.filter((f) => f.kind === 'conflict').length

  const loadBranches = async () => {
    try {
      const r = await bGit<{ branches: { name: string; current: boolean }[]; remote: string }>('branches', p)
      setBranches(r.branches)
      setRemote(r.remote)
    } catch {
      /* меню покажет текущую */
    }
  }
  const modalOpen = useStore((x) => !!x.modal)
  useEffect(() => {
    if (!modalOpen) void loadBranches()
  }, [p.id, status?.branch, modalOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadStashes = async () => {
    try {
      setStashes(
        (await bGit<{ stashes: { ref: string; subject: string; at: number }[] }>('stashes', p)).stashes,
      )
    } catch {
      /* список просто не обновится */
    }
  }
  useEffect(() => {
    void loadStashes()
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const afterDisk = async () => {
    await resyncNow()
    await refreshGit()
    await loadLog()
    await loadBranches()
    await loadStashes()
  }
  const fail = (title: string, e: unknown) =>
    st().toast({ title, desc: e instanceof Error ? e.message : String(e), tone: 'err', icon: 'warn' })
  const run = async (
    op: 'stash' | 'stashpop' | 'stashdrop' | 'merge' | 'delbranch',
    extra: Record<string, unknown>,
    okTitle: string,
    errTitle: string,
  ) => {
    const r = await bGit<{ ok: boolean; reason?: string }>(op, p, extra).catch((e: Error) => ({
      ok: false,
      reason: e.message,
    }))
    if (!r.ok) {
      st().toast({ title: errTitle, desc: r.reason, tone: 'err', icon: 'warn' })
      return false
    }
    st().toast({ title: okTitle, icon: 'git', tone: 'ok' })
    await afterDisk()
    return true
  }
  const stashAll = async () => {
    await resyncNow()
    setSkip({})
    await run('stash', { message: msg.trim() }, 'Изменения отложены', 'Не удалось отложить')
  }
  const merge = (name: string) => {
    bm.close()
    st().openModal({
      type: 'confirm',
      confirm: 'Влить',
      title: `Влить «${name}» в «${status?.branch}»?`,
      body: 'Если будут конфликты, слияние отменится само и ничего не изменится. Несохранённые правки лучше закоммитить или отложить.',
      run: () => void run('merge', { name }, `«${name}» влита`, 'Слияние не выполнено'),
    })
  }
  const delBranch = (name: string) => {
    bm.close()
    st().openModal({
      type: 'confirm',
      danger: true,
      confirm: 'Удалить',
      title: `Удалить ветку «${name}»?`,
      body: 'Удалится только если ветка уже влита. Иначе спрошу ещё раз.',
      run: async () => {
        const r = await bGit<{ ok: boolean; reason?: string }>('delbranch', p, { name }).catch(
          (e: Error) => ({ ok: false, reason: e.message }),
        )
        if (r.ok) {
          st().toast({ title: 'Ветка удалена: ' + name, icon: 'trash' })
          await loadBranches()
          return
        }
        if (r.reason === 'notmerged')
          st().openModal({
            type: 'confirm',
            danger: true,
            confirm: 'Удалить с потерей',
            title: `«${name}» не влита`,
            body: 'В ней есть коммиты, которых нет в других ветках. Они пропадут.',
            run: () =>
              void run('delbranch', { name, force: true }, 'Ветка удалена: ' + name, 'Не удалось удалить'),
          })
        else fail('Не удалось удалить', r.reason)
      },
    })
  }
  const switchTo = async (name: string) => {
    bm.close()
    const r = await bGit<{ ok: boolean; reason?: string }>('checkout', p, { name }).catch((e: Error) => ({
      ok: false,
      reason: e.message,
    }))
    if (!r.ok) {
      st().toast({ title: 'Не удалось переключиться', desc: r.reason, tone: 'err', icon: 'warn' })
      return
    }
    st().toast({ title: 'Ветка: ' + name, icon: 'git' })
    await afterDisk()
  }
  const newBranch = () => {
    bm.close()
    st().openModal({
      type: 'rename',
      title: 'Новая ветка',
      value: '',
      label: 'Создать',
      hint: `от «${status?.branch || 'текущей'}», несохранённые изменения переедут с тобой`,
      check: (v) =>
        !/^[A-Za-z0-9][\w./-]{0,99}$/.test(v) || v.includes('..') || v.endsWith('/')
          ? 'Латиница, цифры и - _ . /'
          : branches.some((b) => b.name === v)
            ? 'Такая ветка уже есть'
            : null,
      run: async (v) => {
        const r = await bGit<{ ok: boolean; reason?: string }>('branch', p, { name: v }).catch(
          (e: Error) => ({ ok: false, reason: e.message }),
        )
        if (!r.ok) st().toast({ title: 'Ветка не создана', desc: r.reason, tone: 'err', icon: 'warn' })
        else {
          st().toast({ title: 'Ветка создана: ' + v, icon: 'git', tone: 'ok' })
          await afterDisk()
        }
      },
    })
  }
  const sync = async (op: 'fetch' | 'pull' | 'push') => {
    if (net) return
    setNet(op)
    try {
      if (op === 'pull') await resyncNow() // свои правки — на диск, иначе pull их не увидит
      const r = await bGit<{ ok: boolean; reason?: string; out?: string }>(op, p)
      const T = { fetch: 'Получено с сервера', pull: 'Изменения подтянуты', push: 'Отправлено' }
      if (!r.ok)
        st().toast({
          title: { fetch: 'Fetch не удался', pull: 'Pull не удался', push: 'Push не удался' }[op],
          desc: r.reason,
          tone: 'err',
          icon: 'warn',
        })
      else
        st().toast({
          title: T[op],
          desc: /up to date|Everything up-to-date/i.test(r.out || '') ? 'Уже актуально' : undefined,
          icon: 'git',
          tone: 'ok',
        })
      await afterDisk()
    } catch (e) {
      st().toast({ title: 'Нет связи с сервером', desc: (e as Error).message, tone: 'err', icon: 'warn' })
    } finally {
      setNet(null)
    }
  }

  const commit = async () => {
    if (busy || (amend ? false : !msg.trim() || !picked.length)) return
    setBusy(true)
    try {
      const part = amend
        ? {}
        : Object.fromEntries(
            picked.filter((f) => f.kind === 'mod' && hunks[f.path]).map((f) => [f.path, hunks[f.path]]),
          )
      const partial = Object.keys(part).length > 0
      const whole = picked.filter((f) => !part[f.path])
      const all = !partial && picked.length === files.length
      const r = await bGit<{ ok: boolean; hash?: string; reason?: string; out?: string }>('commit', p, {
        manual: true,
        amend,
        message: msg.trim(),
        paths: all ? undefined : whole.map((f) => f.path),
        partial: partial ? part : undefined,
      })
      if (!r.ok) {
        st().toast({
          title: 'Коммит не создан',
          desc: r.reason || r.out || 'git вернул ошибку',
          tone: 'err',
          icon: 'warn',
        })
        return
      }
      st().toast({
        title: amend ? 'Коммит исправлен' : 'Коммит создан',
        desc: `${r.hash}${msg.trim() ? ' · ' + msg.trim().split('\n')[0] : ''}`,
        icon: 'git',
        tone: 'ok',
      })
      setAmend(false)
      setMsg('')
      fireTrigger(p.id, 'commit')
      setSkip({})
      setHunks({})
      await refreshGit()
      await loadLog()
    } catch (e) {
      st().toast({ title: 'Коммит не создан', desc: (e as Error).message, tone: 'err', icon: 'warn' })
    } finally {
      setBusy(false)
    }
  }
  const discard = (f: GitFile) =>
    st().openModal({
      type: 'confirm',
      danger: true,
      confirm: f.kind === 'new' ? 'Удалить файл' : 'Отменить правки',
      title: f.kind === 'new' ? `Удалить «${f.path}»?` : `Отменить правки в «${f.path}»?`,
      body:
        f.kind === 'new'
          ? 'Файл ещё не в git — вернуть его будет нельзя.'
          : 'Файл вернётся к состоянию последнего коммита. Несохранённые правки пропадут.',
      run: async () => {
        try {
          await bGit('discard', p, { path: f.path })
          if (f.kind === 'new') st().deletePath(f.path)
          else await resyncNow()
          setView(null)
          await refreshGit()
        } catch (e) {
          st().toast({
            title: 'Не получилось отменить',
            desc: (e as Error).message,
            tone: 'err',
            icon: 'warn',
          })
        }
      },
    })

  if (!online)
    return (
      <GitEmpty
        icon="git"
        title="Нужен локальный сервер"
        text="Git работает через сервер TetraFree на этом компьютере. Запусти его (npm run dev или десктопное приложение) и открой панель снова."
      />
    )
  if (!canGit)
    return (
      <GitEmpty
        icon="warn"
        title="git не найден"
        text="Установи git и перезапусти сервер: панель покажет изменения проекта и сможет создавать коммиты."
      />
    )
  if (view)
    return (
      <GitDiff
        view={view}
        onBack={() => setView(null)}
        partial={
          view.kind === 'file' && files.find((f) => f.path === view.path)?.kind === 'mod'
            ? {
                sel: hunks[view.path],
                set: (v) =>
                  setHunks((h) => {
                    const n = { ...h }
                    if (v) n[view.path] = v
                    else delete n[view.path]
                    return n
                  }),
              }
            : undefined
        }
      />
    )

  return (
    <div className="gitp">
      <div className="git-head">
        <button
          className="git-br"
          onClick={(e) => {
            void loadBranches()
            bm.open(e)
          }}
          title="Сменить ветку"
          aria-label={'Ветка: ' + (status?.branch || '')}
        >
          <Icon name="git" size={14} />
          <b>{status?.branch || '…'}</b>
          <Icon name="chev" size={11} style={{ transform: 'rotate(90deg)' }} />
        </button>
        {!!status?.ahead && (
          <span className="t4" title="Коммитов впереди удалённой ветки">
            ↑{status.ahead}
          </span>
        )}
        {!!status?.behind && (
          <span className="t4" title="Коммитов позади удалённой ветки">
            ↓{status.behind}
          </span>
        )}
        <span className="grow" />
        <button
          className={'iconbtn sm' + (remote ? '' : ' warnic')}
          title={
            remote ? 'Удалённый репозиторий: ' + remote : 'Подключить удалённый репозиторий (GitHub, GitLab…)'
          }
          aria-label="Удалённый репозиторий"
          onClick={() => st().openModal({ type: 'remote' })}
        >
          <Icon name="link" size={14} />
        </button>
        <button
          className="iconbtn sm"
          title={remote ? 'Pull — подтянуть изменения' : 'Нет удалённого репозитория'}
          aria-label="Pull"
          onClick={() => void sync('pull')}
          disabled={!remote || !!net}
        >
          <Icon
            name={net === 'pull' ? 'refresh' : 'down'}
            size={14}
            className={net === 'pull' ? 'spin' : ''}
          />
        </button>
        <button
          className="iconbtn sm"
          title={remote ? 'Push — отправить коммиты' : 'Нет удалённого репозитория'}
          aria-label="Push"
          onClick={() => void sync('push')}
          disabled={!remote || !!net}
        >
          <Icon
            name={net === 'push' ? 'refresh' : 'upload'}
            size={14}
            className={net === 'push' ? 'spin' : ''}
          />
        </button>
        <button
          className="iconbtn sm"
          title={remote ? 'Fetch + обновить статус' : 'Обновить'}
          aria-label="Обновить статус git"
          onClick={() => void (remote ? sync('fetch') : refreshGit().then(loadLog))}
          disabled={loading || !!net}
        >
          <Icon name="refresh" size={14} className={loading || net === 'fetch' ? 'spin' : ''} />
        </button>
        {bm.st && (
          <Menu anchor={bm.st.anchor} onClose={bm.close} width={230}>
            <MenuHead>Ветки</MenuHead>
            {branches.map((b) => (
              <MenuItem
                key={b.name}
                icon="git"
                label={b.name}
                sel={b.current}
                right={b.current ? '✓' : undefined}
                onClick={() => (b.current ? bm.close() : void switchTo(b.name))}
              >
                {!b.current && (
                  <span className="br-act">
                    <button
                      title={`Влить «${b.name}» сюда`}
                      aria-label={`Влить ${b.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        merge(b.name)
                      }}
                    >
                      <Icon name="share" size={13} />
                    </button>
                    <button
                      title="Удалить ветку"
                      aria-label={`Удалить ${b.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        delBranch(b.name)
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                )}
              </MenuItem>
            ))}
            <MenuSep />
            <MenuItem icon="plus" label="Новая ветка…" onClick={newBranch} />
          </Menu>
        )}
      </div>
      <div className="git-body">
        {error && (
          <div className="git-err">
            <Icon name="warn" size={13} />
            {error}
          </div>
        )}
        {conflicts > 0 && (
          <div className="git-err">
            <Icon name="warn" size={13} />
            Конфликтов слияния: {conflicts}. Реши их в файлах и закоммить.
          </div>
        )}

        <div className="git-sec">
          <span>Изменения</span>
          <span className="t4">{files.length}</span>
          {files.length > 1 && (
            <button
              className="linkbtn"
              onClick={() =>
                setSkip(
                  picked.length === files.length ? Object.fromEntries(files.map((f) => [f.path, true])) : {},
                )
              }
            >
              {picked.length === files.length ? 'Снять все' : 'Выбрать все'}
            </button>
          )}
        </div>
        {!status && loading ? (
          <>
            <SkelRow />
            <SkelRow />
          </>
        ) : files.length === 0 ? (
          <div className="git-clean">
            <Icon name="checksq" size={16} />
            <div>
              <b>Всё закоммичено</b>
              <p>Рабочая папка совпадает с последним коммитом.</p>
            </div>
          </div>
        ) : (
          <ul className="git-files">
            {files.map((f) => (
              <li key={f.path} className={'gf k-' + f.kind}>
                <input
                  type="checkbox"
                  checked={!skip[f.path]}
                  onChange={() => setSkip((s) => ({ ...s, [f.path]: !s[f.path] }))}
                  aria-label={'Включить в коммит: ' + f.path}
                />
                <button
                  className="gf-main"
                  onClick={() => setView({ kind: 'file', path: f.path })}
                  title={f.from ? `${f.from} → ${f.path}` : f.path}
                >
                  <i className="gk" title={KIND[f.kind].t}>
                    {KIND[f.kind].l}
                  </i>
                  <span className="gn">{f.path.split('/').pop()}</span>
                  <span className="gd">
                    {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}
                  </span>
                  {hunks[f.path] && f.kind === 'mod' && (
                    <span className="gf-part" title="Выборочный коммит: только отмеченные блоки">
                      {hunks[f.path].idx.length}/{hunks[f.path].total} блоков
                    </span>
                  )}
                </button>
                {f.kind !== 'conflict' && (
                  <button
                    className="iconbtn sm gf-x"
                    title={f.kind === 'new' ? 'Удалить файл' : 'Отменить правки'}
                    aria-label={'Отменить правки: ' + f.path}
                    onClick={() => discard(f)}
                  >
                    <Icon name="undo" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="git-commit">
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Сообщение коммита"
            rows={2}
            aria-label="Сообщение коммита"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void commit()
              }
            }}
          />
          <div className="git-crow">
            <button
              className="linkbtn"
              disabled={!picked.length}
              onClick={() => setMsg(suggestMessage(picked))}
              title="Подставить черновик по списку файлов"
            >
              Предложить сообщение
            </button>
            <span className="grow" />
            <span className="t4">{modKey}+Enter</span>
          </div>
          <label className="git-amend">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => {
                setAmend(e.target.checked)
                if (e.target.checked && !msg && commits?.[0]) setMsg(commits[0].subject)
              }}
            />
            Исправить последний коммит
            {amend && !!status?.upstream && !status.ahead && <em>уже отправлен — понадобится force push</em>}
          </label>
          <button
            className="btn pri sm"
            disabled={busy || (!amend && (!msg.trim() || !picked.length))}
            onClick={() => void commit()}
          >
            {busy
              ? 'Коммичу…'
              : amend
                ? 'Исправить последний коммит'
                : picked.length
                  ? `Закоммитить ${picked.length} ${plural(picked.length, ['файл', 'файла', 'файлов'])}`
                  : 'Нечего коммитить'}
          </button>
        </div>

        {(files.length > 0 || stashes.length > 0) && (
          <div className="git-sec">
            <span>Отложенное</span>
            {stashes.length > 0 && <span className="t4">{stashes.length}</span>}
            {files.length > 0 && (
              <button
                className="linkbtn"
                onClick={() => void stashAll()}
                title="Убрать все текущие изменения (и новые файлы) в stash, рабочая папка станет чистой"
              >
                Отложить всё
              </button>
            )}
          </div>
        )}
        {stashes.length > 0 && (
          <ul className="git-log">
            {stashes.map((x) => (
              <li key={x.ref} className="git-stash">
                <span className="gl-s">{x.subject.replace(/^(On|WIP on) [^:]+: /, '')}</span>
                <span className="gl-m">{ago(x.at * 1000)}</span>
                <span className="br-act on">
                  <button
                    onClick={() =>
                      void run('stashpop', { ref: x.ref }, 'Изменения возвращены', 'Не удалось вернуть')
                    }
                  >
                    Вернуть
                  </button>
                  <button
                    onClick={() =>
                      st().openModal({
                        type: 'confirm',
                        danger: true,
                        confirm: 'Удалить',
                        title: 'Удалить отложенное?',
                        body: 'Эти изменения пропадут навсегда.',
                        run: () => void run('stashdrop', { ref: x.ref }, 'Удалено', 'Не удалось удалить'),
                      })
                    }
                  >
                    Удалить
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="git-sec">
          <span>История</span>
          {commits && <span className="t4">{commits.length}</span>}
        </div>
        {commits === null ? (
          <>
            <SkelRow />
            <SkelRow />
          </>
        ) : commits.length === 0 ? (
          <div className="git-none">Коммитов пока нет.</div>
        ) : (
          <ul className="git-log">
            {commits.map((c) => (
              <li key={c.hash}>
                <button onClick={() => setView({ kind: 'commit', hash: c.hash, title: c.subject })}>
                  <span className="gl-s">{c.subject}</span>
                  <span className="gl-m">
                    <code>{c.short}</code> · {c.author} · {ago(c.at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function GitEmpty({ icon, title, text }: { icon: 'git' | 'warn'; title: string; text: string }) {
  return (
    <div className="empty-pane">
      <div>
        <Icon name={icon} size={22} />
        <p>
          <b>{title}</b>
        </p>
        <p className="t4" style={{ maxWidth: 320 }}>
          {text}
        </p>
      </div>
    </div>
  )
}

function GitDiff({
  view,
  onBack,
  partial,
}: {
  view: NonNullable<View>
  onBack: () => void
  partial?: { sel?: HunkSel; set: (v: HunkSel | null) => void }
}) {
  const p = useProject()!
  const st = useStore.getState
  const [state, setState] = useState<{ diff: string; binary?: boolean } | 'load' | 'err'>('load')
  useEffect(() => {
    let off = false
    setState('load')
    const req =
      view.kind === 'file'
        ? bGit<{ diff: string; binary?: boolean }>('diff', p, { path: view.path })
        : bGit<{ ok: boolean; diff: string }>('show', p, { hash: view.hash })
    req
      .then((r) => {
        if (!off) setState(r)
      })
      .catch(() => {
        if (!off) setState('err')
      })
    return () => {
      off = true
    }
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !st().modal && !st().palette) onBack()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onBack]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(
    () =>
      typeof state === 'object'
        ? parseDiff(state.diff).filter(
            (l) => view.kind === 'commit' || l.t !== 'meta' || l.text.startsWith('\\'),
          )
        : [],
    [state, view.kind],
  )
  const total = lines.filter((l) => l.t === 'hunk').length
  /* файл успели изменить, пока выбор был открыт, — старые номера блоков уже ни к чему */
  useEffect(() => {
    if (partial?.sel && partial.sel.total !== total && total > 0) partial.set(null)
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = new Set(partial?.sel ? partial.sel.idx : Array.from({ length: total }, (_, i) => i))
  const toggle = (i: number) => {
    const n = new Set(chosen)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    partial?.set(n.size === total ? null : { idx: [...n].sort((a, b) => a - b), total })
  }
  let hn = -1
  const add = lines.filter((l) => l.t === 'add').length,
    del = lines.filter((l) => l.t === 'del').length
  return (
    <div className="gitp">
      <div className="git-head">
        <button className="iconbtn sm" aria-label="Назад к изменениям" title="Назад (Esc)" onClick={onBack}>
          <Icon name="chev" size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <b className="gh-t" title={view.kind === 'file' ? view.path : view.title}>
          {view.kind === 'file' ? view.path : view.title}
        </b>
        <span className="grow" />
        {partial && total > 1 && (
          <span className="t4 gh-part">
            в коммит: {chosen.size} из {total} блоков
          </span>
        )}
        {typeof state === 'object' && view.kind === 'file' && (
          <span className="diff-stat">
            <span className="add">+{add}</span>
            <span className="del">−{del}</span>
          </span>
        )}
        {view.kind === 'file' && p.files[view.path] !== undefined && (
          <button
            className="btn gho sm"
            onClick={() => {
              st().openFile(view.path)
              st().setRight({ rightTab: 'code' })
            }}
          >
            Открыть файл
          </button>
        )}
      </div>
      <div className="git-diff">
        {state === 'load' ? (
          <div style={{ padding: 16 }}>
            <Skel h={12} w="60%" />
            <Skel h={12} style={{ marginTop: 10 }} />
            <Skel h={12} w="80%" style={{ marginTop: 10 }} />
          </div>
        ) : state === 'err' ? (
          <div className="git-err">
            <Icon name="warn" size={13} />
            Не удалось получить diff
          </div>
        ) : state.binary ? (
          <div className="git-none">Бинарный файл — построчного сравнения нет.</div>
        ) : lines.length === 0 ? (
          <div className="git-none">
            {view.kind === 'file' ? 'Изменений нет — файл совпадает с последним коммитом.' : 'Пустой коммит.'}
          </div>
        ) : (
          <div className="gdtab" role="group" aria-label="Изменения">
            {lines.map((l, i) => {
              const h = l.t === 'hunk' ? ++hn : -1
              return (
                <div key={i} className={'gdr ' + l.t + (hn >= 0 && partial && !chosen.has(hn) ? ' off' : '')}>
                  <span className="gdn">{l.a ?? ''}</span>
                  <span className="gdn">{l.b ?? ''}</span>
                  <span className="gdm">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
                  <span className="gdt">
                    {h >= 0 && partial && total > 1 && (
                      <input
                        type="checkbox"
                        className="gh-cb"
                        checked={chosen.has(h)}
                        onChange={() => toggle(h)}
                        aria-label={`Включить в коммит блок ${h + 1} из ${total}`}
                      />
                    )}
                    {l.text || ' '}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
