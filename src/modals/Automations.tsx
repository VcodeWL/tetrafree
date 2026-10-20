/* Настройки → Автоматизации: «когда случилось X — сделай Y». Формат файла и правила — в agent/automations.ts. */
import { useEffect, useMemo, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon } from '../components/ui/Icon'
import { TIERS, type Tier } from '../types'
import {
  AUTO_FILE,
  EXAMPLES,
  parseAutomations,
  addAutomation,
  updateAutomation,
  describeWhen,
  describeDo,
  autoHash,
  setApproved,
  useAutos,
  parseEvery,
  type Auto,
} from '../agent/automations'
import { fireAuto, retryAutomation } from '../agent/autorun'
import { AutomationControls } from '../agent/AutomationControls'
import { useAutomationControl, setAutomationNotifications } from '../agent/automationControl'
import { useAutomationJournal, automationIdentity, runReasonText } from '../agent/automationJournal'

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60
    ? 'только что'
    : s < 3600
      ? `${Math.round(s / 60)} мин назад`
      : s < 86400
        ? `${Math.round(s / 3600)} ч назад`
        : `${Math.round(s / 86400)} дн назад`
}

export function Automations() {
  const p = useProject()!
  const text = p.files[AUTO_FILE]
  const { list, errors } = useMemo(() => parseAutomations(text), [text])
  const approved = useAutos((s) => s.approved)
  const runs = useAutos((s) => s.runs)
  const journal = useAutomationJournal()
  const notifications = useAutomationControl((s) => s.notifications)
  const [projectIdentity, setProjectIdentity] = useState('')
  const [identities, setIdentities] = useState<Record<string, string>>({})
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let live = true
    setHashes({})
    setProjectIdentity('')
    void automationIdentity(p.id, '')
      .then((identity) => {
        if (live) setProjectIdentity(identity)
      })
      .catch(() => {})
    setIdentities({})
    void Promise.all(
      list.map(async (a) => [a.id, await autoHash(p.id, a), await automationIdentity(p.id, a.id)] as const),
    )
      .then((rows) => {
        if (live) {
          setHashes(Object.fromEntries(rows.map(([id, hash]) => [id, hash])))
          setIdentities(Object.fromEntries(rows.map(([id, , identity]) => [id, identity])))
        }
      })
      .catch(() => {
        if (live) setHashes({})
      })
    return () => {
      live = false
    }
  }, [list, p.id])

  const write = (t: string) => useStore.getState().writeFile(AUTO_FILE, t, p.id)
  const upd = (a: Auto, f: (r: Record<string, unknown>) => Record<string, unknown> | null) => {
    try {
      const st = useStore.getState()
      const latest = st.projects.find((x) => x.id === p.id)?.files[AUTO_FILE]
      if (st.projectId !== p.id || latest !== text)
        throw new Error('Настройки изменились. Повтори действие с актуальной версией.')
      write(updateAutomation(latest!, a.id, f))
    } catch (e) {
      toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    }
  }
  const add = (rec: Record<string, unknown>) => {
    try {
      const st = useStore.getState()
      if (st.projectId !== p.id || st.projects.find((x) => x.id === p.id)?.files[AUTO_FILE] !== text)
        throw new Error('Настройки изменились. Повтори действие с актуальной версией.')
      write(addAutomation(text, rec))
      setAdding(false)
      toast({
        title: 'Автоматизация добавлена',
        desc: 'Пока она не разрешена, она не работает.',
        icon: 'check',
      })
    } catch (e) {
      toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    }
  }
  const runNow = async (a: Auto) => {
    const r = await fireAuto(
      p.id,
      a,
      { files: ['(запуск вручную)'], task: '(запуск вручную)' },
      'запуск вручную',
    )
    toast({
      title: r.ok ? `Запущено: ${a.name}` : `Не запущено: ${a.name}`,
      desc: r.note,
      icon: r.ok ? 'check' : 'warn',
      tone: r.ok ? undefined : 'warn',
    })
  }

  return (
    <>
      <h2>Автоматизации</h2>
      <AutomationControls />
      <label className="dim">
        <input
          type="checkbox"
          checked={notifications}
          onChange={(e) => setAutomationNotifications(e.target.checked)}
        />{' '}
        Уведомлять об итогах автоматизаций (без содержимого проекта)
      </label>
      <p className="sd">
        Расходы — оценка, не счёт провайдера. Лимиты используют консервативный резерв перед каждым запросом:
        он может быть выше фактической оценки. Неизвестный тариф блокирует запрос только при настроенном
        лимите. Без тарифа гарантировать расходы нельзя.
      </p>
      {journal.unavailable && (
        <div className="ext-note bad" role="alert">
          Журнал не удалось прочитать или сохранить. Новые запуски заблокированы; исходная запись не
          заменяется.
        </div>
      )}
      <p className="sd">
        «Когда случилось X — сделай Y»: по расписанию, при изменении файлов, при смене статуса задачи, при
        открытии проекта. Хранятся в <code>.tetra/automations.json</code> и едут вместе с проектом. Работают,
        пока TetraFree открыт и этот проект выбран.
      </p>
      {errors.map((e) => (
        <div className="ext-note bad" key={e}>
          {e}
        </div>
      ))}
      <section aria-label="История автоматизаций">
        <h3>История запусков</h3>
        <p className="dim">
          До 100 последних запусков. Запросы, файлы и тексты ошибок в этот журнал не записываются. Повтор —
          только вручную по неизменённой разрешённой конфигурации; события файлов и задач не воспроизводятся.
        </p>
        {journal.runs
          .filter((r) => r.project === projectIdentity)
          .slice(0, 30)
          .map((r) => {
            const a = list.find((x) => identities[x.id] === r.identity)
            return (
              <div className="ext-card" key={r.id}>
                <b>{a?.name || 'Автоматизация'}</b> · {new Date(r.at).toLocaleString('ru-RU')} ·{' '}
                {r.outcome === 'running' ? 'Работает' : runReasonText[r.reason]}
                <div className="dim">
                  Модель: {r.model}. Оценка:{' '}
                  {r.estimate === null
                    ? 'недостаточно данных — расходы неизвестны'
                    : `$${r.estimate.toFixed(4)}`}
                  . Консервативный резерв: ${r.reserved.toFixed(4)}.
                </div>
                {r.outcome !== 'running' && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Повторить актуальную разрешённую автоматизацию? Это новый запуск: контекст и файлы из прежнего запуска не сохранялись.',
                        )
                      )
                        return
                      void retryAutomation(p.id, r.id).then((result) =>
                        toast({
                          title: result.ok ? 'Повтор запущен' : 'Повтор не запущен',
                          desc: result.note,
                          tone: result.ok ? undefined : 'warn',
                        }),
                      )
                    }}
                  >
                    Повторить вручную…
                  </button>
                )}
              </div>
            )
          })}
        {!journal.runs.some((r) => r.project === projectIdentity) && (
          <p className="dim">В этом проекте ещё нет запусков текущих автоматизаций.</p>
        )}
      </section>
      {list.map((a) => {
        const h = hashes[a.id]
        const ok = !!h && !!approved[h]
        const info = runs[p.id + ':' + a.id]
        return (
          <div className="ext-card" key={a.id}>
            <div className="ec-h">
              <Icon name="bolt" size={15} />
              <b>{a.name}</b>
              {!a.enabled ? (
                <span className="ec-tag off">выключена</span>
              ) : ok ? (
                <span className="ec-tag ok">{info?.running ? 'разрешена · работает' : 'разрешена'}</span>
              ) : (
                <span className="ec-tag warn">не разрешена</span>
              )}
            </div>
            <div className="dim">
              <b>Когда:</b> {describeWhen(a.when)}
            </div>
            <div className="dim">
              <b>Что:</b> {describeDo(a.do)}
            </div>
            {'agent' in a.do && (
              <div className="ec-act">
                <BudgetLimit
                  label="Лимит на запуск, USD"
                  value={a.costLimit}
                  onCommit={(value) => upd(a, (r) => withLimit(r, 'costLimit', value))}
                />
                <BudgetLimit
                  label="Лимит на месяц, USD"
                  value={a.monthlyLimit}
                  onCommit={(value) => upd(a, (r) => withLimit(r, 'monthlyLimit', value))}
                />
              </div>
            )}
            {info?.last && (
              <div className="dim">
                Последний раз: {ago(info.last.at)} — {info.last.note}
              </div>
            )}
            {confirm === a.id && (
              <div className="ext-note warn">
                {'agent' in a.do ? (
                  <>
                    Агент будет сам получать этот запрос <b>без твоего участия</b> на уровне «{a.do.tier}»
                    {a.do.tier === 'Тихо' || a.do.tier === 'Уведомить'
                      ? ' — он сможет менять файлы и запускать команды сам'
                      : ' — правки и команды будут ждать твоего решения'}
                    . Это расходует токены модели. Разрешай, только если доверяешь автору файла. Изменишь
                    автоматизацию — разрешение сбросится.
                  </>
                ) : (
                  <>Автоматизация будет срабатывать сама. Изменишь её — разрешение сбросится.</>
                )}
                <div className="ec-act">
                  <button
                    className="btn sm pri"
                    onClick={() => {
                      const st = useStore.getState()
                      if (
                        st.projectId !== p.id ||
                        st.projects.find((x) => x.id === p.id)?.files[AUTO_FILE] !== text
                      ) {
                        setConfirm('')
                        return toast({ title: 'Настройки изменились. Проверь их заново.', tone: 'warn' })
                      }
                      setApproved(h, true)
                      setConfirm('')
                    }}
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
              {ok ? (
                <>
                  <button className="btn sm" onClick={() => void runNow(a)}>
                    Запустить сейчас
                  </button>
                  <button className="btn sm gho" onClick={() => setApproved(h, false)}>
                    Отозвать
                  </button>
                </>
              ) : (
                a.enabled && (
                  <button className="btn sm pri" onClick={() => setConfirm(a.id)}>
                    Разрешить…
                  </button>
                )
              )}
              <button className="btn sm gho" onClick={() => upd(a, (r) => ({ ...r, enabled: !a.enabled }))}>
                {a.enabled ? 'Выключить' : 'Включить'}
              </button>
              <button className="btn sm gho" onClick={() => upd(a, () => null)}>
                Удалить
              </button>
            </div>
          </div>
        )
      })}
      {!list.length && !errors.length && !adding && (
        <div className="ext-note">Автоматизаций пока нет. Добавь свою или начни с примера ниже.</div>
      )}
      {adding ? (
        <AddForm onAdd={add} onCancel={() => setAdding(false)} />
      ) : (
        <div className="ec-act">
          <button className="btn sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Добавить автоматизацию
          </button>
          {p.files[AUTO_FILE] !== undefined && (
            <button
              className="btn sm gho"
              onClick={() => {
                useStore.getState().openFile(AUTO_FILE)
                useStore.getState().closeModal()
              }}
            >
              Открыть файл
            </button>
          )}
        </div>
      )}
      <div className="set-sub">Примеры</div>
      {EXAMPLES.map((e) => (
        <div className="ext-card" key={e.title}>
          <div className="ec-row">
            <b>{e.title}</b>
            <span className="grow" style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => add(e.rec)}>
              Добавить
            </button>
          </div>
        </div>
      ))}
      <div className="ext-note">
        Защита от петель: одна автоматизация срабатывает не чаще 20 раз в час, а правки файлов, сделанные её
        же агентом, повторный запуск не вызывают. В запросе агенту можно использовать{' '}
        <code>{'{{files}}'}</code>, <code>{'{{task}}'}</code>, <code>{'{{now}}'}</code>,{' '}
        <code>{'{{project}}'}</code>.
      </div>
    </>
  )
}

