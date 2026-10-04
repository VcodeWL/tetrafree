import { useState } from 'react'
import { useStore } from '../store'
import { Icon, type IconName } from '../components/ui/Icon'
import { useAccount } from '../lib/account'

/* Первые шаги: каждый пункт отмечается сам по реальным данным, не по кнопке «готово» */
export function Onboarding() {
  const projects = useStore((s) => s.projects)
  const providers = useStore((s) => s.providers)
  const hidden = useStore((s) => s.settings.hideOnboarding)
  const user = useAccount((a) => a.user)
  const st = useStore.getState
  const [all, setAll] = useState(false)
  if (hidden) return null
  const steps: { t: string; d: string; icon: IconName; done: boolean; run: () => void }[] = [
    ...(user
      ? [
          {
            t: 'Подтвердить почту',
            d: 'Нужна для приглашений и восстановления пароля',
            icon: 'mail' as IconName,
            done: user.verified,
            run: () => st().openModal({ type: 'settings', section: 'account' }),
          },
        ]
      : []),
    {
      t: 'Включить двухфакторную защиту',
      d: 'Код из приложения-аутентификатора при входе',
      icon: 'shield',
      done: !!user?.twofa,
      run: () => st().openModal({ type: 'settings', section: 'account' }),
    },
    {
      t: 'Подключить свою модель',
      d: 'Ключ Anthropic/OpenAI или локальная Ollama — без модели агенты не работают',
      icon: 'key',
      done: providers.some((p) => p.on && (p.apiKey || p.kind === 'ollama')),
      run: () => st().openModal({ type: 'settings', section: 'providers' }),
    },
    {
      t: 'Создать свой проект',
      d: 'Пустой или из шаблона — с реальной папкой на диске',
      icon: 'plus',
      done: projects.length > 0,
      run: () => st().openModal({ type: 'newProject' }),
    },
    {
      t: 'Попросить агента изменить код',
      d: 'Напиши в чате — файлы появятся в панели кода по ходу работы',
      icon: 'sparkle',
      done: projects.some((p) => p.versions.some((v) => v.by === 'agent')),
      run: () => {
        const p = projects[0]
        if (p) st().openProject(p.id)
      },
    },
    {
      t: 'Пригласить коллегу',
      d: 'Получит письмо со ссылкой и общий проект',
      icon: 'userplus',
      done: projects.some((p) => !!p.cloud),
      run: () => {
        const p = projects[0]
        if (p) {
          st().openProject(p.id)
          st().openModal({ type: 'settings', section: 'members' })
        }
      },
    },
  ]
  const n = steps.filter((x) => x.done).length
  if (n === steps.length) return null
  const todo = steps.filter((x) => !x.done)
  return (
    <section className="onb" aria-label="Первые шаги">
      <div className="onb-h">
        <b>Первые шаги</b>
        <span>
          {n} из {steps.length}
        </span>
        <i className="onb-bar">
          <u style={{ width: (n / steps.length) * 100 + '%' }} />
        </i>
        <button
          className="iconbtn sm"
          aria-label="Скрыть"
          title="Скрыть"
          onClick={() => st().setSetting('hideOnboarding', true)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="onb-list">
        {(all ? todo : todo.slice(0, 2)).map((x) => (
          <button key={x.t} className="onb-step" onClick={x.run}>
            <span className="oi">
              <Icon name={x.icon} size={14} />
            </span>
            <span className="ot">
              <b>{x.t}</b>
              <small>{x.d}</small>
            </span>
            <Icon name="chev" size={13} />
          </button>
        ))}
        {todo.length > 2 && (
          <button className="linkbtn onb-more" onClick={() => setAll(!all)}>
            {all ? 'Свернуть' : `Ещё ${todo.length - 2}`}
          </button>
        )}
      </div>
    </section>
  )
}
