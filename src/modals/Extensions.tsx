/* Настройки → Расширения: MCP-серверы проекта, навыки и свои команды. */
import { useEffect, useMemo, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import { Segmented } from '../components/ui/primitives'
import { backendOnline, useBackend } from '../lib/backend'
import {
  mcpStatus,
  mcpApprove,
  mcpStop,
  mcpTools,
  dropMcpCache,
  hasMcpConfig,
  type McpStatus,
  type McpTool,
} from '../lib/mcp'
import { addServer, removeServer, buildCfg, configPath, validName } from '../lib/mcpconfig'
import { Catalog } from './Catalog'
import { wanted } from '../lib/market'
import { listSkills, listCustom, commandTemplate, skillTemplate, validExtName } from '../agent/slash'

export function Extensions() {
  const [tab, setTab] = useState<'mcp' | 'skills' | 'market'>(() =>
    wanted.tab === 'market' ? 'market' : 'mcp',
  )
  return (
    <>
      <h2>Расширения</h2>
      <p className="sd">
        MCP-серверы дают агенту внешние инструменты, навыки и команды — готовые инструкции. Всё хранится
        файлами в проекте и едет вместе с ним.
      </p>
      <Segmented
        value={tab}
        onChange={(v) => setTab(v as 'mcp' | 'skills' | 'market')}
        options={[
          { k: 'mcp', t: 'MCP-серверы' },
          { k: 'skills', t: 'Навыки и команды' },
          { k: 'market', t: 'Каталог' },
        ]}
        label="Раздел"
      />
      {tab === 'mcp' ? (
        <McpTab />
      ) : tab === 'skills' ? (
        <SkillsTab />
      ) : (
        <Catalog goMcp={() => setTab('mcp')} />
      )}
    </>
  )
}

function McpTab() {
  const p = useProject()!
  const online = useBackend((b) => b.status) === 'online' && backendOnline()
  const [st, setSt] = useState<McpStatus | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tools, setTools] = useState<Record<string, McpTool[] | string>>({})
  const [adding, setAdding] = useState(false)
  const key = useMemo(
    () => ['.tetra/mcp.json', '.mcp.json'].map((f) => p.files[f] ?? '').join('\0'),
    [p.files],
  )

  const load = async () => {
    if (!online || !hasMcpConfig(p.files)) {
      setSt(null)
      return
    }
    try {
      setSt(await mcpStatus(p))
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online])

  const run = async (name: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(name)
    try {
      await fn()
    } catch (e) {
      toast({ title: 'MCP: ' + name, desc: (e as Error).message.slice(0, 300), icon: 'warn', tone: 'warn' })
    } finally {
      setBusy('')
      dropMcpCache(p.id)
      await load()
    }
  }
  const remove = (name: string) => {
    const path = configPath(p.files)
    useStore.getState().writeFile(path, removeServer(p.files[path], name), p.id)
    toast({ title: `Сервер «${name}» убран из ${path}`, icon: 'check' })
  }

  return (
    <>
      <div className="set-sub">Серверы проекта</div>
      {!online && (
        <div className="ext-note">
          Нужен локальный сервер TetraFree: он запускает процессы MCP и ходит по сети. В десктопной сборке он
          стартует сам, в браузере — <code>npm run server</code>.
        </div>
      )}
      {st?.errors.map((e) => (
        <div className="ext-note bad" key={e}>
          {e}
        </div>
      ))}
      {err && <div className="ext-note bad">{err}</div>}
      {online && !hasMcpConfig(p.files) && !adding && (
        <div className="ext-note">
          В проекте пока нет серверов. Добавь первый кнопкой ниже или положи файл <code>.tetra/mcp.json</code>{' '}
          (формат как у Claude Code: <code>mcpServers</code>).
        </div>
      )}
      {st?.servers.map((s) => (
        <div className="ext-card" key={s.name}>
          <div className="ec-h">
            <Icon name={s.type === 'http' ? 'link' : 'terminal'} size={15} />
            <b>{s.name}</b>
            <span className="ec-tag">{s.type === 'http' ? 'HTTP' : 'процесс'}</span>
            {s.disabled ? (
              <span className="ec-tag off">выключен</span>
            ) : s.approved ? (
              <span className="ec-tag ok">{s.running ? 'разрешён · запущен' : 'разрешён'}</span>
            ) : (
              <span className="ec-tag warn">не разрешён</span>
            )}
          </div>
          <code className="ec-cmd">{s.desc}</code>
          {confirm === s.name && (
            <div className="ext-note warn">
              Сервер запустится на этом компьютере <b>с твоими правами</b> и сможет читать и менять файлы и
              ходить в сеть — как любая программа. Разрешай, только если доверяешь тому, кто написал эту
              команду. Изменишь команду — разрешение сбросится.
              <div className="ec-act">
                <button
                  className="btn sm pri"
                  onClick={() =>
                    void run(s.name, async () => {
                      await mcpApprove(p, s.name, true)
                      setConfirm('')
                    })
                  }
                >
                  Да, разрешить
                </button>
                <button className="btn sm gho" onClick={() => setConfirm('')}>
                  Отмена
                </button>
              </div>
            </div>
          )}
          <div className="ec-act">
            {!s.disabled && !s.approved && confirm !== s.name && (
              <button className="btn sm pri" onClick={() => setConfirm(s.name)}>
                Разрешить…
              </button>
            )}
            {s.approved && !s.disabled && (
              <button
                className="btn sm"
                disabled={!!busy}
                onClick={() =>
                  void run(s.name, async () => {
                    const r = await mcpTools(p, s.name)
                    setTools((t) => ({ ...t, [s.name]: r.tools }))
                  })
                }
              >
                {busy === s.name ? 'Запускаю…' : 'Проверить и показать инструменты'}
              </button>
            )}
            {s.running && (
              <button
                className="btn sm gho"
                onClick={() => void run(s.name, () => mcpStop(p, s.name).then(() => undefined))}
              >
                Остановить
              </button>
            )}
            {s.approved && (
              <button
                className="btn sm gho"
                onClick={() => void run(s.name, () => mcpApprove(p, s.name, false).then(() => undefined))}
              >
                Отозвать
              </button>
            )}
            <button className="btn sm gho" onClick={() => remove(s.name)}>
              Убрать из конфига
            </button>
          </div>
          {Array.isArray(tools[s.name]) && (
            <div className="ec-tools">
              {(tools[s.name] as McpTool[]).length ? (
                (tools[s.name] as McpTool[]).map((t) => (
                  <div key={t.name} className="ec-tool">
                    <code>{t.name}</code>
                    {t.readOnly && <span className="ec-tag ok">только чтение</span>}
                    <span className="dim">{t.description.slice(0, 160)}</span>
                  </div>
                ))
              ) : (
                <div className="dim">Сервер не предлагает инструментов</div>
              )}
            </div>
          )}
        </div>
      ))}
      {adding ? (
        <AddServer
          onClose={() => setAdding(false)}
          onSave={(name, cfg) => {
            const path = configPath(p.files)
            try {
              useStore.getState().writeFile(path, addServer(p.files[path], name, cfg), p.id)
              toast({ title: `Сервер «${name}» добавлен`, desc: 'Теперь его нужно разрешить', icon: 'check' })
              setAdding(false)
            } catch (e) {
              toast({ title: 'Не добавлено', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
            }
          }}
        />
      ) : (
        <button className="btn sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Добавить сервер
        </button>
      )}
      <div className="ext-note" style={{ marginTop: 14 }}>
        Агент видит инструменты разрешённых серверов в каждом ходе и вызывает их сам. Права зависят от уровня
        автономности: «Уведомить» — любые, «Спросить» — только с пометкой «только чтение», «Эскалация» —
        никаких. Секреты в <code>env</code>/<code>headers</code> лучше писать как <code>{'${ИМЯ}'}</code> —
        значение берётся из окружения сервера, а не из файла проекта.
      </div>
    </>
  )
}

function AddServer({
  onSave,
  onClose,
}: {
  onSave: (name: string, cfg: NonNullable<ReturnType<typeof buildCfg>['cfg']>) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'cmd' | 'http'>('cmd')
  const [line, setLine] = useState('')
  const [kv, setKv] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!validName(name)) return setErr('Имя: латиница, цифры, _ . - (до 40 знаков)')
    const r = buildCfg(kind, line, kv)
    if (r.error || !r.cfg) return setErr(r.error || 'Ошибка')
    onSave(name, r.cfg)
  }
  return (
    <form
      className="ext-card"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="ec-h">
        <b>Новый сервер</b>
      </div>
      <div className="ec-row">
        <input
          className="inp"
          placeholder="имя (например, memory)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Имя сервера"
        />
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as 'cmd' | 'http')}
          options={[
            { k: 'cmd', t: 'Команда' },
            { k: 'http', t: 'HTTP-адрес' },
          ]}
          label="Тип сервера"
        />
      </div>
      <input
        className="inp mono"
        placeholder={
          kind === 'cmd' ? 'npx -y @modelcontextprotocol/server-memory' : 'https://example.com/mcp'
        }
        value={line}
        onChange={(e) => setLine(e.target.value)}
        aria-label={kind === 'cmd' ? 'Команда запуска' : 'Адрес сервера'}
      />
      <textarea
        className="inp mono"
        rows={2}
        placeholder={
          kind === 'cmd'
            ? 'Переменные окружения, по строке: КЛЮЧ=${ИМЯ_В_ОКРУЖЕНИИ}'
            : 'Заголовки, по строке: Authorization=Bearer ${TOKEN}'
        }
        value={kv}
        onChange={(e) => setKv(e.target.value)}
        aria-label="Переменные или заголовки"
      />
      {err && <div className="ext-note bad">{err}</div>}
      <div className="ec-act">
        <button className="btn sm pri" type="submit">
          Добавить
        </button>
        <button className="btn sm gho" type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  )
}

