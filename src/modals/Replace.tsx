import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import type { Hit } from '../lib/replace'
import { replaceJob } from '../lib/replaceJob'
import { PROTECTED } from '../lib/paths'
import { plural } from '../lib/util'

const worker = () => new Worker(new URL('../lib/replace.worker.ts', import.meta.url), { type: 'module' })

/** Найти и заменить по всему проекту: предварительный список файлов, отмена одним кликом */
export function ReplaceModal({ find: f0 = '' }: { find?: string }) {
  const p = useProject()!
  const st = useStore.getState
  const [q, setQ] = useState(f0)
  const [r, setR] = useState('')
  const [regex, setRegex] = useState(false)
  const [cs, setCs] = useState(false)
  const [off, setOff] = useState<Record<string, boolean>>({})
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const input = useMemo(() => ({ pid: p.id, files: p.files, q, regex, cs }), [p.id, p.files, q, regex, cs])
  const [result, setResult] = useState<{ input: typeof input; hits: Hit[]; err: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const applying = useRef<ReturnType<typeof replaceJob> | null>(null)
  const res = result?.input === input ? result : { hits: [], err: '' }
  const searching = !!q && result?.input !== input
  useEffect(() => {
    let active = true
    setBusy(false)
    if (!input.q) {
      setResult({ input, hits: [], err: '' })
      return
    }
    const job = replaceJob(
      {
        files: Object.fromEntries(Object.entries(input.files).filter(([path]) => !PROTECTED.includes(path))),
        q: input.q,
        opts: { regex: input.regex, caseSensitive: input.cs },
      },
      worker,
    )
    job.promise.then(
      (reply) => {
        if (active) setResult({ input, hits: reply.hits, err: '' })
      },
      (e: Error) => {
        if (active) setResult({ input, hits: [], err: e.message })
      },
    )
    return () => {
      active = false
      job.cancel()
      applying.current?.cancel()
      applying.current = null
    }
  }, [input])
  // Cancels substitution as well when the modal closes (including an empty query).
  useEffect(() => () => applying.current?.cancel(), [])
  const chosen = res.hits.filter((h) => !off[h.path])
  const total = chosen.reduce((a, h) => a + h.count, 0)

  const apply = async () => {
    if (!chosen.length || busy || searching) return
    const pid = input.pid
    const snap = Object.fromEntries(chosen.map((h) => [h.path, input.files[h.path]]))
    setBusy(true)
    const job = replaceJob(
      { files: snap, q: input.q, replacement: r, opts: { regex: input.regex, caseSensitive: input.cs } },
      worker,
    )
    applying.current = job
    try {
      const reply = await job.promise
      if (applying.current !== job) return
      const current = st().projects.find((project) => project.id === pid)
      if (
        st().projectId !== pid ||
        !current ||
        Object.entries(snap).some(([path, text]) => current.files[path] !== text)
      ) {
        toast({ title: 'Файлы изменились — повтори поиск перед заменой', tone: 'warn', icon: 'warn' })
        return
      }
      Object.entries(reply.files).forEach(([path, text]) => st().writeFile(path, text, pid))
      st().closeModal()
      toast({
        title: `Заменено: ${total}`,
        desc: `в ${chosen.length} ${plural(chosen.length, ['файле', 'файлах', 'файлах'])}`,
        icon: 'check',
        tone: 'ok',
        action: {
          label: 'Отменить',
          run: () => {
            const now = st().projects.find((project) => project.id === pid)
            if (!now || Object.entries(reply.files).some(([path, text]) => now.files[path] !== text)) {
              toast({ title: 'Нельзя отменить: файлы уже изменены или удалены', tone: 'warn', icon: 'warn' })
              return
            }
            Object.entries(snap).forEach(([path, text]) => st().writeFile(path, text, pid))
            toast({ title: 'Замена отменена', icon: 'undo' })
          },
        },
      })
    } catch (e) {
      if (applying.current === job) toast({ title: (e as Error).message, tone: 'warn', icon: 'warn' })
    } finally {
      if (applying.current === job) {
        applying.current = null
        setBusy(false)
      }
    }
  }
  return (
    <Modal label="Найти и заменить" wide>
      <MHead icon="search" title="Найти и заменить" sub="По всем файлам проекта, кроме защищённого env." />
      <div className="field">
        <label>Найти</label>
        <input
          ref={ref}
          className={res.err ? 'bad' : ''}
          value={q}
          disabled={busy}
          onChange={(e) => setQ(e.target.value)}
          placeholder={regex ? 'Регулярное выражение' : 'Текст'}
          spellCheck={false}
        />
        {res.err && <div className="ferr">{res.err}</div>}
      </div>
      <div className="field">
        <label>Заменить на</label>
        <input
          value={r}
          disabled={busy}
          onChange={(e) => setR(e.target.value)}
          placeholder="Пусто — удалить найденное"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply()
          }}
        />
        {regex && <div className="fhint">В замене работают группы: $1, $2, $&amp;.</div>}
      </div>
      <div className="rp-opts">
        <label>
          <input type="checkbox" disabled={busy} checked={cs} onChange={(e) => setCs(e.target.checked)} />
          Учитывать регистр
        </label>
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
          />
          Регулярное выражение
        </label>
      </div>
      <div className="rp-list" role={q && !res.err && res.hits.length ? 'list' : undefined}>
        {!q ? (
          <div className="rp-none">Введи, что искать — покажу файлы до замены.</div>
        ) : searching ? (
          <div className="rp-none" role="status">
            Ищу…
          </div>
        ) : res.err ? null : res.hits.length === 0 ? (
          <div className="rp-none">Ничего не найдено.</div>
        ) : (
          res.hits.map((h) => (
            <label key={h.path} className="rp-row" role="listitem">
              <input
                type="checkbox"
                disabled={busy}
                checked={!off[h.path]}
                onChange={() => setOff((o) => ({ ...o, [h.path]: !o[h.path] }))}
              />
              <span className="rp-f">
                <b>{h.path}</b>
                <em>
                  {h.line}: {h.text}
                </em>
              </span>
              <span className="t4">{h.count}</span>
            </label>
          ))
        )}
      </div>
      <div className="mfoot">
        <span className="t4" style={{ fontSize: 12 }}>
          {res.hits.length >= 500 ? 'Показаны первые 500 файлов' : ''}
        </span>
        <span className="grow" />
        <button className="btn gho" onClick={() => st().closeModal()}>
          Отмена
        </button>
        <button
          className="btn pri"
          disabled={!chosen.length || busy || searching}
          onClick={() => void apply()}
        >
          <Icon name="check" size={13} />
          {busy
            ? 'Заменяю…'
            : chosen.length
              ? `Заменить ${total} в ${chosen.length} ${plural(chosen.length, ['файле', 'файлах', 'файлах'])}`
              : 'Заменить'}
        </button>
      </div>
    </Modal>
  )
}
