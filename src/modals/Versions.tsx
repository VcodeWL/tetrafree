import { useMemo, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import { PersonAv, AgentAvatar } from '../components/ui/primitives'
import { Modal, MHead } from '../components/ui/Modal'
import { diffSnapshots, compact } from '../lib/diff'
import { makeZip } from '../lib/zip'
import { ago, clock, nFiles } from '../lib/util'
import type { Version } from '../types'
import { teamHistory } from '../lib/team'

export function VersionsModal({ focus }: { focus?: number }) {
  const p = useProject()!
  const people = useStore((s) => s.people)
  const live = useStore((s) => s.viewVersion[p.id])
  const st = useStore.getState
  const vs = p.versions
  const [sel, setSel] = useState(focus ?? vs[vs.length - 1]?.n)
  const v = vs.find((x) => x.n === sel) || vs[vs.length - 1]
  const [more, setMore] = useState(false)
  const [tab, setTab] = useState<'mine' | 'team'>('mine')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const prev = v ? vs[vs.indexOf(v) - 1] : undefined
  const diffs = useMemo(() => (v ? diffSnapshots(prev?.snapshot || {}, v.snapshot) : []), [v, prev])
  const latest = vs[vs.length - 1]
  if (!v)
    return (
      <Modal wide label="История версий">
        <MHead
          icon="clock"
          title="История версий"
          sub="Версий пока нет. Первая появится, когда агент или ты сохранишь изменения."
        />
      </Modal>
    )
  const author = (x: Version) => (x.by === 'agent' ? x.author : people[x.author]?.name || x.author)
  const openPreview = () => {
    st().setViewVersion(v.n === latest.n ? null : v.n)
    st().setRight({ rightOpen: true, rightTab: 'browser' })
    st().closeModal()
  }
  const rollback = () =>
    st().openModal({
      type: 'confirm',
      title: `Откатиться к v${v.n}?`,
      body: `Будет создана новая версия v${latest.n + 1} с файлами из v${v.n}. Текущие версии никуда не денутся — вернуться вперёд можно в любой момент.`,
      confirm: 'Откатить',
      run: () => {
        const n = st().rollback(v.n)
        toast({
          title: `Откат выполнен · v${n}`,
          desc: `Файлы восстановлены из v${v.n}`,
          icon: 'undo',
          tone: 'ok',
        })
      },
    })
  const add = diffs.reduce((a, d) => a + d.add, 0),
    del = diffs.reduce((a, d) => a + d.del, 0)
  const tabs = p.cloud ? (
    <div className="vtabs" role="tablist">
      <button
        role="tab"
        aria-selected={tab === 'mine'}
        className={'btn sm' + (tab === 'mine' ? ' on' : '')}
        onClick={() => setTab('mine')}
      >
        Мои версии
      </button>
      <button
        role="tab"
        aria-selected={tab === 'team'}
        className={'btn sm' + (tab === 'team' ? ' on' : '')}
        onClick={() => setTab('team')}
      >
        <Icon name="users" size={13} />
        Команда
      </button>
    </div>
  ) : null
  if (tab === 'team' && p.cloud) {
    const hist = [...teamHistory(p)].reverse()
    const mineIds = new Set(vs.map((x) => x.id))
    return (
      <Modal wide label="История версий команды">
        <MHead
          icon="clock"
          title="История версий"
          sub="Общая лента команды: кто и что сохранил. Снимки файлов хранит автор версии — откат доступен для твоих версий."
        />
        {tabs}
        <div className="teamtl">
          {hist.map((e) => (
            <div key={e.id} className="tt-i">
              <span className={'vtl-dot' + (e.tag === 'release' ? ' rel' : '')} />
              <div className="tt-b">
                <div className="tt-h">
                  <b>{e.title}</b>
                  {e.tag === 'release' && <span className="reltag">релиз</span>}
                </div>
                <div className="tt-m t4">
                  {e.by === 'agent' ? <Icon name="sparkle" size={11} /> : <Icon name="user" size={11} />}
                  {author({ ...e, n: e.n || 0, snapshot: {} } as Version)} · {ago(e.at)}
                  {mineIds.has(e.id) ? ' · твоя версия' : ''}
                </div>
                {[...e.feats, ...e.changes, ...e.fixes].slice(0, 4).map((c, i) => (
                  <div key={i} className="tt-c">
                    • {c}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!hist.length && <div className="cl-empty">Лента пока пуста.</div>}
        </div>
      </Modal>
    )
  }
  return (
    <Modal wide label="История версий">
      <MHead
        icon="clock"
        title="История версий"
        sub={`${vs.length} ${vs.length === 1 ? 'версия' : vs.length < 5 ? 'версии' : 'версий'} · каждая — полный снимок файлов. Откат не удаляет историю, а создаёт новую версию.`}
      />
      {tabs}
      <div className="vtl-wrap">
        <div className="vtl">
          {[...vs].reverse().map((x) => (
            <button
              key={x.n}
              className={'vtl-node' + (x.n === v.n ? ' sel' : '')}
              onClick={() => {
                setSel(x.n)
                setMore(false)
                setOpen({})
              }}
            >
              <span className={'vtl-dot' + (x.tag === 'release' ? ' rel' : '')} />
              <div className="vtl-thumb">
                {x.snapshot['site/index.html'] ? (
                  <iframe
                    title={'v' + x.n}
                    srcDoc={x.snapshot['site/index.html']}
                    sandbox=""
                    loading="lazy"
                    tabIndex={-1}
                    className="thumb-frame"
                  />
                ) : (
                  <Mini n={x.n} />
                )}
                {(live ?? latest.n) === x.n && <span className="vtl-live">в браузере</span>}
              </div>
              <div className="vtl-n">
                v{x.n}
                {x.tag === 'release' && <span className="reltag">релиз</span>}
              </div>
              <div className="vtl-by">
                {x.by === 'agent' ? <Icon name="sparkle" size={10} /> : <Icon name="user" size={10} />}
                {author(x)}
              </div>
              <div className="vtl-when">{ago(x.at)}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="vd-head">
        <div className="vd-ttl">
          v{v.n}
          <span className="vd-title">{v.title}</span>
        </div>
        <div className="vd-meta">
          <span className="chip sm byc">
            {v.by === 'agent' ? (
              <AgentAvatar name={v.author} size={16} />
            ) : (
              <PersonAv id={v.author} size={16} round />
            )}
            {author(v)}
          </span>
          <span className="chip sm">
            {new Date(v.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, {clock(v.at)}
          </span>
        </div>
      </div>
      <div className="vd-acts">
        {v.snapshot['site/index.html'] && (
          <button className="btn sm" onClick={openPreview}>
            <Icon name="browser" size={13} />
            Открыть в браузере
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => {
            const url = URL.createObjectURL(makeZip(v.snapshot))
            const a = document.createElement('a')
            a.href = url
            a.download = `${p.name}-v${v.n}.zip`
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}
        >
          <Icon name="down" size={13} />
          Скачать снимок
        </button>
        {v.n !== latest.n && (
          <button className="btn sm" onClick={rollback}>
            <Icon name="undo" size={13} />
            Откатить к v{v.n}
          </button>
        )}
      </div>
      <Section cls="feat" icon="sparkle" title="Новое" items={v.feats} />
      <Section cls="chg" icon="refresh" title="Изменено" items={v.changes} />
      <Section cls="fix" icon="check" title="Исправлено" items={v.fixes} />
      {!v.feats.length && !v.changes.length && !v.fixes.length && (
        <div className="cl-empty">Описание не заполнено.</div>
      )}
      {!!v.details.length && (
        <>
          <button className="cl-more" onClick={() => setMore(!more)}>
            <Icon name={more ? 'chevd' : 'chev'} size={13} />
            {more ? 'Скрыть подробности' : 'Подробнее для разработчиков'}
          </button>
          {more && (
            <div className="cl-details">
              <div className="cl-dh">Технические детали</div>
              <ul className="cl-list mono">
                {v.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="diff-sec">
        <div className="diff-bar">
          <Icon name="git" size={14} />
          {prev ? `Изменения относительно v${prev.n}` : 'Файлы первой версии'}
          <span className="diff-stat">
            <span className="add">+{add}</span>
            <span className="del">−{del}</span>
          </span>
          <span className="dim">{nFiles(diffs.length)}</span>
        </div>
        {!diffs.length && (
          <div className="diff-note">
            <Icon name="info" size={14} />
            Файлы не менялись — версия зафиксировала только метаданные.
          </div>
        )}
        {diffs.map((d) => {
          const isOpen = open[d.path] ?? diffs.length <= 3
          const lines = compact(d.lines)
          return (
            <div className="dfile" key={d.path}>
              <div className="dfile-h" onClick={() => setOpen((o) => ({ ...o, [d.path]: !isOpen }))}>
                <button
                  className="dfile-t"
                  aria-expanded={isOpen}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen((o) => ({ ...o, [d.path]: !isOpen }))
                  }}
                >
                  <Icon name={isOpen ? 'chevd' : 'chev'} size={12} />
                  <span className="dpath">{d.path}</span>
                </button>
                <span className={'dst ' + d.status}>
                  {d.status === 'added' ? 'новый' : d.status === 'removed' ? 'удалён' : 'изменён'}
                </span>
                <span className="dcount">
                  <span className="add">+{d.add}</span>
                  <span className="del">−{d.del}</span>
                </span>
                <button
                  className="iconbtn sm"
                  title="Открыть файл"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (d.status !== 'removed' && p.files[d.path] !== undefined) {
                      st().closeModal()
                      st().openFile(d.path)
                    } else toast({ title: 'Файла нет в текущей версии', icon: 'info' })
                  }}
                >
                  <Icon name="external" size={12} />
                </button>
              </div>
              {isOpen && (
                <div className="dcode" tabIndex={0}>
                  {lines.slice(0, 400).map((l, i) =>
                    l.t === 'gap' ? (
                      <div key={i} className="dl gap">
                        <span className="dg" />
                        {l.s}
                      </div>
                    ) : (
                      <div key={i} className={'dl' + (l.t === '+' ? ' add' : l.t === '-' ? ' del' : '')}>
                        <span className="dg">{l.t === ' ' ? '' : l.t === '+' ? '+' : '−'}</span>
                        {l.s || ' '}
                      </div>
                    ),
                  )}
                  {lines.length > 400 && (
                    <div className="dl gap">
                      <span className="dg" />… ещё {lines.length - 400} строк
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function Section({
  cls,
  icon,
  title,
  items,
}: {
  cls: string
  icon: 'sparkle' | 'refresh' | 'check'
  title: string
  items: string[]
}) {
  if (!items.length) return null
  return (
    <div className="cl-sec">
      <div className={'cl-h ' + cls}>
        <Icon name={icon} size={13} />
        {title}
      </div>
      <ul className="cl-list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}
function Mini({ n }: { n: number }) {
  return (
    <div className="ms">
      <div className="ms-bar">
        <b />
        <b />
        <b />
      </div>
      <div className="ms-body">
        <div className="ms-h" style={{ width: 40 + ((n * 13) % 40) + '%' }} />
        <div className="ms-p" />
        <div className="ms-p sh" />
        <div className="ms-grid">
          {Array.from({ length: 2 + (n % 4) }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
