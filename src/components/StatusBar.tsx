import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useAccount } from '../lib/account'
import { useBackend } from '../lib/backend'
import { useGit } from '../lib/git'
import { report, fmtUsd } from '../lib/usage'
import { Icon } from './ui/Icon'
import { captureSyncHealth, syncHealthLabel, useSyncStatus } from '../lib/syncStatus'
import { retryProjectSync } from '../lib/sync'
import { useEdit } from '../lib/editstate'

/** Нижняя строка: связь с сервером, ветка git, расходы за месяц */
export function StatusBar() {
  const screen = useStore((s) => s.screen)
  const pid = useStore((s) => s.projectId)
  useBackend()
  useAccount()
  useSyncStatus()
  useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const g = useGit()
  const ed = useEdit()
  const [spent, setSpent] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => {
    const calc = () => {
      const s = useStore.getState()
      setSpent(report(s.projects, s.settings.priceCustom || {}).month.cost)
      tick((n) => n + 1)
    }
    calc()
    const t = setInterval(calc, 8000)
    return () => clearInterval(t)
  }, [pid])
  if (screen !== 'workspace' || !pid) return null
  const st = useStore.getState
  const budget = st().settings.budget
  const branch = g.pid === pid ? g.status : null
  const health = captureSyncHealth(pid)
  const conn = syncHealthLabel(health)
  return (
    <div className="sbar" role="status">
      <button
        className="sb-i"
        onClick={() => st().openModal({ type: 'settings', section: 'backend' })}
        title={conn.detail}
      >
        <i className={'sb-dot ' + conn.c} />
        {conn.text}
      </button>
      <span className="sb-i" title="Хранилище приложения и папка на диске подтверждаются отдельно">
        {health.checkpoint === 'confirmed'
          ? 'Checkpoint проекта подтверждён'
          : health.checkpoint === 'pending'
            ? 'Сохраняю checkpoint…'
            : health.checkpoint === 'failed'
              ? 'Checkpoint не сохранён'
              : 'В памяти · checkpoint не подтверждён'}
      </span>
      <button
        className="sb-i"
        disabled={!health.canRetry}
        onClick={() => void retryProjectSync(pid)}
        title={
          health.disk === 'unavailable' || health.disk === 'disabled'
            ? 'Повторить checkpoint в хранилище приложения; диск не подтверждается'
            : 'Повторить сверку без сброса baseline и recovery-копий'
        }
      >
        {health.disk === 'unavailable' || health.disk === 'disabled'
          ? 'Сохранить локально'
          : 'Повторить сверку'}
      </button>
      {ed.pid === pid && (ed.pending || ed.savedAt > 0) && (
        <span
          className={'sb-i sb-save' + (ed.pending ? ' pend' : '')}
          title="Автосохранение редактора в проект; checkpoint приложения и диск показаны отдельно"
        >
          <Icon name={ed.pending ? 'edit' : 'check'} size={12} />
          {ed.pending
            ? 'Изменения…'
            : 'В проекте ' +
              new Date(ed.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {branch && (
        <button
          className="sb-i"
          onClick={() => st().setRight({ rightOpen: true, rightTab: 'git' })}
          title="Открыть Git"
        >
          <Icon name="git" size={12} />
          {branch.branch}
          {branch.files.length > 0 && <b>{branch.files.length}</b>}
          {!!branch.ahead && <span>↑{branch.ahead}</span>}
          {!!branch.behind && <span>↓{branch.behind}</span>}
        </button>
      )}
      <span className="grow" />
      {spent > 0 && (
        <button
          className="sb-i"
          onClick={() => st().openModal({ type: 'settings', section: 'usage' })}
          title="Расходы на модели за месяц"
        >
          <Icon name="bolt" size={12} />
          {fmtUsd(spent)}
          {budget ? ` из ${fmtUsd(budget)}` : ''}
        </button>
      )}
    </div>
  )
}
