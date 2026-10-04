import { isDesktop } from '../lib/desktop'
import { ServerHelp } from '../components/ServerHelp'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Wordmark } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { GITHUB_SVG, GOOGLE_SVG } from '../components/ui/iconData'
import { isEmail } from '../lib/util'
import { useBackend, detectBackend } from '../lib/backend'
import {
  api,
  ApiError,
  applySession,
  loadConfig,
  useAccount,
  clearInvite,
  type Acc,
  type InviteInfo,
  type UrlIntent,
} from '../lib/account'

type Step = 'signin' | 'signup' | 'verify' | 'forgot' | 'reset' | '2fa'
type Sess = { token: string; user: Acc }
const RULES: [string, (p: string) => boolean][] = [
  ['8+ символов', (p) => p.length >= 8],
  ['буква', (p) => /[a-zа-яё]/i.test(p)],
  ['цифра или символ', (p) => /[\d\W_]/.test(p)],
  ['заглавная', (p) => /[A-ZА-ЯЁ]/.test(p)],
]

/** шесть ячеек для кода: вставка целиком, стрелки, Backspace, автоотправка */
function CodeBoxes({
  value,
  onChange,
  onDone,
  disabled,
  autoFocus = true,
  len = 6,
}: {
  value: string
  onChange: (v: string) => void
  onDone?: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
  len?: number
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, len - 1)]?.focus()
  }, []) // eslint-disable-line
  const set = (v: string) => {
    const c = v.replace(/\D/g, '').slice(0, len)
    onChange(c)
    if (c.length === len) onDone?.(c)
    refs.current[Math.min(c.length, len - 1)]?.focus()
  }
  return (
    <div className="codebox" role="group" aria-label="Код из письма">
      {Array.from({ length: len }, (_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={len}
          disabled={disabled}
          aria-label={`Цифра ${i + 1}`}
          value={value[i] || ''}
          className={value[i] ? 'f' : ''}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '')
            if (!d) return
            if (d.length > 1) return set(value.slice(0, i) + d)
            set(value.slice(0, i) + d + value.slice(i + 1))
          }}
          onPaste={(e) => {
            e.preventDefault()
            set(e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              onChange(value.slice(0, value[i] ? i : Math.max(0, i - 1)))
              refs.current[Math.max(0, value[i] ? i : i - 1)]?.focus()
            } else if (e.key === 'ArrowLeft') refs.current[Math.max(0, i - 1)]?.focus()
            else if (e.key === 'ArrowRight') refs.current[Math.min(len - 1, i + 1)]?.focus()
          }}
        />
      ))}
    </div>
  )
}

