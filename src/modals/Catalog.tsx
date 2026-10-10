/* Расширения → Каталог: установка навыков, команд, MCP-серверов и наборов в проект. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/iconData'
import { Segmented } from '../components/ui/primitives'
import { dropMcpCache } from '../lib/mcp'
import {
  wanted,
  MARKET_FILE,
  bundledItems,
  matchItems,
  planInstall,
  planRemove,
  readInstalled,
  searchRegistry,
  searchSkills,
  fetchSkillPack,
  type MarketItem,
  type MarketKind,
  type Pack,
} from '../lib/market'

const KIND_ICON: Record<MarketKind, IconName> = {
  skill: 'sparkle',
  command: 'terminal',
  mcp: 'layers',
  bundle: 'grid',
}
const KIND_NAME: Record<MarketKind, string> = {
  skill: 'Навык',
  command: 'Команда',
  mcp: 'MCP-сервер',
  bundle: 'Набор',
}
type Filter = MarketKind | 'all'
const ORDER: MarketKind[] = ['bundle', 'skill', 'command', 'mcp']
const BUNDLED = bundledItems().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

const fmtInstalls = (n: number) =>
  n >= 1e6
    ? (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' млн'
    : n >= 1000
      ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + ' тыс.'
      : String(n)

export function Catalog({ goMcp }: { goMcp: () => void }) {
  const p = useProject()!
  const [q, setQ] = useState(() => wanted.q)
  const [dq, setDq] = useState(() => wanted.q)
  const [kind, setKind] = useState<Filter>('all')
  const [net, setNet] = useState<MarketItem[]>([])
  const [next, setNext] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [netErr, setNetErr] = useState<string[]>([])
  const [open, setOpen] = useState('')
  const [packs, setPacks] = useState<Record<string, Pack | string | 'load'>>({})
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState('')
  const seq = useRef(0)
  useEffect(() => {
    wanted.tab = ''
    wanted.q = ''
  }, [])

  const installed = useMemo(() => readInstalled(p.files[MARKET_FILE]), [p.files])
  const inst = (k: string) => installed.find((i) => i.key === k)

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 400)
    return () => clearTimeout(t)
  }, [q])

  /* интернет-источники: реестр MCP (и без запроса — список), навыки skills.sh (от 2 символов) */
  useEffect(() => {
    const my = ++seq.current
    const wantMcp = kind === 'all' || kind === 'mcp'
    const wantSkill = (kind === 'all' || kind === 'skill') && dq.trim().length >= 2
    if (!wantMcp && !wantSkill) {
      setNet([])
      setNext(undefined)
      setNetErr([])
      return
    }
    setLoading(true)
    void (async () => {
      const errs: string[] = []
      const [reg, sk] = await Promise.all([
        wantMcp
          ? searchRegistry(dq).catch((e: Error) => (errs.push('Реестр MCP: ' + e.message), null))
          : Promise.resolve(null),
        wantSkill
          ? searchSkills(dq).catch((e: Error) => (errs.push('skills.sh: ' + e.message), [] as MarketItem[]))
          : Promise.resolve([] as MarketItem[]),
      ])
      if (my !== seq.current) return
      setNet([...(sk || []), ...(reg?.items || [])])
      setNext(reg?.next)
      setNetErr(errs)
      setLoading(false)
    })()
  }, [dq, kind])

  const more = async () => {
    if (!next || loading) return
    const my = seq.current
    setLoading(true)
    try {
      const r = await searchRegistry(dq, next)
      if (my === seq.current) {
        setNet((x) => [...x, ...r.items])
        setNext(r.next)
      }
    } catch (e) {
      setNetErr([(e as Error).message])
    }
    setLoading(false)
  }

  const local = useMemo(() => matchItems(BUNDLED, q, kind), [q, kind])
  const list = useMemo(() => {
    const seen = new Set<string>()
    return [...local, ...net].filter((i) => !seen.has(i.key) && !!seen.add(i.key))
  }, [local, net])
  const installedList = useMemo(
    () =>
      installed.filter(
        (i) => !q.trim() && (kind === 'all' || i.kind === kind) && !list.some((x) => x.key === i.key),
      ),
    [installed, list, q, kind],
  )

  const loadPack = async (it: MarketItem) => {
    if (it.pack) return it.pack
    if (!it.remote) throw new Error(it.blocked || 'Нечего устанавливать')
    setPacks((x) => ({ ...x, [it.key]: 'load' }))
    try {
      const pk = await fetchSkillPack(it.remote.repo, it.remote.skillId)
      setPacks((x) => ({ ...x, [it.key]: pk }))
      return pk
    } catch (e) {
      setPacks((x) => ({ ...x, [it.key]: (e as Error).message }))
      throw e
    }
  }

  const show = async (it: MarketItem) => {
    if (open === it.key) return setOpen('')
    setOpen(it.key)
    if (!it.pack && it.remote && !packs[it.key]) await loadPack(it).catch(() => {})
  }

  const apply = (it: MarketItem, pk: Pack, replace: boolean) => {
    const st = useStore.getState()
    const plan = planInstall(it, pk, p.files, installed)
    if (plan.error) return toast({ title: 'Не установлено', desc: plan.error, icon: 'warn', tone: 'warn' })
    if (plan.conflicts.length && !replace) {
      setOpen(it.key)
      setPacks((x) => ({ ...x, [it.key]: pk }))
      return setConfirm(it.key)
    }
    for (const [path, text] of Object.entries(plan.write)) st.writeFile(path, text, p.id)
    dropMcpCache(p.id)
    setConfirm('')
    const hasMcp = Object.keys(pk.mcp).length > 0
    toast({
      title: `Установлено: ${it.name}`,
      desc: hasMcp
        ? 'MCP-сервер добавлен в конфиг, но не запущен — разрешите его во вкладке «MCP-серверы».'
        : it.kind === 'command'
          ? `Команда готова: наберите /${it.id} в чате.`
          : 'Готово — агент увидит это в следующем сообщении.',
      icon: 'check',
    })
  }

  const install = async (it: MarketItem, replace = false) => {
    if (busy) return
    setBusy(it.key)
    try {
      const pk = await loadPack(it)
      /* внешнее ставим только после просмотра: первый клик раскрывает карточку */
      if (it.source !== 'встроенный' && !replace && open !== it.key) {
        setOpen(it.key)
        return
      }
      apply(it, pk, replace)
    } catch (e) {
      toast({
        title: 'Не удалось скачать',
        desc: (e as Error).message.slice(0, 300),
        icon: 'warn',
        tone: 'warn',
      })
    } finally {
      setBusy('')
    }
  }

  const remove = (key: string, name: string) => {
    const st = useStore.getState()
    const r = planRemove(key, p.files, installed)
    for (const f of r.remove) st.deleteFile(f)
    for (const [path, text] of Object.entries(r.write)) st.writeFile(path, text, p.id)
    dropMcpCache(p.id)
    toast({ title: `Убрано: ${name}`, icon: 'check' })
  }

  const card = (it: MarketItem) => {
    const rec = inst(it.key)
    const pk = it.pack || (typeof packs[it.key] === 'object' ? (packs[it.key] as Pack) : undefined)
    const st = packs[it.key]
    const isOpen = open === it.key
    return (
      <div className="ext-card mk-card" key={it.key}>
        <div className="ec-h">
          <Icon name={KIND_ICON[it.kind]} size={15} />
          <b>{it.name}</b>
          <span className="ec-tag">{KIND_NAME[it.kind]}</span>
          <span className={'ec-tag' + (it.source === 'встроенный' ? ' ok' : '')}>{it.source}</span>
          {it.installs ? <span className="dim">{fmtInstalls(it.installs)} установок</span> : null}
          {rec && <span className="ec-tag ok">установлено</span>}
        </div>
        <div className="dim">{it.desc || 'Без описания'}</div>
        {it.blocked && <div className="ext-note warn">Нельзя установить: {it.blocked}</div>}
        <div className="ec-act">
          {rec ? (
            <button className="btn sm gho" onClick={() => remove(it.key, it.name)}>
              <Icon name="trash" size={13} /> Убрать
            </button>
          ) : (
            !it.blocked && (
              <button className="btn sm pri" disabled={!!busy} onClick={() => void install(it)}>
                <Icon name="down" size={13} />{' '}
                {busy === it.key
                  ? 'Скачиваю…'
                  : it.source === 'встроенный'
                    ? 'Установить'
                    : 'Посмотреть и установить'}
              </button>
            )
          )}
          <button className="btn sm gho" onClick={() => void show(it)}>
            {isOpen ? 'Скрыть' : 'Что внутри'}
          </button>
          {it.url && (
            <a className="linkbtn" href={it.url} target="_blank" rel="noreferrer noopener">
              Страница
            </a>
          )}
          {rec && Object.keys(it.pack?.mcp || {}).length > 0 && (
            <button className="btn sm gho" onClick={goMcp}>
              К MCP-серверам
            </button>
          )}
        </div>
        {isOpen && (
          <div className="mk-det">
            {st === 'load' && <div className="dim">Загружаю из GitHub…</div>}
            {typeof st === 'string' && st !== 'load' && <div className="ext-note bad">{st}</div>}
            {pk && <Details it={it} pk={pk} />}
            {pk && !rec && !it.blocked && (it.source !== 'встроенный' || confirm === it.key) && (
              <div className="ec-act">
                {confirm === it.key ? (
                  <button className="btn sm pri" onClick={() => apply(it, pk, true)}>
                    Заменить и установить
                  </button>
                ) : (
                  <button className="btn sm pri" onClick={() => apply(it, pk, false)}>
                    Установить
                  </button>
                )}
              </div>
            )}
            {pk && confirm === it.key && (
              <div className="ext-note warn">
                Эти файлы уже есть в проекте, и они не из каталога — установка их заменит. Отменить можно
                через историю версий.
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="mk-bar">
        <input
          className="inp"
          placeholder="Поиск: «память», «react», «браузер»…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск в каталоге"
        />
      </div>
      <Segmented
        value={kind}
        onChange={(v) => setKind(v as Filter)}
        options={[
          { k: 'all', t: 'Всё' },
          { k: 'bundle', t: 'Наборы' },
          { k: 'skill', t: 'Навыки' },
          { k: 'command', t: 'Команды' },
          { k: 'mcp', t: 'MCP' },
        ]}
        label="Вид"
      />
      {installedList.length > 0 && (
        <>
          <div className="set-sub">Установлено · {installedList.length}</div>
          {installedList.map((i) => (
            <div className="ext-card" key={i.key}>
              <div className="ec-h">
                <Icon name={KIND_ICON[i.kind]} size={15} />
                <b>{i.name}</b>
                <span className="ec-tag">{KIND_NAME[i.kind]}</span>
                <span className="ec-tag">{i.source}</span>
              </div>
              <div className="ec-act">
                <button className="btn sm gho" onClick={() => remove(i.key, i.name)}>
                  <Icon name="trash" size={13} /> Убрать
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="set-sub">
        {q.trim() ? 'Результаты' : 'Каталог'} · {list.length}
        {loading ? ' · ищу…' : ''}
      </div>
      {list.map(card)}
      {!list.length && !loading && (
        <div className="ext-note">
          Ничего не найдено. Навыки из интернета ищутся от двух букв; встроенный каталог работает без сети.
        </div>
      )}
      {netErr.map((e) => (
        <div className="ext-note warn" key={e}>
          Интернет-каталог недоступен: {e}. Встроенный каталог работает как обычно.
        </div>
      ))}
      {next && (
        <div className="ec-act">
          <button className="btn sm" disabled={loading} onClick={() => void more()}>
            Показать ещё
          </button>
        </div>
      )}
      <div className="ext-note">
        Навыки и серверы из интернета написали посторонние люди. Навык — инструкции для модели, MCP-сервер —
        программа на вашем компьютере или чужой сервис. Читайте, что внутри; сервер всё равно не запустится
        без вашего «Разрешить».
      </div>
    </>
  )
}

function Details({ it, pk }: { it: MarketItem; pk: Pack }) {
  const files = Object.keys(pk.files)
  const main = files.find((f) => f.endsWith('SKILL.md')) || (it.kind === 'command' ? files[0] : undefined)
  return (
    <>
      {files.length > 0 && (
        <div className="mk-files">
          <div className="dim">Появятся файлы:</div>
          {files.map((f) => (
            <code key={f}>{f}</code>
          ))}
        </div>
      )}
      {Object.entries(pk.mcp).map(([n, c]) => (
        <div className="mk-files" key={n}>
          <div className="dim">В конфиг MCP добавится «{n}»:</div>
          <code>{'command' in c ? [c.command, ...(c.args || [])].join(' ') : c.url}</code>
        </div>
      ))}
      {pk.env.length > 0 && (
        <div className="ext-note warn">
          Нужны переменные окружения (задайте в системе до запуска TetraFree; в файл они не записываются):{' '}
          {pk.env.map((e) => (
            <div key={e.name}>
              <code>{e.name}</code>
              {e.secret ? ' · секрет' : ''}
              {e.desc ? ' — ' + e.desc : ''}
            </div>
          ))}
        </div>
      )}
      {pk.notes.map((n) => (
        <div className="ext-note" key={n}>
          {n}
        </div>
      ))}
      {main && (
        <pre className="mk-pre">
          {pk.files[main].slice(0, 2500)}
          {pk.files[main].length > 2500 ? '\n…' : ''}
        </pre>
      )}
    </>
  )
}
