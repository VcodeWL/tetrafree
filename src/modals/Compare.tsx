import { useMemo, useState } from 'react'
import { useStore, useProject } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import { diffLines } from '../lib/diff'

/** Сравнение двух файлов проекта: построчный дифф с нумерацией */
export function CompareModal({ a: a0, b: b0 }: { a?: string; b?: string }) {
  const p = useProject()!
  const files = useMemo(() => Object.keys(p.files).sort(), [p.files])
  const [a, setA] = useState(a0 && a0 in p.files ? a0 : files[0] || '')
  const [b, setB] = useState(b0 && b0 in p.files ? b0 : files.find((f) => f !== a) || '')
  const [only, setOnly] = useState(true)
  const rows = useMemo(() => {
    if (!a || !b) return []
    const full = diffLines(p.files[a] ?? '', p.files[b] ?? '')
    let na = 0,
      nb = 0
    const nums = full.map((l) => ({ ...l, ia: l.t !== '+' ? ++na : 0, ib: l.t !== '-' ? ++nb : 0 }))
    if (!only) return nums
    const keep = new Set<number>()
    nums.forEach((l, i) => {
      if (l.t !== ' ')
        for (let k = Math.max(0, i - 3); k <= Math.min(nums.length - 1, i + 3); k++) keep.add(k)
    })
    const out: ((typeof nums)[number] | { t: 'gap'; s: string })[] = []
    let skip = 0
    nums.forEach((l, i) => {
      if (keep.has(i)) {
        if (skip) out.push({ t: 'gap', s: `… ${skip} без изменений` })
        skip = 0
        out.push(l)
      } else skip++
    })
    if (skip && out.length) out.push({ t: 'gap', s: `… ${skip} без изменений` })
    return out
  }, [p.files, a, b, only])
  const add = rows.filter((r) => r.t === '+').length,
    del = rows.filter((r) => r.t === '-').length
  const same = a && b && p.files[a] === p.files[b]
  const sel = (v: string, set: (x: string) => void, label: string) => (
    <select className="sel" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
      {files.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  )
  return (
    <Modal label="Сравнение файлов" wide>
      <MHead icon="layers" title="Сравнение файлов" sub="Минус — есть только слева, плюс — только справа." />
      <div className="cmp-pick">
        {sel(a, setA, 'Левый файл')}
        <button
          className="iconbtn"
          title="Поменять местами"
          aria-label="Поменять местами"
          onClick={() => {
            setA(b)
            setB(a)
          }}
        >
          <Icon name="sort" size={15} />
        </button>
        {sel(b, setB, 'Правый файл')}
      </div>
      <div className="cmp-bar">
        <label>
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          Только отличия
        </label>
        <span className="grow" />
        {!same && (
          <span className="diff-stat">
            <span className="add">+{add}</span>
            <span className="del">−{del}</span>
          </span>
        )}
      </div>
      <div className="cmp-view">
        {!files.length ? (
          <div className="git-none">В проекте нет файлов.</div>
        ) : a === b ? (
          <div className="git-none">Выбран один и тот же файл — выбери другой справа.</div>
        ) : same ? (
          <div className="git-none">Файлы совпадают.</div>
        ) : (
          <div className="gdtab" role="table">
            {rows.map((r, i) =>
              'ia' in r ? (
                <div key={i} className={'gdr ' + (r.t === '+' ? 'add' : r.t === '-' ? 'del' : 'ctx')}>
                  <span className="gdn">{r.ia || ''}</span>
                  <span className="gdn">{r.ib || ''}</span>
                  <span className="gdm">{r.t === '+' ? '+' : r.t === '-' ? '−' : ''}</span>
                  <span className="gdt">{r.s || ' '}</span>
                </div>
              ) : (
                <div key={i} className="gdr hunk">
                  <span className="gdt" style={{ paddingLeft: 66 }}>
                    {r.s}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <div className="mfoot">
        <span className="grow" />
        <button className="btn gho" onClick={() => useStore.getState().closeModal()}>
          Закрыть
        </button>
      </div>
    </Modal>
  )
}
