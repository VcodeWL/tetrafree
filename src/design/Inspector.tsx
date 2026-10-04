import { useEffect, useMemo, useRef, useState } from 'react'
import { useDesign } from './store'
import { Icon } from '../components/ui/Icon'
import {
  duplicateEl,
  getEl,
  moveEl,
  removeEl,
  selectParent,
  setAttr,
  setStyle,
  setStyles,
  setText,
  commitDoc,
} from './actions'
import {
  cs,
  describe,
  isLeafText,
  kids,
  rgbToHex,
  rootVars,
  setRootVar,
  isTransparent,
  px,
  ruName,
  type RootVar,
} from './dom'
import { canEditText } from './Canvas'

/* ---- мелкие контролы ---- */
function Num({
  label,
  value,
  onChange,
  unit = 'px',
  min,
  step = 1,
  wide,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  unit?: string
  min?: number
  step?: number
  wide?: boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = (s: string) => {
    const t = s.trim()
    if (t === '') return onChange('')
    if (/^-?[\d.]+$/.test(t)) onChange(t + unit)
    else onChange(t)
  }
  return (
    <label className={'dn' + (wide ? ' wide' : '')}>
      {label && <span>{label}</span>}
      <input
        value={v}
        min={min}
        step={step}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && commit(v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const n = parseFloat(v)
            if (Number.isFinite(n)) {
              e.preventDefault()
              const nv = String(
                Math.round((n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step)) * 100) / 100,
              )
              setV(nv)
              onChange(nv + unit)
            }
          }
        }}
      />
    </label>
  )
}
function Color({
  label,
  value,
  onChange,
  allowNone,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  allowNone?: boolean
}) {
  const none = isTransparent(value)
  const hex = none ? '#000000' : rgbToHex(value)
  return (
    <div className="dcol">
      <span>{label}</span>
      <label className="sw" style={{ background: none ? undefined : hex }} data-none={none}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        className="hx"
        value={none ? '—' : hex}
        onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(e.target.value)}
      />
      {allowNone && !none && (
        <button className="dx" title="Убрать" onClick={() => onChange('transparent')}>
          <Icon name="x" size={11} />
        </button>
      )}
    </div>
  )
}
function Seg<T extends string>({
  value,
  opts,
  onChange,
  label,
}: {
  value: T
  opts: [T, string][]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="dseg" role="group" aria-label={label}>
      {opts.map(([k, t]) => (
        <button key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)} title={t}>
          {t}
        </button>
      ))}
    </div>
  )
}
const Sec = ({ t, children, right }: { t: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="dsec">
    <h4>
      {t}
      {right}
    </h4>
    {children}
  </section>
)

const SHADOWS: [string, string][] = [
  ['none', 'Нет'],
  ['0 1px 3px rgba(0,0,0,.25)', 'Лёгкая'],
  ['0 8px 24px rgba(0,0,0,.28)', 'Средняя'],
  ['0 18px 48px rgba(0,0,0,.4)', 'Сильная'],
]

export function Inspector() {
  const sel = useDesign((s) => s.sel)
  const doc = useDesign((s) => s.doc)
  useDesign((s) => s.rev)
  const el = doc && doc.defaultView && sel ? getEl(sel) : null
  const [tab, setTab] = useState<'props' | 'vars'>('props')
  return (
    <aside className="dinsp" aria-label="Свойства элемента">
      <div className="dtabs">
        <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>
          Свойства
        </button>
        <button className={tab === 'vars' ? 'on' : ''} onClick={() => setTab('vars')}>
          Переменные
        </button>
      </div>
      <div className="dscroll">{tab === 'vars' ? <Vars /> : el ? <Props el={el} /> : <Empty />}</div>
    </aside>
  )
}

function Empty() {
  return (
    <div className="dempty">
      <Icon name="cursor" size={22} />
      <b>Ничего не выбрано</b>
      <span>
        Кликни по элементу на холсте или в слоях. Двойной клик по тексту — править прямо на странице.
      </span>
      <ul>
        <li>
          <kbd>Del</kbd> удалить
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>D</kbd> дублировать
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> отменить
        </li>
        <li>
          <kbd>Ctrl</kbd>+колесо — зум
        </li>
      </ul>
    </div>
  )
}

function Props({ el }: { el: HTMLElement }) {
  const c = cs(el)
  const st = el.style
  const g = (p: string) => st.getPropertyValue(p) || c.getPropertyValue(p)
  const flex = g('display').includes('flex'),
    grid = g('display').includes('grid')
  const leaf = isLeafText(el)
  const isA = el.tagName === 'A',
    isImg = el.tagName === 'IMG'
  const set = (p: string) => (v: string) => setStyle(el, p, v)
  const bw = px(c.borderTopWidth)
  const pad = ['Top', 'Right', 'Bottom', 'Left'].map((s) =>
    px(c.getPropertyValue('padding-' + s.toLowerCase())),
  )
  const mar = ['Top', 'Right', 'Bottom', 'Left'].map((s) =>
    px(c.getPropertyValue('margin-' + s.toLowerCase())),
  )
  const cls = el.getAttribute('class') || ''
  const rawShadow = st.boxShadow || ''
  const shadowKey = SHADOWS.find(([v]) => v === (rawShadow || 'none'))?.[0] ?? 'custom'
  // el — изменяемый DOM-узел: textContent нужен в зависимостях, чтобы значение перечитывалось
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const textVal = useMemo(() => el.textContent || '', [el, el.textContent])
  const parentOk = el.parentElement && el.parentElement.tagName !== 'BODY'
  return (
    <>
      <div className="dhead">
        <div className="dh-t">
          <b>{ruName(el)}</b>
          <code>{describe(el)}</code>
        </div>
        <div className="dh-a">
          {parentOk && (
            <button className="iconbtn sm" title="Выбрать родителя (Esc)" onClick={selectParent}>
              <Icon name="arrow" size={13} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          )}
          <button className="iconbtn sm" title="Выше" onClick={() => moveEl(el, -1)}>
            <Icon name="arrowdown" size={13} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button className="iconbtn sm" title="Ниже" onClick={() => moveEl(el, 1)}>
            <Icon name="arrowdown" size={13} />
          </button>
          <button className="iconbtn sm" title="Дублировать (Ctrl+D)" onClick={() => duplicateEl(el)}>
            <Icon name="copy" size={13} />
          </button>
          <button className="iconbtn sm danger" title="Удалить (Del)" onClick={() => removeEl(el)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {(leaf || canEditText(el)) && (
        <Sec t="Текст">
          <TextBox el={el} initial={textVal} multi={leaf} />
        </Sec>
      )}
      {(isA || isImg || el.tagName === 'INPUT') && (
        <Sec t={isImg ? 'Изображение' : isA ? 'Ссылка' : 'Поле'}>
          {isA && (
            <Field
              label="Адрес"
              value={el.getAttribute('href') || ''}
              onChange={(v) => setAttr(el, 'href', v)}
              ph="https://… или #раздел"
            />
          )}
          {isImg && (
            <>
              <Field
                label="Источник"
                value={el.getAttribute('src')?.startsWith('data:') ? '' : el.getAttribute('src') || ''}
                onChange={(v) => setAttr(el, 'src', v)}
                ph={
                  el.getAttribute('src')?.startsWith('data:')
                    ? 'встроенное изображение — вставь URL, чтобы заменить'
                    : 'URL картинки'
                }
              />
              <Field
                label="Описание"
                value={el.getAttribute('alt') || ''}
                onChange={(v) => setAttr(el, 'alt', v)}
                ph="для скринридеров"
              />
            </>
          )}
          {el.tagName === 'INPUT' && (
            <Field
              label="Подсказка"
              value={el.getAttribute('placeholder') || ''}
              onChange={(v) => setAttr(el, 'placeholder', v)}
            />
          )}
        </Sec>
      )}

      <Sec t="Размер">
        <div className="drow">
          <Num label="Ш" value={String(px(c.width))} onChange={set('width')} />
          <Num label="В" value={String(px(c.height))} onChange={set('height')} />
        </div>
        <div className="drow">
          <Num
            label="Макс Ш"
            value={st.maxWidth && st.maxWidth !== 'none' ? String(parseFloat(st.maxWidth)) : ''}
            onChange={set('max-width')}
          />
          <button
            className="btn sm gho"
            onClick={() => setStyles(el, { width: '', height: '', 'max-width': '' }, 'Сброс размера')}
          >
            Авто
          </button>
        </div>
      </Sec>

      <Sec t="Раскладка">
        <Seg
          label="display"
          value={
            (g('display').includes('flex')
              ? 'flex'
              : g('display').includes('grid')
                ? 'grid'
                : g('display') === 'none'
                  ? 'none'
                  : g('display').startsWith('inline')
                    ? 'inline-block'
                    : 'block') as 'flex'
          }
          onChange={(v) => setStyle(el, 'display', v)}
          opts={
            [
              ['block', 'Блок'],
              ['flex', 'Flex'],
              ['grid', 'Grid'],
              ['inline-block', 'Строка'],
              ['none', 'Скрыт'],
            ] as ['flex', string][]
          }
        />
        {flex && (
          <>
            <Seg
              label="direction"
              value={(g('flex-direction').startsWith('column') ? 'column' : 'row') as 'row'}
              onChange={(v) => setStyle(el, 'flex-direction', v)}
              opts={[
                ['row', '→ Ряд'],
                ['column', '↓ Колонка'],
              ]}
            />
            <div className="drow">
              <Sel
                label="Выравн."
                value={g('align-items')}
                opts={[
                  ['normal', 'авто'],
                  ['flex-start', 'начало'],
                  ['center', 'центр'],
                  ['flex-end', 'конец'],
                  ['stretch', 'растянуть'],
                ]}
                onChange={set('align-items')}
              />
              <Sel
                label="Распред."
                value={g('justify-content')}
                opts={[
                  ['normal', 'авто'],
                  ['flex-start', 'начало'],
                  ['center', 'центр'],
                  ['flex-end', 'конец'],
                  ['space-between', 'между'],
                ]}
                onChange={set('justify-content')}
              />
            </div>
          </>
        )}
        {grid && (
          <Field
            label="Колонки"
            value={st.gridTemplateColumns || c.gridTemplateColumns.replace(/[\d.]+px/g, (m) => m)}
            onChange={set('grid-template-columns')}
            ph="repeat(3, 1fr)"
          />
        )}
        {(flex || grid) && (
          <div className="drow">
            <Num
              label="Gap"
              value={String(px(c.columnGap === 'normal' ? '0' : c.columnGap))}
              onChange={set('gap')}
            />
          </div>
        )}
        <div className="dgrp">
          <span>Padding</span>
          <div className="d4">
            {(['Top', 'Right', 'Bottom', 'Left'] as const).map((s, i) => (
              <Num
                key={s}
                label={['↑', '→', '↓', '←'][i]}
                value={String(pad[i])}
                onChange={set('padding-' + s.toLowerCase())}
              />
            ))}
          </div>
        </div>
        <div className="dgrp">
          <span>Margin</span>
          <div className="d4">
            {(['Top', 'Right', 'Bottom', 'Left'] as const).map((s, i) => (
              <Num
                key={s}
                label={['↑', '→', '↓', '←'][i]}
                value={String(mar[i])}
                onChange={set('margin-' + s.toLowerCase())}
              />
            ))}
          </div>
        </div>
      </Sec>

      <Sec t="Типографика">
        <div className="drow">
          <Num label="Размер" value={String(px(c.fontSize))} onChange={set('font-size')} />
          <Sel
            label="Насыщ."
            value={String(c.fontWeight)}
            opts={[
              ['300', 'Light'],
              ['400', 'Regular'],
              ['500', 'Medium'],
              ['600', 'Semibold'],
              ['700', 'Bold'],
              ['800', 'Extra'],
            ]}
            onChange={set('font-weight')}
          />
        </div>
        <div className="drow">
          <Num
            label="Интерл."
            unit=""
            value={
              c.lineHeight === 'normal'
                ? ''
                : String(Math.round((px(c.lineHeight) / px(c.fontSize)) * 100) / 100)
            }
            step={0.1}
            onChange={set('line-height')}
          />
          <Num
            label="Трекинг"
            value={c.letterSpacing === 'normal' ? '0' : String(px(c.letterSpacing))}
            onChange={set('letter-spacing')}
          />
        </div>
        <Seg
          label="align"
          value={(['center', 'right', 'justify'].includes(c.textAlign) ? c.textAlign : 'left') as 'left'}
          onChange={(v) => setStyle(el, 'text-align', v)}
          opts={[
            ['left', 'Слева'],
            ['center', 'Центр'],
            ['right', 'Справа'],
          ]}
        />
        <Color label="Цвет" value={c.color} onChange={set('color')} />
      </Sec>

      <Sec t="Заливка и рамка">
        <Color label="Фон" value={c.backgroundColor} onChange={set('background-color')} allowNone />
        <div className="drow">
          <Num
            label="Рамка"
            value={String(bw)}
            onChange={(v) =>
              setStyles(
                el,
                { 'border-width': v, 'border-style': v && parseFloat(v) > 0 ? 'solid' : '' },
                'Рамка',
              )
            }
          />
          <Num label="Радиус" value={String(px(c.borderTopLeftRadius))} onChange={set('border-radius')} />
        </div>
        {bw > 0 && <Color label="Цвет рамки" value={c.borderTopColor} onChange={set('border-color')} />}
        <div className="drow">
          <Sel
            label="Тень"
            value={shadowKey}
            opts={[...SHADOWS, ['custom', 'Своя']]}
            onChange={(v) => v !== 'custom' && setStyle(el, 'box-shadow', v === 'none' ? '' : v)}
          />
          <label className="dn">
            <span>Прозр.</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(parseFloat(c.opacity) * 100)}
              onChange={(e) => {
                el.style.opacity = String(+e.target.value / 100)
                commitDoc('Прозрачность', 'opacity')
              }}
            />
          </label>
        </div>
      </Sec>

      <Sec t="Класс и id">
        <Field label="class" value={cls} onChange={(v) => setAttr(el, 'class', v)} />
        <Field label="id" value={el.id} onChange={(v) => setAttr(el, 'id', v)} />
        <button
          className="btn sm gho"
          onClick={() => {
            el.removeAttribute('style')
            commitDoc('Сброс стилей элемента')
          }}
        >
          <Icon name="undo" size={13} />
          Сбросить inline-стили
        </button>
      </Sec>
    </>
  )
}

function TextBox({ el, initial, multi }: { el: HTMLElement; initial: string; multi: boolean }) {
  const [v, setV] = useState(initial)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setV(initial), [initial, el])
  const push = (s: string) => {
    setV(s)
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => setText(el, s), 220)
  }
  return multi ? (
    <textarea className="dta" rows={3} value={v} onChange={(e) => push(e.target.value)} />
  ) : (
    <div className="dnote2">
      <span>Элемент содержит вложенное форматирование. Двойной клик по нему на холсте — править текст.</span>
      <button className="btn sm" onClick={() => window.dispatchEvent(new Event('tf:design-edit'))}>
        <Icon name="pen" size={12} />
        Править
      </button>
    </div>
  )
}
function Field({
  label,
  value,
  onChange,
  ph,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  ph?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="df">
      <span>{label}</span>
      <input
        value={v}
        placeholder={ph}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onChange(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}
function Sel({
  label,
  value,
  opts,
  onChange,
}: {
  label: string
  value: string
  opts: [string, string][]
  onChange: (v: string) => void
}) {
  const has = opts.some(([k]) => k === value)
  return (
    <label className="dn wide">
      <span>{label}</span>
      <select value={has ? value : '__'} onChange={(e) => onChange(e.target.value)}>
        {!has && (
          <option value="__" disabled>
            {value || '—'}
          </option>
        )}
        {opts.map(([k, t]) => (
          <option key={k} value={k}>
            {t}
          </option>
        ))}
      </select>
    </label>
  )
}

function Vars() {
  const doc = useDesign((s) => s.doc)
  useDesign((s) => s.rev)
  const vars: RootVar[] = doc ? rootVars(doc) : []
  const apply = (name: string, value: string) => {
    if (doc && setRootVar(doc, name, value)) commitDoc('Переменная ' + name, 'var:' + name)
  }
  if (!vars.length)
    return (
      <div className="dempty">
        <Icon name="paint" size={22} />
        <b>Нет переменных</b>
        <span>
          В этой странице нет CSS-переменных в <code>:root</code>. Попроси дизайнера вынести цвета и радиусы в
          переменные — они появятся здесь.
        </span>
      </div>
    )
  return (
    <div className="dvars">
      <p className="dnote">
        Переменные страницы: меняются сразу везде, где используются (акцент, фон, радиус…).
      </p>
      {vars.map((v) =>
        v.kind === 'color' ? (
          <Color key={v.name} label={v.name} value={v.value} onChange={(x) => apply(v.name, x)} />
        ) : (
          <Field key={v.name} label={v.name} value={v.value} onChange={(x) => apply(v.name, x)} />
        ),
      )}
    </div>
  )
}
void kids