type TrigKind = 'every' | 'daily' | 'files' | 'task' | 'open' | 'manual'
function AddForm({ onAdd, onCancel }: { onAdd: (r: Record<string, unknown>) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [tk, setTk] = useState<TrigKind>('every')
  const [tv, setTv] = useState('30m')
  const [ak, setAk] = useState<'agent' | 'notify' | 'task'>('agent')
  const [av, setAv] = useState('')
  const [tier, setTier] = useState<Tier>('Спросить')
  const [err, setErr] = useState('')
  const hint: Record<TrigKind, string> = {
    every: 'например 30m или 2h',
    daily: 'время, например 09:00',
    files: 'маска, например src/**/*.ts',
    task: 'backlog, doing, review или done',
    open: '',
    manual: '',
  }
  const submit = () => {
    const when: Record<string, unknown> =
      tk === 'open' || tk === 'manual' ? { [tk]: true } : { [tk]: tv.trim() }
    const rec: Record<string, unknown> = {
      name: name.trim(),
      when,
      do: ak === 'agent' ? { agent: av.trim(), tier } : { [ak]: av.trim() },
    }
    const chk = parseAutomations(JSON.stringify({ automations: [rec] }))
    if (chk.errors.length) return setErr(chk.errors[0])
    if (tk === 'every' && !parseEvery(tv)) return setErr('Период — например 30m')
    onAdd(rec)
  }
  return (
    <form
      className="ext-card"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        className="inp"
        autoFocus
        placeholder="Название"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Название"
      />
      <div className="ec-row">
        <select
          className="sel"
          value={tk}
          onChange={(e) => setTk(e.target.value as TrigKind)}
          aria-label="Когда"
        >
          <option value="every">Каждые…</option>
          <option value="daily">Каждый день в…</option>
          <option value="files">При изменении файлов</option>
          <option value="task">Когда задача перешла в…</option>
          <option value="open">При открытии проекта</option>
          <option value="manual">Только вручную</option>
        </select>
        {tk !== 'open' && tk !== 'manual' && (
          <input
            className="inp"
            placeholder={hint[tk]}
            value={tv}
            onChange={(e) => setTv(e.target.value)}
            aria-label="Значение условия"
          />
        )}
      </div>
      <div className="ec-row">
        <select
          className="sel"
          value={ak}
          onChange={(e) => setAk(e.target.value as 'agent' | 'notify' | 'task')}
          aria-label="Что сделать"
        >
          <option value="agent">Попросить агента</option>
          <option value="notify">Показать уведомление</option>
          <option value="task">Создать задачу</option>
        </select>
        {ak === 'agent' && (
          <select
            className="sel"
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            aria-label="Уровень автономности"
          >
            {TIERS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <textarea
        className="inp"
        rows={3}
        placeholder={
          ak === 'agent'
            ? 'Запрос агенту. Можно {{files}}, {{task}}, {{now}}'
            : ak === 'notify'
              ? 'Текст уведомления'
              : 'Заголовок задачи'
        }
        value={av}
        onChange={(e) => setAv(e.target.value)}
        aria-label="Текст действия"
      />
      {err && <div className="ext-note bad">{err}</div>}
      <div className="ec-act">
        <button className="btn sm pri" type="submit">
          Добавить
        </button>
        <button className="btn sm gho" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}

function withLimit(raw: Record<string, unknown>, field: string, value: number | undefined) {
  const next = { ...raw }
  if (value === undefined) delete next[field]
  else next[field] = value
  return next
}
function BudgetLimit({
  label,
  value,
  onCommit,
}: {
  label: string
  value?: number
  onCommit: (value: number | undefined) => void
}) {
  return (
    <label>
      {label}{' '}
      <input
        className="inp"
        type="number"
        min="0.001"
        step="0.01"
        key={String(value)}
        defaultValue={value ?? ''}
        onBlur={(e) => {
          const text = e.currentTarget.value
          if (text === String(value ?? '')) return
          const amount = Number(text)
          if (text && (!Number.isFinite(amount) || amount <= 0)) {
            toast({ title: 'Нужен положительный лимит USD', tone: 'warn' })
            return
          }
          onCommit(text ? amount : undefined)
        }}
      />
    </label>
  )
}
