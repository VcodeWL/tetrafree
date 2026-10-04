import { useCallback, useEffect, useState } from 'react'
import { useStore, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import { PersonAv } from '../components/ui/primitives'
import { qrSvg } from '../lib/qr'
import { SkelList, LoadError } from '../components/ui/Skel'
import { api, ApiError, logout, useAccount, type Acc } from '../lib/account'
import { useBackend } from '../lib/backend'
import { copyText, ago } from '../lib/util'
import {
  fetchMembers,
  inviteByEmail,
  leaveProject,
  listInvites,
  removeFromTeam,
  revokeInvite,
  cloudNow,
  cloudState,
  usePeers,
} from '../lib/team'
import { useProject } from '../store'
import { isEmail } from '../lib/util'
import { ME } from '../data/seed'

const KIND: Record<string, string> = {
  register: 'Регистрация',
  verified: 'Почта подтверждена',
  login: 'Вход',
  login_fail: 'Неудачная попытка входа',
  locked: 'Вход заблокирован после серии ошибок',
  password_change: 'Смена пароля',
  password_reset: 'Сброс пароля по коду',
  '2fa_on': 'Включена 2FA',
  '2fa_off': 'Отключена 2FA',
  '2fa_fail': 'Неверный код 2FA',
  sessions_revoked: 'Завершены сессии',
  invite: 'Отправлено приглашение',
  invite_accept: 'Принято приглашение',
}

export function AccountSecurity() {
  const user = useAccount((a) => a.user)
  if (!user) return <LocalNote />
  return (
    <>
      <div className="sec-h">
        <Icon name="shield" size={14} />
        Безопасность
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Почта</div>
          <div className="d">
            {user.email} · {user.verified ? 'подтверждена' : 'не подтверждена'}
            {user.providers.length ? ' · вход через ' + user.providers.join(', ') : ''}
          </div>
        </div>
      </div>
      <Password user={user} />
      <TwoFA user={user} />
      <Sessions />
      <AuditLog />
      <DeleteAccount user={user} />
    </>
  )
}

function LocalNote() {
  const on = useBackend((b) => b.status === 'online')
  return (
    <div className="srow">
      <div className="sl">
        <div className="t">Локальный профиль</div>
        <div className="d">
          {on
            ? 'Ты работаешь без аккаунта. Выйди и зарегистрируйся, чтобы приглашать людей и входить с другого устройства.'
            : 'Сервер аккаунтов недоступен. Запусти его (npm run dev / npm run server), чтобы включить вход по почте, 2FA и приглашения.'}
        </div>
      </div>
      {on && (
        <button className="btn sm" onClick={() => void logout()}>
          Войти или зарегистрироваться
        </button>
      )}
    </div>
  )
}

function Password({ user }: { user: Acc }) {
  const [open, setOpen] = useState(false)
  const [o, setO] = useState('')
  const [n, setN] = useState('')
  const [n2, setN2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (n !== n2) return setErr('Пароли не совпадают')
    setBusy(true)
    setErr('')
    try {
      await api('POST', '/api/auth/password', { old: o, password: n })
      toast({
        title: 'Пароль изменён',
        desc: 'Остальные сессии завершены, на почту ушло уведомление',
        icon: 'check',
        tone: 'ok',
      })
      setOpen(false)
      setO('')
      setN('')
      setN2('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="srow col">
      <div className="rowtop">
        <div className="sl">
          <div className="t">Пароль</div>
          <div className="d">
            {user.hasPassword
              ? 'Надёжный пароль и 2FA защищают аккаунт и доступ к проектам.'
              : 'Пароль не задан — ты входишь через провайдера. Задай пароль для входа по почте.'}
          </div>
        </div>
        <button className="btn sm" onClick={() => setOpen(!open)}>
          {open ? 'Отмена' : user.hasPassword ? 'Сменить' : 'Задать'}
        </button>
      </div>
      {open && (
        <div className="subform">
          {user.hasPassword && (
            <div className="field">
              <label>Текущий пароль</label>
              <input
                type="password"
                autoComplete="current-password"
                value={o}
                onChange={(e) => setO(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label>Новый пароль</label>
            <input
              type="password"
              autoComplete="new-password"
              value={n}
              onChange={(e) => setN(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Повтори</label>
            <input
              type="password"
              autoComplete="new-password"
              value={n2}
              onChange={(e) => setN2(e.target.value)}
            />
          </div>
          {err && <div className="ferr">{err}</div>}
          <button className="btn pri" disabled={busy || !n} onClick={save}>
            {busy ? <span className="bspin" /> : null}Сохранить
          </button>
        </div>
      )}
    </div>
  )
}

function TwoFA({ user }: { user: Acc }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [rec, setRec] = useState<string[] | null>(null)
  const [off, setOff] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const setUser = (u: Acc) => useAccount.setState({ user: u })
  const start = async () => {
    setErr('')
    try {
      setSetup(await api('POST', '/api/auth/2fa/setup'))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const enable = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ recovery: string[]; user: Acc }>('POST', '/api/auth/2fa/enable', { code })
      setRec(r.recovery)
      setUser(r.user)
      setSetup(null)
      setCode('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const disable = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ user: Acc }>('POST', '/api/auth/2fa/disable', { password: pw })
      setUser(r.user)
      setOff(false)
      setPw('')
      toast({ title: '2FA отключена', icon: 'shield' })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="srow col">
      <div className="rowtop">
        <div className="sl">
          <div className="t">Двухфакторная защита (TOTP)</div>
          <div className="d">
            {user.twofa
              ? 'Включена: при входе нужен код из приложения-аутентификатора.'
              : 'Код из Google Authenticator, 1Password, Authy и т. п. — даже если пароль утечёт, войти не смогут.'}
          </div>
        </div>
        {user.twofa ? (
          <button
            className="btn sm danger"
            onClick={() => {
              setOff(!off)
              setErr('')
            }}
          >
            Отключить
          </button>
        ) : (
          !setup && (
            <button className="btn sm" onClick={start}>
              Включить
            </button>
          )
        )}
      </div>
      {setup && (
        <div className="subform">
          <p className="hint">
            1. Отсканируй QR-код в приложении-аутентификаторе (Google Authenticator, 1Password, Aegis…) — или
            выбери «Ввести ключ вручную».
          </p>
          <div
            className="qrbox"
            role="img"
            aria-label="QR-код для приложения-аутентификатора"
            dangerouslySetInnerHTML={{ __html: qrSvg(setup.uri, 168) }}
          />
          <div className="keybox">
            <code>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <button
              className="linkbtn"
              onClick={() => {
                copyText(setup.secret)
                toast({ title: 'Ключ скопирован', icon: 'copy' })
              }}
            >
              Копировать
            </button>
            <a className="linkbtn" href={setup.uri}>
              Открыть в приложении
            </a>
          </div>
          <p className="hint">2. Введи 6-значный код, который покажет приложение.</p>
          <div className="field">
            <input
              inputMode="numeric"
              maxLength={7}
              value={code}
              placeholder="123456"
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              autoComplete="one-time-code"
            />
          </div>
          {err && <div className="ferr">{err}</div>}
          <div className="set-actions">
            <button
              className="btn pri"
              disabled={busy || code.replace(/\s/g, '').length !== 6}
              onClick={enable}
            >
              Подтвердить и включить
            </button>
            <button className="btn gho" onClick={() => setSetup(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {rec && (
        <div className="subform recbox">
          <b>Сохрани резервные коды</b>
          <p className="hint">
            Каждый код работает один раз. Они понадобятся, если потеряешь телефон. Больше мы их не покажем.
          </p>
          <div className="reclist">
            {rec.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
          <div className="set-actions">
            <button
              className="btn sm"
              onClick={() => {
                copyText(rec.join('\n'))
                toast({ title: 'Коды скопированы', icon: 'copy' })
              }}
            >
              <Icon name="copy" size={13} />
              Копировать
            </button>
            <button className="btn sm pri" onClick={() => setRec(null)}>
              Я сохранил
            </button>
          </div>
        </div>
      )}
      {off && (
        <div className="subform">
          <div className="field">
            <label>Пароль для подтверждения</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          {err && <div className="ferr">{err}</div>}
          <button className="btn danger" disabled={busy || !pw} onClick={disable}>
            Отключить 2FA
          </button>
        </div>
      )}
      {!setup && !off && !rec && err && <div className="ferr">{err}</div>}
    </div>
  )
}

interface Sess {
  id: string
  ua: string
  ip: string
  createdAt: number
  lastAt: number
  current: boolean
}
function Sessions() {
  const [list, setList] = useState<Sess[] | null>(null)
  const [bad, setBad] = useState(false)
  const [pend, setPend] = useState<string | null>(null)
  const load = useCallback(() => {
    setBad(false)
    return api<{ sessions: Sess[] }>('GET', '/api/auth/sessions')
      .then((r) => setList(r.sessions))
      .catch(() => setBad(true))
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const revoke = async (body: { id?: string; all?: boolean }) => {
    setPend(body.all ? 'all' : body.id || '')
    try {
      await api('POST', '/api/auth/sessions/revoke', body)
      await load()
    } catch (e) {
      toast({ title: 'Не удалось завершить сессию', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    } finally {
      setPend(null)
    }
  }
  return (
    <div className="srow col">
      <div className="rowtop">
        <div className="sl">
          <div className="t">Активные сессии</div>
          <div className="d">Устройства, на которых выполнен вход.</div>
        </div>
        {!!list && list.length > 1 && (
          <button className="btn sm" disabled={!!pend} onClick={() => void revoke({ all: true })}>
            {pend === 'all' && <i className="bspin" />}Завершить остальные
          </button>
        )}
      </div>
      {bad ? (
        <LoadError text="Не удалось получить список сессий" onRetry={() => void load()} />
      ) : !list ? (
        <SkelList n={2} />
      ) : (
        <div className="sesslist">
          {list.map((s) => (
            <div key={s.id} className="sess">
              <Icon name="desktop" size={15} />
              <div className="sx">
                <b>
                  {s.ua}
                  {s.current && <span className="tag">эта сессия</span>}
                </b>
                <small>
                  {s.ip || '—'} · активность {ago(s.lastAt)}
                </small>
              </div>
              {!s.current && (
                <button
                  className="iconbtn"
                  title="Завершить"
                  disabled={!!pend}
                  onClick={() => void revoke({ id: s.id })}
                >
                  {pend === s.id ? <i className="bspin light" /> : <Icon name="x" size={13} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AuditLog() {
  const [ev, setEv] = useState<{ at: number; kind: string; ip: string; ua: string; extra: string }[] | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const [bad, setBad] = useState(false)
  const load = useCallback(() => {
    setBad(false)
    api<{ events: NonNullable<typeof ev> }>('GET', '/api/auth/audit')
      .then((r) => setEv(r.events))
      .catch(() => setBad(true))
  }, [])
  useEffect(() => {
    if (open && !ev) load()
  }, [open]) // eslint-disable-line
  return (
    <div className="srow col">
      <div className="rowtop">
        <div className="sl">
          <div className="t">Журнал безопасности</div>
          <div className="d">Входы, смена пароля, 2FA, приглашения — последние 100 событий.</div>
        </div>
        <button className="btn sm" onClick={() => setOpen(!open)}>
          {open ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {open && bad && <LoadError text="Не удалось получить журнал" onRetry={load} />}
      {open && !bad && !ev && <SkelList n={4} />}
      {open && ev && (
        <div className="sesslist audit">
          {ev.map((e, i) => (
            <div key={i} className={'sess' + (/fail|locked/.test(e.kind) ? ' warn' : '')}>
              <Icon name={/fail|locked/.test(e.kind) ? 'warn' : 'dot'} size={13} />
              <div className="sx">
                <b>
                  {KIND[e.kind] || e.kind}
                  {e.extra ? ' · ' + e.extra : ''}
                </b>
                <small>
                  {e.ua} · {e.ip} · {new Date(e.at).toLocaleString('ru-RU')}
                </small>
              </div>
            </div>
          ))}
          {ev && !ev.length && <div className="hint">Пока пусто</div>}
        </div>
      )}
    </div>
  )
}

function DeleteAccount({ user }: { user: Acc }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const del = async () => {
    try {
      await api('DELETE', '/api/auth/account', { password: pw })
      toast({ title: 'Аккаунт удалён', icon: 'trash' })
      await logout()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="set-danger" style={{ marginTop: 18 }}>
      <div className="srow col">
        <div className="rowtop">
          <div className="sl">
            <div className="t">Удалить аккаунт</div>
            <div className="d">
              Аккаунт, сессии и членство в командах будут удалены. Локальные проекты на этом устройстве
              останутся.
            </div>
          </div>
          <button className="btn sm danger" onClick={() => setOpen(!open)}>
            Удалить…
          </button>
        </div>
        {open && (
          <div className="subform">
            {user.hasPassword && (
              <div className="field">
                <label>Пароль</label>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
            )}
            {err && <div className="ferr">{err}</div>}
            <button className="btn danger" disabled={user.hasPassword && !pw} onClick={del}>
              Удалить навсегда
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────── участники проекта ───────── */
interface Inv {
  id: string
  email: string
  status: string
  at: number
  exp: number
}
export function MembersPanel() {
  const p = useProject()!
  const people = useStore((s) => s.people)
  const user = useAccount((a) => a.user)
  const st = useStore.getState
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [invs, setInvs] = useState<Inv[]>([])
  const [devLink, setDevLink] = useState('')
  const [, force] = useState(0)
  const owner = !p.cloud || p.cloud.owner
  const reload = useCallback(() => {
    if (!user) return
    if (p.cloud) void fetchMembers(p.cloud.pid).catch(() => {})
    if (owner && p.cloud)
      listInvites(p.cloud.pid)
        .then(setInvs)
        .catch(() => {})
  }, [p.cloud, owner, user])
  useEffect(() => {
    reload()
    const t = setInterval(() => {
      reload()
      force((x) => x + 1)
    }, 6000)
    return () => clearInterval(t)
  }, [reload])

  const send = async () => {
    const e = email.trim().toLowerCase()
    if (!isEmail(e)) return setErr('Похоже, в адресе опечатка')
    if (p.members.some((id) => people[id]?.email.toLowerCase() === e))
      return setErr('Этот человек уже в проекте')
    if (invs.some((i) => i.email === e && i.status === 'pending')) {
      /* повторная отправка обновит ссылку */
    }
    setBusy(true)
    setErr('')
    setDevLink('')
    try {
      const r = await inviteByEmail(p, e)
      if (r.mailError)
        toast({
          title: 'Приглашение создано, но письмо не ушло',
          desc: r.mailError,
          icon: 'warn',
          tone: 'warn',
        })
      else
        toast({
          title: 'Приглашение отправлено',
          desc: r.mail === 'dev' ? e + ' · SMTP не настроен, письмо в Dev-почте' : e,
          icon: 'mail',
          tone: 'ok',
        })
      if (r.link) setDevLink(r.link)
      setEmail('')
      reload()
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const cs = cloudState.get(p.id)
  const live = usePeers((x) => !!x.live[p.id])
  return (
    <>
      <h2>Участники</h2>
      <p className="sd">
        Участники видят общие файлы, документы, задачи и чаты. Проект хранится у каждого локально и
        синхронизируется через облако сервера.
      </p>
      {!user ? (
        <div className="auth-err">
          <Icon name="lock" size={14} />
          Чтобы приглашать людей, войди в аккаунт (сейчас включён локальный режим).
        </div>
      ) : owner ? (
        <div className="invite-box">
          <div className="srow sl" style={{ padding: 0, border: 0 }}>
            <div className="sl">
              <div className="t">Пригласить по почте</div>
              <div className="d">
                Человек получит письмо со ссылкой на «{p.name}». Ссылка действует 7 дней и работает только для
                этой почты.
              </div>
            </div>
          </div>
          <div className="invite-row">
            <input
              value={email}
              placeholder="name@company.com"
              onChange={(e) => {
                setEmail(e.target.value)
                setErr('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              aria-invalid={!!err}
              className={err ? 'bad' : ''}
              type="email"
            />
            <button className="btn pri" onClick={() => void send()} disabled={!email.trim() || busy}>
              {busy ? <span className="bspin" /> : <Icon name="userplus" size={14} />}Пригласить
            </button>
          </div>
          {err && <div className="ferr">{err}</div>}
          {devLink && (
            <div className="inv-link">
              <Icon name="link" size={13} />
              <span className="mono">{devLink}</span>
              <button
                className="linkbtn"
                onClick={() => {
                  copyText(devLink)
                  toast({ title: 'Ссылка скопирована', icon: 'copy' })
                }}
              >
                Копировать
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="hint" style={{ marginBottom: 14 }}>
          Приглашать людей может владелец проекта.
        </div>
      )}

      {p.cloud && (
        <div className="cloudbar">
          <Icon name="refresh" size={13} />
          <span>
            {cs?.error ? (
              <b className="bad">Облако: {cs.error}</b>
            ) : cs?.syncing ? (
              'Синхронизация…'
            ) : cs?.at ? (
              'Облако синхронизировано ' + ago(cs.at)
            ) : (
              'Облако подключено'
            )}{' '}
            · ревизия {p.cloud.rev}
          </span>
          {live ? (
            <span className="chip sm live" title="Правки коллег приходят мгновенно по потоку событий">
              в реальном времени
            </span>
          ) : (
            <span className="chip sm" title="Поток событий не подключён — синхронизация раз в 5 секунд">
              опрос раз в 5 с
            </span>
          )}
          <button
            className="linkbtn"
            disabled={!!cs?.syncing}
            onClick={() => void cloudNow(p.id).then(() => force((x) => x + 1))}
          >
            {cs?.syncing ? 'Синхронизирую…' : 'Синхронизировать'}
          </button>
        </div>
      )}

      {invs
        .filter((i) => i.status === 'pending')
        .map((i) => (
          <div className="member" key={i.id}>
            <span className="avx">
              <Icon name="mail" size={16} />
            </span>
            <div className="mx">
              <div className="mn">
                {i.email}
                <span className="tag">ожидает</span>
              </div>
              <div className="me2">
                отправлено {ago(i.at)} · действует до {new Date(i.exp).toLocaleDateString('ru-RU')}
              </div>
            </div>
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                inviteByEmail(p, i.email)
                  .then((r) => {
                    if (r.link) setDevLink(r.link)
                    toast({ title: 'Отправили ещё раз', desc: i.email, icon: 'mail' })
                  })
                  .catch((e) =>
                    toast({ title: 'Не вышло', desc: (e as Error).message, icon: 'warn', tone: 'warn' }),
                  )
                  .finally(() => {
                    setBusy(false)
                    reload()
                  })
              }}
            >
              Ещё раз
            </button>
            <button
              className="iconbtn"
              title="Отозвать приглашение"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                revokeInvite(i.id)
                  .then(() => toast({ title: 'Приглашение отозвано', desc: i.email, icon: 'x' }))
                  .catch((e) =>
                    toast({
                      title: 'Не удалось отозвать',
                      desc: (e as Error).message,
                      icon: 'warn',
                      tone: 'warn',
                    }),
                  )
                  .finally(() => {
                    setBusy(false)
                    reload()
                  })
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}

      {p.members.map((id) => {
        const m = people[id]
        if (!m) return null
        const isOwner = p.cloud ? (p.cloud.owner ? id === ME : id === p.cloud.ownerId) : p.creator === id
        return (
          <div className="member" key={id}>
            <PersonAv id={id} size={36} round />
            <div className="mx">
              <div className="mn">
                {m.name}
                {id === ME && <span className="you">это ты</span>}
                {isOwner && <span className="tag">владелец</span>}
              </div>
              <div className="me2">
                {[id !== ME && m.status === 'online' ? m.role : undefined, m.email, m.tz]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {!!m.tags?.length && (
                <div className="mtags">
                  {m.tags.map((t) => (
                    <span key={t} className="subtag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span
              className={'stdot ' + (m.status || 'offline')}
              title={m.status === 'online' ? 'в сети' : 'не в сети'}
            />
            {!isOwner && id !== ME && owner && p.cloud && (
              <button
                className="iconbtn"
                title="Убрать из проекта"
                onClick={() =>
                  st().openModal({
                    type: 'confirm',
                    danger: true,
                    title: `Убрать ${m.name} из проекта?`,
                    body: 'Человек потеряет доступ к облачной копии проекта. Его локальная копия останется у него.',
                    confirm: 'Убрать',
                    run: () => {
                      removeFromTeam(p.cloud!.pid, id)
                        .then(() => fetchMembers(p.cloud!.pid))
                        .catch((e) =>
                          toast({
                            title: 'Не вышло',
                            desc: (e as Error).message,
                            icon: 'warn',
                            tone: 'warn',
                          }),
                        )
                    },
                  })
                }
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
        )
      })}
      {p.cloud && !p.cloud.owner && (
        <div className="set-danger">
          <div className="srow">
            <div className="sl">
              <div className="t">Покинуть проект</div>
              <div className="d">Облачная синхронизация отключится, локальная копия останется.</div>
            </div>
            <button
              className="btn sm danger"
              onClick={() =>
                st().openModal({
                  type: 'confirm',
                  danger: true,
                  title: 'Покинуть проект?',
                  body: 'Ты перестанешь получать обновления. Локальная копия останется.',
                  confirm: 'Покинуть',
                  run: () => {
                    leaveProject(p.id)
                      .then(() => toast({ title: 'Ты покинул проект', icon: 'logout' }))
                      .catch((e) =>
                        toast({ title: 'Не вышло', desc: (e as Error).message, icon: 'warn', tone: 'warn' }),
                      )
                  },
                })
              }
            >
              Покинуть
            </button>
          </div>
        </div>
      )}
    </>
  )
}
export type { ApiError }
