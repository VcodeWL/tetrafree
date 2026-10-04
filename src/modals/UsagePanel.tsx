import { useMemo, useState } from 'react'
import { useStore, useProject } from '../store'
import { report, fmtUsd, priceFor, type Price, type Sum } from '../lib/usage'
import { plural } from '../lib/util'

const tok = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

/** Настройки → Расходы: токены и стоимость по месяцу, проектам и чатам, лимит и цены моделей */
export function UsagePanel() {
  const s = useStore((x) => x.settings)
  const set = useStore((x) => x.setSetting)
  const projects = useStore((x) => x.projects)
  const project = useProject()
  const custom = useMemo(() => s.priceCustom || {}, [s.priceCustom])
  const r = useMemo(() => report(projects, custom, Date.now(), project?.id), [projects, custom, project?.id])
  const [lim, setLim] = useState(s.budget ? String(s.budget) : '')
  const limN = Number(lim.replace(',', '.'))
  const limBad = lim.trim() !== '' && (!isFinite(limN) || limN < 0)
  const saveLim = () => {
    if (!limBad) set('budget', lim.trim() === '' || limN === 0 ? undefined : limN)
  }
  const pct = s.budget ? Math.min(100, (r.month.cost / s.budget) * 100) : 0
  const setPrice = (mid: string, k: keyof Price, v: string) => {
    const n = Number(v.replace(',', '.'))
    const cur = custom[mid] || priceFor(mid) || { inp: 0, out: 0 }
    if (v.trim() === '') {
      const { [mid]: _d, ...rest } = custom
      void _d
      set('priceCustom', Object.keys(rest).length ? rest : undefined)
      return
    }
    if (!isFinite(n) || n < 0) return
    set('priceCustom', { ...custom, [mid]: { ...cur, [k]: n } })
  }
  const now = new Date()
  const row = (key: string, name: string, m: Sum, a: Sum) => (
    <tr key={key}>
      <td className="un">{name}</td>
      <td>{fmtUsd(m.cost)}</td>
      <td>{tok(m.inTok + m.outTok)}</td>
      <td className="t4">{fmtUsd(a.cost)}</td>
    </tr>
  )
  return (
    <>
      <h2>Расходы</h2>
      <p className="sd">
        Токены считаются по длине текста, цены — справочные. Для точных сумм смотри счёт провайдера.
        Демо-режим и локальные модели бесплатны и в сумму не входят.
      </p>

      <div className="usum">
        <div>
          <div className="un-l">{MONTHS[now.getMonth()]}</div>
          <div className="un-v">{fmtUsd(r.month.cost)}</div>
        </div>
        <div>
          <div className="un-l">токенов</div>
          <div className="un-v">{tok(r.month.inTok + r.month.outTok)}</div>
        </div>
        <div>
          <div className="un-l">{plural(r.month.turns, ['ход', 'хода', 'ходов'])} агентов</div>
          <div className="un-v">{r.month.turns}</div>
        </div>
      </div>
      {r.month.unknown > 0 && (
        <p className="sd" style={{ color: '#f4c77b' }}>
          Ходов с неизвестной ценой модели: {r.month.unknown} — в сумму они не входят. Укажи цену ниже.
        </p>
      )}

      <div className="srow">
        <div className="sl">
          <div className="t">Лимит на месяц, $</div>
          <div className="d">
            Агент останавливается между шагами, когда лимит достигнут, новые запросы к платным моделям не
            отправляются. Предупреждение на 80%. Пусто — без лимита.
          </div>
        </div>
        <input
          className={'ulim' + (limBad ? ' bad' : '')}
          inputMode="decimal"
          value={lim}
          placeholder="без лимита"
          aria-label="Лимит расходов в месяц, доллары"
          onChange={(e) => setLim(e.target.value)}
          onBlur={saveLim}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {!!s.budget && (
        <div
          className="ubar"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Использовано лимита"
        >
          <i style={{ width: pct + '%' }} className={pct >= 100 ? 'full' : pct >= 80 ? 'hi' : ''} />
          <span>
            {fmtUsd(r.month.cost)} из {fmtUsd(s.budget)}
          </span>
        </div>
      )}

      {r.byProject.length === 0 ? (
        <p className="sd" style={{ marginTop: 18 }}>
          Пока нет данных: расходы появятся после первого ответа платной модели.
        </p>
      ) : (
        <>
          <h3 className="uh">Проекты</h3>
          <table className="utab">
            <thead>
              <tr>
                <th />
                <th>месяц</th>
                <th>токены</th>
                <th>всего</th>
              </tr>
            </thead>
            <tbody>{r.byProject.map((x) => row(x.id, x.name, x.month, x.all))}</tbody>
          </table>
          {project && r.byChat.length > 0 && (
            <>
              <h3 className="uh">Чаты проекта {project.name}</h3>
              <table className="utab">
                <thead>
                  <tr>
                    <th />
                    <th>месяц</th>
                    <th>токены</th>
                    <th>всего</th>
                  </tr>
                </thead>
                <tbody>{r.byChat.map((x) => row(x.id, x.title, x.month, x.all))}</tbody>
              </table>
            </>
          )}
        </>
      )}

      {Object.keys(r.models).filter((m) => m !== '?').length > 0 && (
        <>
          <h3 className="uh">Цены моделей, $ за 1 млн токенов</h3>
          {Object.entries(r.models)
            .filter(([m]) => m !== '?')
            .map(([mid, e]) => {
              const p = priceFor(mid, custom)
              return (
                <div className="srow" key={mid}>
                  <div className="sl">
                    <div className="t mono" style={{ fontSize: 12.5 }}>
                      {mid}
                    </div>
                    <div className="d">
                      {e.known
                        ? custom[mid]
                          ? 'своя цена'
                          : 'справочная цена'
                        : 'цена неизвестна — укажи, чтобы считать'}
                    </div>
                  </div>
                  <div className="uprice">
                    <input
                      aria-label={'Вход, ' + mid}
                      inputMode="decimal"
                      placeholder="вход"
                      defaultValue={p ? String(p.inp) : ''}
                      onBlur={(e) => setPrice(mid, 'inp', e.target.value)}
                    />
                    <input
                      aria-label={'Выход, ' + mid}
                      inputMode="decimal"
                      placeholder="выход"
                      defaultValue={p ? String(p.out) : ''}
                      onBlur={(e) => setPrice(mid, 'out', e.target.value)}
                    />
                  </div>
                </div>
              )
            })}
        </>
      )}
    </>
  )
}
