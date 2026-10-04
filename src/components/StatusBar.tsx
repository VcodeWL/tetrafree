import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useBackend } from '../lib/backend'
import { useGit } from '../lib/git'
import { report, fmtUsd } from '../lib/usage'
import { Icon } from './ui/Icon'
import { ago } from '../lib/util'
import { useEdit } from '../lib/editstate'

/** Нижняя строка: связь с сервером, ветка git, расходы за месяц */
export function StatusBar() {
  const screen = useStore((s) => s.screen)
  const pid = useStore((s) => s.projectId)
  const b = useBackend()
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
  const conn =
    b.status === 'online'
      ? b.lastError
        ? { c: 'err', t: 'ошибка синхронизации', title: b.lastError }
        : b.syncing
          ? { c: 'sync', t: 'синхронизация…', title: '' }
          : {
              c: 'ok',
              t: b.lastSync ? 'синхронизировано ' + ago(b.lastSync) : 'сервер на связи',
              title: 'Файлы проекта совпадают с папкой на диске',
            }
      : b.status === 'checking'
        ? { c: 'sync', t: 'проверяю сервер…', title: '' }
        : {
            c: 'off',
            t: 'только в браузере',
            title: 'Локальный сервер не запущен: нет диска, git и терминала',
          }
  return (
    <div className="sbar" role="status">
      <button
        className="sb-i"
        onClick={() => st().openModal({ type: 'settings', section: 'backend' })}
        title={conn.title || 'Настройки сервера'}
      >
        <i className={'sb-dot ' + conn.c} />
        {conn.t}
      </button>
      {(ed.pending || ed.savedAt > 0) && (
        <span className={'sb-i sb-save' + (ed.pending ? ' pend' : '')} title={ed.file}>
          <Icon name={ed.pending ? 'edit' : 'check'} size={12} />
          {ed.pending
            ? 'Изменения…'
            : 'Сохранено ' +
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