export function Auth() {
  const st = useStore.getState
  const initialMode = useStore((s) => s.authMode)
  const backend = useBackend((b) => b.status)
  const config = useAccount((a) => a.config)
  const inviteToken = useAccount((a) => a.inviteToken)
  const [step, setStep] = useState<Step>(initialMode === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [info, setInfo] = useState('')
  const [ticket, setTicket] = useState('')
  const [caps, setCaps] = useState(false)
  const [cool, setCool] = useState(0)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [inviteErr, setInviteErr] = useState('')
  const online = backend === 'online'
  const strength = useMemo(() => RULES.filter(([, f]) => f(pass)).length, [pass])

  useEffect(() => {
    if (online) void loadConfig()
  }, [online])
  useEffect(() => {
    if (cool <= 0) return
    const t = setTimeout(() => setCool(cool - 1), 1000)
    return () => clearTimeout(t)
  }, [cool])

  /* приглашение: показываем, кто и куда зовёт */
  useEffect(() => {
    if (!inviteToken || !online) return
    api<InviteInfo>('GET', '/api/invites/' + encodeURIComponent(inviteToken))
      .then((i) => {
        setInvite(i)
        setInviteErr('')
      })
      .catch((e: ApiError) => setInviteErr(e.message))
  }, [inviteToken, online])

  const fail = (e: unknown, field = 'form') => {
    const m = (e as Error).message || 'Что-то пошло не так'
    setErr({ [field]: m })
    setBusy(null)
  }
  const go = (s: Step) => {
    setStep(s)
    setErr({})
    setInfo('')
    setCode('')
  }
  const done = (r: Sess) => {
    applySession(r)
    setBusy(null)
  }

  /* ссылки из писем и OAuth */
  useEffect(() => {
    const it = (window as unknown as { __tfIntent?: UrlIntent }).__tfIntent
    if (!it) return
    ;(window as unknown as { __tfIntent?: UrlIntent }).__tfIntent = undefined
    if (it.oauthError) setErr({ form: 'Вход через провайдера не удался: ' + it.oauthError })
    if (it.verify) {
      setEmail(it.verify.email)
      setStep('verify')
      setCode(it.verify.code)
      if (it.verify.code.length === 6) void verify(it.verify.email, it.verify.code)
    }
    if (it.reset) {
      setEmail(it.reset.email)
      setStep('reset')
      setCode(it.reset.code)
    }
    if (it.oauth) {
      setBusy('oauth')
      api<Sess>('POST', '/api/auth/oauth/exchange', { ticket: it.oauth })
        .then(done)
        .catch((e) => fail(e))
    }
  }, []) // eslint-disable-line

  async function verify(e = email, c = code) {
    setBusy('form')
    setErr({})
    try {
      done(await api<Sess>('POST', '/api/auth/verify', { email: e, code: c }))
    } catch (x) {
      fail(x, 'code')
      setCode('')
    }
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const er: Record<string, string> = {}
    const mail = email.trim().toLowerCase()
    if (step === 'signup' && name.trim().length < 2) er.name = 'Как к тебе обращаться?'
    if (['signin', 'signup', 'forgot', 'reset'].includes(step) && !isEmail(mail))
      er.email = 'Нужна почта вида name@team.dev'
    if (step === 'signin' && !pass) er.pass = 'Введи пароль'
    if (step === 'signup' || step === 'reset') {
      if (pass.length < 8) er.pass = 'Минимум 8 символов'
      else if (strength < 3) er.pass = 'Добавь букву и цифру или символ'
      else if (pass !== pass2) er.pass2 = 'Пароли не совпадают'
    }
    if (step === 'reset' && code.length !== 6) er.code = 'Введи 6 цифр из письма'
    if (step === '2fa' && code.replace(/\s/g, '').length < 6)
      er.code = 'Введи код из приложения или резервный код'
    setErr(er)
    if (Object.keys(er).length) return
    setBusy('form')
    try {
      if (step === 'signin') {
        try {
          done(await api<Sess>('POST', '/api/auth/login', { email: mail, password: pass, remember }))
        } catch (x) {
          const d = (x as ApiError).data as { need?: string; ticket?: string }
          if (d?.need === 'verify') {
            setStep('verify')
            setCode('')
            setInfo('Почта ещё не подтверждена — отправили новый код')
            setCool(30)
            setBusy(null)
          } else if (d?.need === '2fa') {
            setTicket(d.ticket!)
            go('2fa')
            setBusy(null)
          } else throw x
        }
      } else if (step === 'signup') {
        await api('POST', '/api/auth/register', { name: name.trim(), email: mail, password: pass })
        setStep('verify')
        setCode('')
        setCool(30)
        setBusy(null)
      } else if (step === 'verify') await verify(mail, code)
      else if (step === 'forgot') {
        await api('POST', '/api/auth/forgot', { email: mail })
        setStep('reset')
        setInfo('Если такая почта зарегистрирована, мы отправили код')
        setCool(30)
        setBusy(null)
      } else if (step === 'reset') {
        const r = await api<Sess & { need?: string; ticket?: string }>('POST', '/api/auth/reset', {
          email: mail,
          code,
          password: pass,
        })
        if (r.need === '2fa') {
          setTicket(r.ticket!)
          go('2fa')
          setBusy(null)
        } else done(r)
      } else if (step === '2fa') done(await api<Sess>('POST', '/api/auth/2fa/login', { ticket, code }))
    } catch (x) {
      fail(
        x,
        step === 'verify' || step === '2fa'
          ? 'code'
          : (x as ApiError).status === 400 && step === 'reset'
            ? 'code'
            : 'form',
      )
      if (step === 'verify' || step === '2fa') setCode('')
    }
  }

  const resend = async () => {
    if (cool > 0) return
    try {
      await api('POST', '/api/auth/resend', { email, kind: step === 'reset' ? 'reset' : 'verify' })
      setInfo('Новый код отправлен')
      setErr({})
      setCool(30)
    } catch (x) {
      fail(x, 'code')
    }
  }

  const localMode = () => {
    st().setSetting('localMode', true)
    st().signIn(name.trim() || null, email.trim())
  }
  const title: Record<Step, string> = {
    signin: 'С возвращением',
    signup: 'Создай аккаунт',
    verify: 'Подтверди почту',
    forgot: 'Забыл пароль?',
    reset: 'Новый пароль',
    '2fa': 'Двухфакторная защита',
  }
  const sub: Record<Step, string> = {
    signin: 'Войди, чтобы продолжить работу с командой и агентами.',
    signup: 'Команда, агенты и код — в одном рабочем пространстве.',
    verify: `Мы отправили 6-значный код на ${email || 'твою почту'}. Он действует 15 минут.`,
    forgot: 'Введи почту — пришлём код для сброса пароля.',
    reset: 'Введи код из письма и придумай новый пароль. Остальные сессии будут завершены.',
    '2fa': 'Введи 6-значный код из приложения-аутентификатора или резервный код.',
  }
  const tabs = step === 'signin' || step === 'signup'

  if (!online && backend !== 'checking') {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-logo">
            <Wordmark size={42} text={24} />
          </div>
          <h1>Сервер недоступен</h1>
          {isDesktop ? (
            <p className="sub">
              Аккаунты, подтверждение почты и приглашения работают через встроенный сервер TetraFree. Он не
              ответил — ниже видно, жив ли процесс, и есть лог запуска.
            </p>
          ) : (
            <>
              <p className="sub">
                Аккаунты, подтверждение почты и приглашения работают через сервер TetraFree. Запусти его
                командой и перезагрузи страницу:
              </p>
              <pre className="auth-cmd">
                npm run dev # сервер встроен{'\n'}npm run server # или отдельно, порт 3001
              </pre>
            </>
          )}
          <button className="btn pri" onClick={() => void detectBackend()}>
            <Icon name="refresh" size={15} />
            Проверить снова
          </button>
          <ServerHelp />
          <div className="divider">или</div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={localMode}>
            <Icon name="user" size={15} />
            Продолжить локально
          </button>
          <p className="alt">
            Локальный режим: без аккаунта, команды, приглашений и реального терминала. Данные остаются на этом
            устройстве.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-logo">
          <Wordmark size={42} text={24} />
        </div>
        {(invite || inviteErr) && tabs && (
          <div
            className={'inv-banner' + (inviteErr || (invite && invite.status !== 'pending') ? ' bad' : '')}
          >
            <Icon name={inviteErr ? 'warn' : 'mail'} size={16} />
            <div>
              {inviteErr ? (
                <b>{inviteErr}</b>
              ) : invite!.status !== 'pending' ? (
                <b>
                  Приглашение{' '}
                  {invite!.status === 'expired'
                    ? 'просрочено'
                    : invite!.status === 'accepted'
                      ? 'уже принято'
                      : 'недействительно'}
                </b>
              ) : (
                <>
                  <b>{invite!.by}</b> зовёт тебя в «{invite!.projectName}»
                  <small>Войди или зарегистрируйся с почтой {invite!.emailMasked}</small>
                </>
              )}
            </div>
            <button
              type="button"
              className="iconbtn sm"
              aria-label="Скрыть"
              onClick={() => {
                clearInvite()
                setInvite(null)
                setInviteErr('')
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        <h1>{title[step]}</h1>
        <p className="sub">{sub[step]}</p>
        {info && (
          <div className="auth-info">
            <Icon name="check" size={13} />
            {info}
          </div>
        )}
        {err.form && (
          <div className="auth-err" role="alert">
            <Icon name="warn" size={14} />
            {err.form}
          </div>
        )}

        {tabs && (
          <div className="seg">
            <span className="thumb" style={{ transform: step === 'signup' ? 'translateX(100%)' : 'none' }} />
            <button type="button" className={step === 'signin' ? 'on' : ''} onClick={() => go('signin')}>
              <Icon name="login" size={14} />
              Вход
            </button>
            <button type="button" className={step === 'signup' ? 'on' : ''} onClick={() => go('signup')}>
              <Icon name="userplus" size={14} />
              Регистрация
            </button>
          </div>
        )}
        {step === 'signup' && (
          <div className={'field' + (err.name ? ' bad' : '')}>
            <label htmlFor="a-name">Имя</label>
            <input
              id="a-name"
              value={name}
              autoComplete="name"
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Никита"
            />
            {err.name && <small className="ferr">{err.name}</small>}
          </div>
        )}
        {['signin', 'signup', 'forgot', 'reset'].includes(step) && (
          <div className={'field' + (err.email ? ' bad' : '')}>
            <label htmlFor="a-email">Почта</label>
            <input
              id="a-email"
              type="email"
              value={email}
              autoComplete="email"
              autoFocus={step === 'signin'}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@team.dev"
            />
            {err.email && <small className="ferr">{err.email}</small>}
          </div>
        )}

        {(step === 'verify' || step === 'reset' || step === '2fa') && (
          <div className={'field' + (err.code ? ' bad' : '')}>
            <label>{step === '2fa' ? 'Код' : 'Код из письма'}</label>
            {step === '2fa' ? (
              <input
                id="a-code"
                value={code}
                autoFocus
                autoComplete="one-time-code"
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456 или резервный код"
              />
            ) : (
              <CodeBoxes
                value={code}
                onChange={setCode}
                onDone={step === 'verify' ? (c) => void verify(email, c) : undefined}
                disabled={busy === 'form'}
              />
            )}
            {err.code && <small className="ferr">{err.code}</small>}
          </div>
        )}

        {['signin', 'signup', 'reset'].includes(step) && (
          <div className={'field' + (err.pass ? ' bad' : '')}>
            <label htmlFor="a-pass">
              {step === 'reset' ? 'Новый пароль' : 'Пароль'}
              {step === 'signin' && (
                <a className="flink" onClick={() => go('forgot')}>
                  Забыл?
                </a>
              )}
            </label>
            <div className="pwd">
              <input
                id="a-pass"
                type={show ? 'text' : 'password'}
                value={pass}
                autoComplete={step === 'signin' ? 'current-password' : 'new-password'}
                maxLength={128}
                onChange={(e) => setPass(e.target.value)}
                onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                onBlur={() => setCaps(false)}
                placeholder={step === 'signin' ? 'Твой пароль' : 'Минимум 8 символов'}
              />
              <button
                type="button"
                className="eye"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
              >
                <Icon name={show ? 'eyeoff' : 'eye'} size={16} />
              </button>
            </div>
            {caps && (
              <small className="fwarn">
                <Icon name="warn" size={11} />
                Включён Caps Lock
              </small>
            )}
            {step !== 'signin' && pass && (
              <div className="pstr2">
                <div className="bars">
                  {[1, 2, 3, 4].map((i) => (
                    <i key={i} className={i <= strength ? 's' + strength : ''} />
                  ))}
                </div>
                <div className="rules">
                  {RULES.map(([t, f]) => (
                    <span key={t} className={f(pass) ? 'ok' : ''}>
                      <Icon name={f(pass) ? 'check' : 'dot'} size={10} />
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {err.pass && <small className="ferr">{err.pass}</small>}
          </div>
        )}
        {(step === 'signup' || step === 'reset') && (
          <div className={'field' + (err.pass2 ? ' bad' : '')}>
            <label htmlFor="a-pass2">Повтори пароль</label>
            <input
              id="a-pass2"
              type={show ? 'text' : 'password'}
              value={pass2}
              autoComplete="new-password"
              onChange={(e) => setPass2(e.target.value)}
            />
            {err.pass2 && <small className="ferr">{err.pass2}</small>}
          </div>
        )}
        {step === 'signin' && (
          <label className="chk">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Запомнить на этом устройстве (30 дней)</span>
          </label>
        )}

        <button className="btn pri" disabled={!!busy} id="a-submit">
          {busy ? (
            <span className="bspin" />
          ) : (
            <Icon name={step === 'signup' ? 'userplus' : step === 'signin' ? 'login' : 'check'} size={15} />
          )}
          {
            {
              signin: 'Войти',
              signup: 'Создать аккаунт',
              verify: 'Подтвердить',
              forgot: 'Отправить код',
              reset: 'Сменить пароль',
              '2fa': 'Войти',
            }[step]
          }
        </button>

        {(step === 'verify' || step === 'reset') && (
          <p className="alt">
            Не пришло? Проверь «Спам».{' '}
            {cool > 0 ? (
              <span>Повторно можно через {cool} с</span>
            ) : (
              <a className="flink" onClick={resend}>
                Отправить ещё раз
              </a>
            )}
          </p>
        )}
        {step !== 'signin' && step !== 'signup' && (
          <p className="alt">
            <a className="flink" onClick={() => go('signin')}>
              ← Назад ко входу
            </a>
          </p>
        )}
        {step === 'verify' && (
          <p className="alt">
            <a className="flink" onClick={() => go('signup')}>
              Ошибся в почте? Изменить
            </a>
          </p>
        )}

        {tabs && !!config?.oauth.length && (
          <>
            <div className="divider">или</div>
            <div className="oauth">
              {config.oauth.includes('github') && (
                <a className="btn" href={`${useBackend.getState().base}/api/auth/oauth/github/start`}>
                  <span dangerouslySetInnerHTML={{ __html: GITHUB_SVG }} />
                  GitHub
                </a>
              )}
              {config.oauth.includes('google') && (
                <a className="btn" href={`${useBackend.getState().base}/api/auth/oauth/google/start`}>
                  <span dangerouslySetInnerHTML={{ __html: GOOGLE_SVG }} />
                  Google
                </a>
              )}
            </div>
          </>
        )}
        {tabs && (
          <p className="alt">
            {step === 'signup'
              ? 'Регистрируясь, ты соглашаешься с условиями использования и политикой конфиденциальности.'
              : 'Нет аккаунта? Регистрация занимает минуту.'}
          </p>
        )}
      </form>
      {config?.mail === 'dev' && (
        <DevMail
          onCode={(c) => {
            if (step === 'verify' || step === 'reset' || step === '2fa') {
              setCode(c)
              if (step === 'verify') void verify(email, c)
            }
          }}
          canUse={step === 'verify' || step === 'reset'}
        />
      )}
    </div>
  )
}

/** Dev-ящик: пока SMTP не настроен, письма не уходят в интернет — они появляются здесь */
interface Mail {
  id: string
  to: string
  subject: string
  text: string
  at: number
}
function DevMail({ onCode, canUse }: { onCode: (c: string) => void; canUse: boolean }) {
  const [open, setOpen] = useState(false)
  const [mails, setMails] = useState<Mail[]>([])
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    const load = () =>
      api<{ mails: Mail[] }>('GET', '/api/dev/outbox')
        .then((r) => on && setMails(r.mails))
        .catch(() => {})
    load()
    const t = setInterval(load, 1500)
    return () => {
      on = false
      clearInterval(t)
    }
  }, [])
  const cur = mails.find((m) => m.id === sel) || mails[0]
  const code = cur?.text.match(/Код: (\d{6})/)?.[1]
  const link = cur?.text.match(/https?:\/\/\S+/)?.[0]
  return (
    <div className={'devmail' + (open ? ' open' : '')}>
      <button type="button" className="dm-fab" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="mail" size={14} />
        Dev-почта{mails.length > 0 && <b>{mails.length}</b>}
      </button>
      {open && (
        <div className="dm-pane">
          <div className="dm-h">
            <b>Dev-почта</b>
            <span>
              SMTP не настроен — письма не уходят в интернет, а появляются здесь. Для реальной отправки задай{' '}
              <code>SMTP_URL</code>.
            </span>
          </div>
          {!mails.length ? (
            <div className="dm-empty">Писем пока нет</div>
          ) : (
            <div className="dm-body">
              <div className="dm-list">
                {mails.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={m.id === cur?.id ? 'on' : ''}
                    onClick={() => setSel(m.id)}
                  >
                    <b>{m.subject}</b>
                    <small>
                      {m.to} · {new Date(m.at).toLocaleTimeString('ru-RU')}
                    </small>
                  </button>
                ))}
              </div>
              {cur && (
                <div className="dm-view">
                  <pre>{cur.text}</pre>
                  {code && (
                    <button
                      type="button"
                      className="btn sm pri"
                      disabled={!canUse}
                      title={canUse ? '' : 'Открой шаг «Подтверди почту»'}
                      onClick={() => onCode(code)}
                    >
                      Подставить код {code}
                    </button>
                  )}
                  {link && !code && (
                    <a className="btn sm pri" href={link}>
                      Открыть ссылку
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
