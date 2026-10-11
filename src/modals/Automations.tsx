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
import { fireAuto } from '../agent/autorun'

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
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all(list.map(async (a) => [a.id, await autoHash(p.id, a)] as const)).then(
      (x) => live && setHashes(Object.fromEntries(x)),
    )
    return () => {
      live = false
    }
  }, [list, p.id])

  const write = (t: string) => useStore.getState().writeFile(AUTO_FILE, t, p.id)
  const upd = (a: Auto, f: (r: Record<string, unknown>) => Record<string, unknown> | null) => {
    try {
      write(updateAutomation(text!, a.id, f))
    } catch (e) {
      toast({ title: 'Не получилось', desc: (e as Error).message, icon: 'warn', tone: 'warn' })
    }
  }
  const add = (rec: Record<string, unknown>) => {
    try {
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
