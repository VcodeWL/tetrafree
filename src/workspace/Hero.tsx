import { GradientRibbon } from '../components/ui/GradientRibbon'
import { useState } from 'react'
import { useStore, useProject } from '../store'
import { ActionButton } from '../components/ui/ActionButton'
import { Icon, type IconName } from '../components/ui/Icon'
import { ModelPicker } from './Composer'
import { sendMessage, resolveModel } from '../agent/engine'

const QUICK: { i: IconName; t: string; p: string }[] = [
  { i: 'browser', t: 'Собрать страницу', p: 'Добавь секцию с тарифами и FAQ на главную' },
  { i: 'target', t: 'Написать тесты', p: 'Напиши тесты для основного модуля' },
  { i: 'doc', t: 'Описать проект', p: 'Обнови документацию проекта' },
  { i: 'task', t: 'Спланировать', p: 'Заведи задачу «Проверить мобильную вёрстку»' },
]

/* Пустой центр: первый запрос создаёт чат с агентом */
export function Hero() {
  const p = useProject()!
  useStore((x) => x.providers)
  useStore((x) => x.model)
  const { live } = resolveModel()
  const [v, setV] = useState('')
  const [foc, setFoc] = useState(false)
  const go = (text: string) => {
    const t = text.trim()
    if (!t || useStore.getState().projectId !== p.id) return
    const st = useStore.getState()
    if (!resolveModel().live) {
      st.openModal({ type: 'settings', section: 'providers' })
      return
    }
    const title = t.length > 38 ? t.slice(0, 36).replace(/\s+\S*$/, '') + '…' : t
    const id = st.createChat({
      title: title[0].toUpperCase() + title.slice(1),
      creator: { kind: 'human', id: 'me' },
      agents: [{ name: 'builder', tier: 'Спросить', sub: [] }],
    })
    sendMessage(id, t, [], '', 0, { pid: p.id })
  }
  return (
    <div className="hero">
      <div className="hero-eyebrow">Твой проект. Твои решения.</div>
      <h1>
        {['Что', 'соберём', 'в'].map((w, i) => (
          <span key={w}>
            <span className="wd" style={{ '--i': i } as React.CSSProperties}>
              {w}
            </span>{' '}
          </span>
        ))}
        <em className="wd" style={{ '--i': 3 } as React.CSSProperties}>
          {p.name}
        </em>
        <span className="wd" style={{ '--i': 3 } as React.CSSProperties}>
          ?
        </span>
      </h1>
      <p>От идеи к работающему коду. Опиши задачу — агент поможет с изменениями.</p>
      {!live && (
        <div className="diff-note hero-note">
          <Icon name="key" size={14} />
          Агенту нужна модель. Подключи ключ Anthropic или OpenAI либо локальную Ollama.
          <ActionButton
            variant="primary"
            size="small"
            onClick={() => useStore.getState().openModal({ type: 'provider' })}
          >
            Подключить модель
          </ActionButton>
        </div>
      )}
      <div className="hero-comp">
        <div className={'comp-box hero-box' + (foc ? ' foc' : '')}>
          <GradientRibbon />
          <textarea
            rows={2}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onFocus={() => setFoc(true)}
            onBlur={() => setFoc(false)}
            autoFocus
            placeholder="Например: добавь страницу FAQ"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                go(v)
              }
            }}
            aria-label="Первый запрос агенту"
          />
          <div className="comp-bar">
            <ModelPicker />
            <span className="comp-hint">Enter — начать чат</span>
            <ActionButton
              variant="primary"
              className="send"
              onClick={() => go(v)}
              disabled={!v.trim()}
              aria-label="Начать"
            >
              <Icon name="send" size={17} />
            </ActionButton>
          </div>
        </div>
      </div>
      <div className="hero-quick">
        {QUICK.map((q) => (
          <button key={q.t} className="qa" onClick={() => go(q.p)}>
            <span className="qi">
              <Icon name={q.i} size={15} />
            </span>
            {q.t}
          </button>
        ))}
      </div>
      <ActionButton
        variant="quiet"
        size="small"
        className="hero-files"
        onClick={() => useStore.getState().setRight({ rightOpen: true, rightTab: 'code' })}
      >
        <Icon name="code" size={14} />
        Открыть файлы проекта
      </ActionButton>
    </div>
  )
}