function SkillsTab() {
  const p = useProject()!
  const skills = useMemo(() => listSkills(p.files), [p.files])
  const cmds = useMemo(() => listCustom(p.files), [p.files])
  const [kind, setKind] = useState<'cmd' | 'skill' | null>(null)
  const [name, setName] = useState('')
  const open = (path: string) => {
    useStore.getState().openFile(path)
    useStore.getState().closeModal()
  }
  const create = () => {
    if (!validExtName(name))
      return toast({
        title: 'Некорректное имя',
        desc: 'Буквы, цифры, _ . : - (до 48 знаков); не как у встроенной команды',
        icon: 'warn',
        tone: 'warn',
      })
    const t = kind === 'cmd' ? commandTemplate(name) : skillTemplate(name)
    if (t.path in p.files)
      return toast({ title: 'Такой файл уже есть', desc: t.path, icon: 'warn', tone: 'warn' })
    useStore.getState().writeFile(t.path, t.text, p.id)
    setKind(null)
    setName('')
    open(t.path)
  }
  return (
    <>
      <div className="set-sub">Навыки · {skills.length}</div>
      {skills.length ? (
        skills.map((s) => (
          <div className="ext-card" key={s.path}>
            <div className="ec-h">
              <Icon name="sparkle" size={15} />
              <b>/{s.name}</b>
              <button className="linkbtn" onClick={() => open(s.path)}>
                {s.path}
              </button>
            </div>
            <div className="dim">{s.description || 'без описания — агент не поймёт, когда применять'}</div>
          </div>
        ))
      ) : (
        <div className="ext-note">
          Навыков нет. Навык — папка <code>.tetra/skills/имя/</code> с файлом <code>SKILL.md</code>; агент
          видит описания в каждом ходе и сам читает нужный.
        </div>
      )}
      <div className="set-sub">Свои команды · {cmds.length}</div>
      {cmds.length ? (
        cmds.map((c) => (
          <div className="ext-card" key={c.path}>
            <div className="ec-h">
              <Icon name="terminal" size={15} />
              <b>/{c.name}</b>
              {c.hint && <span className="dim">{c.hint}</span>}
              <button className="linkbtn" onClick={() => open(c.path)}>
                {c.path}
              </button>
            </div>
            <div className="dim">{c.description}</div>
          </div>
        ))
      ) : (
        <div className="ext-note">
          Своих команд нет. Команда — файл <code>.tetra/commands/имя.md</code>; в чате набери{' '}
          <code>/имя</code>.
        </div>
      )}
      {kind ? (
        <form
          className="ext-card"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <div className="ec-row">
            <input
              className="inp"
              autoFocus
              placeholder={kind === 'cmd' ? 'имя команды, например fix' : 'имя навыка, например pdf'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Имя"
            />
            <button className="btn sm pri" type="submit">
              Создать
            </button>
            <button className="btn sm gho" type="button" onClick={() => setKind(null)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="ec-act">
          <button className="btn sm" onClick={() => setKind('cmd')}>
            <Icon name="plus" size={13} /> Новая команда
          </button>
          <button className="btn sm" onClick={() => setKind('skill')}>
            <Icon name="plus" size={13} /> Новый навык
          </button>
        </div>
      )}
    </>
  )
}
