import { useEffect, useMemo, useState } from 'react'
import { useProject, useStore } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { bGit } from '../lib/backend'
import { ago } from '../lib/util'

interface Row {
  hash: string
  line: number
  author: string
  at: number
  summary: string
  text: string
}
const ZERO = /^0+$/
const hue = (h: string) => parseInt(h.slice(0, 6), 16) % 360

/** Авторство строк файла (git blame): подряд идущие строки одного коммита сгруппированы */
export function BlameModal({ path }: { path: string }) {
  const p = useProject()!
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    bGit<{ ok: boolean; rows?: Row[]; reason?: string }>('blame', p, { path })
      .then((r) => {
        if (!live) return
        if (r.ok && r.rows) setRows(r.rows)
        else setErr(r.reason || 'Не получилось')
      })
      .catch((e) => live && setErr((e as Error).message))
    return () => {
      live = false
    }
  }, [p.id, path]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g: { hash: string; rows: Row[] }[] = []
    for (const r of rows || []) {
      const last = g[g.length - 1]
      if (last && last.hash === r.hash) last.rows.push(r)
      else g.push({ hash: r.hash, rows: [r] })
    }
    return g
  }, [rows])
  const st = useStore.getState
  return (
    <Modal label="Авторство строк" wide>
      <MHead icon="git" title="Кто менял" sub={path} />
      <div className="blame">
        {err ? (
          <div className="muted" style={{ padding: 24 }}>
            {err}
          </div>
        ) : !rows ? (
          <div className="muted" style={{ padding: 24 }}>
            Читаю историю…
          </div>
        ) : (
          groups.map((g, i) => {
            const f = g.rows[0],
              fresh = ZERO.test(g.hash)
            return (
              <div key={i} className="bl-g" style={{ ['--h' as string]: fresh ? 0 : hue(g.hash) }}>
                <div className={'bl-m' + (fresh ? ' new' : '')}>
                  <b>{fresh ? 'Не закоммичено' : f.author}</b>
                  <span>{fresh ? 'правки на диске' : `${g.hash.slice(0, 7)} · ${ago(f.at * 1000)}`}</span>
                  {!fresh && (
                    <span className="bl-sum" title={f.summary}>
                      {f.summary}
                    </span>
                  )}
                </div>
                <pre className="bl-c">
                  {g.rows.map((r) => (
                    <div key={r.line}>
                      <i>{r.line}</i>
                      {r.text || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )
          })
        )}
      </div>
      <div className="mfoot" style={{ padding: '10px 18px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={() => st().closeModal()}>
          Закрыть
        </button>
      </div>
    </Modal>
  )
}
