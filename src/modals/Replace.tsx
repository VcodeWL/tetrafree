import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { findHits, replaceIn } from '../lib/replace'
import { PROTECTED } from '../lib/paths'
import { plural } from '../lib/util'

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

  const res = useMemo(() => {
    if (!q) return { hits: [], err: '' }
    try {
      return {
        hits: findHits(p.files, q, { regex, caseSensitive: cs }, (x) => PROTECTED.includes(x)),
        err: '',
      }
    } catch (e) {
      return { hits: [], err: (e as Error).message }
    }
  }, [p.files, q, regex, cs])
  const chosen = res.hits.filter((h) => !off[h.path])
  const total = chosen.reduce((a, h) => a + h.count, 0)

  const apply = () => {
    if (!chosen.length) return
    const pid = p.id
    const snap: Record<string, string> = {}
    chosen.forEach((h) => {
      snap[h.path] = p.files[h.path]
    })
    chosen.forEach((h) =>
      st().writeFile(h.path, replaceIn(p.files[h.path], q, r, { regex, caseSensitive: cs }), pid),
    )
    st().closeModal()
    toast({
      title: `Заменено: ${total}`,
      desc: `в ${chosen.length} ${plural(chosen.length, ['файле', 'файлах', 'файлах'])}`,
      icon: 'check',
      tone: 'ok',
      action: {
        label: 'Отменить',
        run: () => {
          if (st().projectId !== pid) return
          Object.entries(snap).forEach(([path, c]) => st().writeFile(path, c, pid))
          toast({ title: 'Замена отменена', icon: 'undo' })
        },
      },
    })
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
          <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} />
          Учитывать регистр
        </label>
        <label>
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
          Регулярное выражение
        </label>
      </div>
      <div className="rp-list" role={q && !res.err && res.hits.length ? 'list' : undefined}>
        {!q ? (
          <div className="rp-none">Введи, что искать — покажу файлы до замены.</div>
        ) : res.err ? null : res.hits.length === 0 ? (
          <div className="rp-none">Ничего не найдено.</div>
        ) : (
          res.hits.map((h) => (
            <label key={h.path} className="rp-row" role="listitem">
              <input
                type="checkbox"
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
        <button className="btn pri" disabled={!chosen.length} onClick={apply}>
          <Icon name="check" size={13} />
          {chosen.length
            ? `Заменить ${total} в ${chosen.length} ${plural(chosen.length, ['файле', 'файлах', 'файлах'])}`
            : 'Заменить'}
        </button>
      </div>
    </Modal>
  )
}
