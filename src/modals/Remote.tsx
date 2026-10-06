import { useEffect, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { Switch } from '../components/ui/primitives'
import { bGit } from '../lib/backend'

type Info = { ok: boolean; name: string; url: string; upstream: string }
type Reply = { ok: boolean; reason?: string; heads?: number }

/** Подключение проекта к удалённому репозиторию (GitHub, GitLab…) и зеркалирование версий */
export function RemoteModal() {
  const p = useProject()!
  const st = useStore.getState
  const [info, setInfo] = useState<Info | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'drop'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    bGit<Info>('remote', p)
      .then((r) => {
        if (!live) return
        setInfo(r)
        setUrl(r.url)
        ref.current?.focus()
        ref.current?.select()
      })
      .catch((e) => live && setLoadErr((e as Error).message))
    return () => {
      live = false
    }
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind: 'test' | 'save') => {
    setBusy(kind)
    setMsg(null)
    try {
      const r = await bGit<Reply>(kind === 'test' ? 'remote-test' : 'remote-set', p, { url })
      if (!r.ok) setMsg({ ok: false, text: r.reason || 'Не получилось' })
      else if (kind === 'test')
        setMsg({
          ok: true,
          text: r.heads
            ? `Репозиторий доступен, веток: ${r.heads}.`
            : 'Репозиторий доступен (пока пустой — первый Push создаст ветку).',
        })
      else {
        toast({ title: 'Репозиторий подключён', desc: url.trim(), icon: 'git', tone: 'ok' })
        st().closeModal()
      }
    } catch (e) {
      setMsg({ ok: false, text: 'Нет связи с сервером: ' + (e as Error).message })
    } finally {
      setBusy('')
    }
  }
  const drop = async () => {
    setBusy('drop')
    try {
      await bGit('remote-remove', p)
      st().up((pp) => {
        pp.mirror = false
      })
      toast({ title: 'Репозиторий отключён', desc: 'Локальная история осталась.', icon: 'git' })
      st().closeModal()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy('')
    }
  }

  const connected = !!info?.name
  return (
    <Modal label="Удалённый репозиторий" busy={!!busy}>
      <MHead
        icon="link"
        title="Удалённый репозиторий"
        sub="GitHub, GitLab или свой сервер — копия проекта и его истории."
      />
      {loadErr ? (
        <div className="ferr">Не удалось прочитать настройки: {loadErr}</div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="rm-url">Адрес репозитория</label>
            <input
              id="rm-url"
              ref={ref}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setMsg(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim() && !busy) void run('save')
              }}
              placeholder="https://github.com/команда/проект.git"
              spellCheck={false}
              className={msg && !msg.ok ? 'bad' : ''}
              autoComplete="off"
            />
            {msg ? (
              <div className={msg.ok ? 'fhint rm-ok' : 'ferr'} role={msg.ok ? 'status' : 'alert'}>
                {msg.text}
              </div>
            ) : (
              <div className="fhint">
                Создай на GitHub пустой репозиторий и вставь его https-адрес. Логин и токен в адрес не
                вписывай: вход выполняет менеджер учётных данных Git.
              </div>
            )}
          </div>
          {connected && (
            <div className="rm-row">
              <div>
                <b>Зеркалировать версии</b>
                <div className="t4">После каждой новой версии автоматически отправлять коммиты (Push).</div>
              </div>
              <Switch
                on={!!p.mirror}
                onChange={(v) =>
                  st().up((pp) => {
                    pp.mirror = v
                  })
                }
                label="Зеркалировать версии"
              />
            </div>
          )}
          {connected && info?.upstream && (
            <div className="fhint">
              Ветка привязана к <code>{info.upstream}</code>.
            </div>
          )}
        </>
      )}
      <div className="mfoot">
        {connected && (
          <button className="btn gho" disabled={!!busy} onClick={() => void drop()}>
            Отключить
          </button>
        )}
        <span className="grow" />
        <button className="btn gho" onClick={() => st().closeModal()}>
          Закрыть
        </button>
        <button
          className="btn"
          disabled={!url.trim() || !!busy || !!loadErr}
          onClick={() => void run('test')}
        >
          <Icon
            name={busy === 'test' ? 'refresh' : 'check'}
            size={13}
            className={busy === 'test' ? 'spin' : ''}
          />
          Проверить
        </button>
        <button
          className="btn pri"
          disabled={!url.trim() || !!busy || !!loadErr}
          onClick={() => void run('save')}
        >
          <Icon name="link" size={13} />
          {connected ? 'Сохранить' : 'Подключить'}
        </button>
      </div>
    </Modal>
  )
}
