import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import {
  api,
  ApiError,
  clearInvite,
  logout,
  useAccount,
  type InviteInfo,
  type MyInvite,
} from '../lib/account'
import { acceptInvite, declineInvite } from '../lib/team'
import { ago } from '../lib/util'

/** Открыли ссылку-приглашение из письма: принять / отклонить */
export function InviteGate() {
  const token = useAccount((a) => a.inviteToken)
  const authed = useStore((s) => s.authed)
  const user = useAccount((a) => a.user)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'a' | 'd' | null>(null)
  useEffect(() => {
    if (!token || !authed || !user) return
    setErr('')
    setInfo(null)
    api<InviteInfo>('GET', '/api/invites/' + encodeURIComponent(token))
      .then(setInfo)
      .catch((e: ApiError) => setErr(e.message))
  }, [token, authed, user?.id]) // eslint-disable-line
  if (!token || !authed || !user) return null
  const mismatch = info && info.email.toLowerCase() !== user.email.toLowerCase()
  const accept = async () => {
    setBusy('a')
    try {
      const id = await acceptInvite(token)
      useStore.getState().openProject(id)
      useStore.getState().toast({
        title: `Ты в проекте «${info?.projectName}»`,
        desc: 'Файлы, задачи и чаты загружены из облака',
        icon: 'check',
        tone: 'ok',
      })
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }
  const decline = async () => {
    setBusy('d')
    try {
      await declineInvite(token)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }
  return (
    <Modal onClose={() => clearInvite()} busy={!!busy} label="Приглашение в проект">
      <button className="iconbtn mclose" onClick={() => clearInvite()} aria-label="Закрыть">
        <Icon name="x" size={16} />
      </button>
      <h2>
        <span className="mi">
          <Icon name="mail" size={17} />
        </span>
        Приглашение в проект
      </h2>
      {!info && !err && <p className="sd">Загружаю приглашение…</p>}
      {err && (
        <div className="auth-err" role="alert">
          <Icon name="warn" size={14} />
          {err}
        </div>
      )}
      {info && (
        <>
          <p className="sd">
            <b>{info.by}</b> приглашает тебя в проект <b>«{info.projectName}»</b>. Ты получишь файлы, задачи,
            документы и чаты и сможешь работать вместе с командой и агентами.
          </p>
          {info.status !== 'pending' && (
            <div className="auth-err">
              <Icon name="warn" size={14} />
              {info.status === 'expired'
                ? 'Срок приглашения истёк — попроси отправить новое.'
                : info.status === 'accepted'
                  ? 'Приглашение уже принято.'
                  : 'Приглашение отозвано или отклонено.'}
            </div>
          )}
          {mismatch && (
            <div className="auth-err">
              <Icon name="warn" size={14} />
              Приглашение выписано на {info.emailMasked}, а ты вошёл как {user.email}. Войди в нужный аккаунт.
            </div>
          )}
          <div className="mfoot">
            {mismatch ? (
              <button className="btn pri" onClick={() => void logout()}>
                <Icon name="logout" size={14} />
                Сменить аккаунт
              </button>
            ) : (
              <>
                <button className="btn" disabled={!!busy || info.status !== 'pending'} onClick={decline}>
                  Отклонить
                </button>
                <button className="btn pri" disabled={!!busy || info.status !== 'pending'} onClick={accept}>
                  {busy === 'a' ? <span className="bspin" /> : <Icon name="check" size={14} />}Принять
                  приглашение
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

/** Входящие приглашения на лаунчере */
export function InviteCards() {
  const invites = useAccount((a) => a.invites)
  const [busy, setBusy] = useState('')
  if (!invites.length) return null
  const act = async (i: MyInvite, ok: boolean) => {
    setBusy(i.id)
    try {
      if (ok) {
        const id = await acceptInvite(i.id)
        useStore.getState().openProject(id)
      } else await declineInvite(i.id)
    } catch (e) {
      useStore
        .getState()
        .toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    }
    setBusy('')
  }
  return (
    <div className="inv-cards">
      {invites.map((i) => (
        <div className="inv-card" key={i.id}>
          <span className="ic">
            <Icon name="mail" size={16} />
          </span>
          <div className="ix">
            <b>{i.by.name}</b> зовёт тебя в «{i.projectName}»
            <small>
              {ago(i.at)} · действует до {new Date(i.exp).toLocaleDateString('ru-RU')}
            </small>
          </div>
          <button className="btn sm" disabled={busy === i.id} onClick={() => void act(i, false)}>
            Отклонить
          </button>
          <button className="btn sm pri" disabled={busy === i.id} onClick={() => void act(i, true)}>
            Принять
          </button>
        </div>
      ))}
    </div>
  )
}
