import { ServerHelp } from '../components/ServerHelp'
import { markSeen } from '../lib/whatsnew'
import { UsagePanel } from './UsagePanel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProject, toast } from '../store'
import { Icon, BrandIcon, type IconName } from '../components/ui/Icon'
import { Avatar, Switch, Kbd, Segmented } from '../components/ui/primitives'
import { Modal } from '../components/ui/Modal'
import { ME } from '../data/seed'
import { isEmail, ago, modKey, download, copyText } from '../lib/util'
import { pipelinesOf, runPipeline, scheduleStatus } from '../agent/ci'
import { describeSchedule } from '../agent/triggers'
import { HOTKEYS } from '../lib/hotkeys'
import { ACTIONS, effective, comboOf, check, parts } from '../lib/keymap'
import { useBackend, detectBackend, setBackendUrl } from '../lib/backend'
import { resyncNow } from '../lib/sync'
import type { Person, Settings as SettingsT } from '../types'
import { AccountSecurity, MembersPanel } from './AccountPanels'
import { api, logout, useAccount } from '../lib/account'
import { exportBackup, importBackup } from '../lib/backup'
import { storageUsed, storageLevel, fmtMb, STORAGE_LIMIT } from '../lib/storageUse'
import { build as buildSettings, parse as parseSettings } from '../lib/settingsIO'
import { UI_FONTS, CODE_FONTS } from '../lib/fonts'
import { enableOsNotify } from '../lib/osnotify'
import {
  isDesktop,
  sysInfo,
  sysSetAutostart,
  sysSetTray,
  updCheck,
  updInstall,
  type SysInfo,
  type UpdateInfo,
} from '../lib/desktop'
import { backupNow, lastAutoBackup } from '../lib/autobackup'
import { bBackup, bReveal, bCheckEditor, type BackupInfo } from '../lib/backend'
import { useEditors, loadEditors, pickEditor } from '../lib/editors'
import { APP_VERSION, RELEASES, KIND_LABEL, NOTE_LABEL } from '../data/changelog'

const SECTIONS: { k: string; t: string; icon: IconName; project?: boolean }[] = [
  { k: 'account', t: 'Аккаунт', icon: 'user' },
  { k: 'members', t: 'Участники', icon: 'users', project: true },
  { k: 'providers', t: 'Провайдеры', icon: 'key' },
  { k: 'usage', t: 'Расходы', icon: 'bolt' },
  { k: 'deploy', t: 'Деплой', icon: 'rocket', project: true },
  { k: 'backend', t: 'Бэкенд и диск', icon: 'disk' },
  { k: 'appearance', t: 'Оформление', icon: 'paint' },
  { k: 'shortcuts', t: 'Горячие клавиши', icon: 'keyboard' },
  { k: 'about', t: 'Что нового', icon: 'sparkle' },
]

export function SettingsModal({ section = 'account' }: { section?: string }) {
  const [sec, setSec] = useState(section)
  const close = useStore((s) => s.closeModal)
  const project = useProject()
  const visible = SECTIONS.filter((s) => !s.project || project)
  const cur = visible.find((s) => s.k === sec) || visible[0]
  return (
    <Modal kind="settings" label="Настройки">
      <div className="settings">
        <nav className="set-nav">
          <div className="sn-t">Настройки</div>
          {visible.map((s) => (
            <div
              key={s.k}
              className={'sni' + (s.k === cur.k ? ' on' : '')}
              role="button"
              tabIndex={0}
              onClick={() => setSec(s.k)}
              onKeyDown={(e) => e.key === 'Enter' && setSec(s.k)}
            >
              <span className="si">
                <Icon name={s.icon} size={16} />
              </span>
              {s.t}
            </div>
          ))}
          <div className="sn-foot">
            TetraFree {APP_VERSION} · <span className="mono">{project ? project.name : 'без проекта'}</span>
          </div>
        </nav>
        <div className="set-main" role="region" aria-label="Содержимое настроек">
          <button className="iconbtn set-close" onClick={close} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
          {cur.k === 'account' ? (
            <Account />
          ) : cur.k === 'members' ? (
            <Members />
          ) : cur.k === 'providers' ? (
            <Providers />
          ) : cur.k === 'usage' ? (
            <UsagePanel />
          ) : cur.k === 'deploy' ? (
            <Deploy />
          ) : cur.k === 'backend' ? (
            <BackendSection />
          ) : cur.k === 'appearance' ? (
            <Appearance />
          ) : cur.k === 'about' ? (
            <WhatsNew />
          ) : (
            <Shortcuts />
          )}
        </div>
      </div>
    </Modal>
  )
}

const TZ = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Minsk',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Vladivostok',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'UTC',
]
const STATUS: { k: NonNullable<Person['status']>; t: string }[] = [
  { k: 'online', t: 'В сети' },
  { k: 'away', t: 'Отошёл' },
  { k: 'offline', t: 'Не в сети' },
]

function Account() {
  const me = useStore((s) => s.people[ME])
  const st = useStore.getState
  const [name, setName] = useState(me.name)
  const [email, setEmail] = useState(me.email)
  const [role, setRole] = useState(me.role || '')
  const [tags, setTags] = useState((me.tags || []).join(', '))
  const file = useRef<HTMLInputElement>(null)
  const dirty =
    name !== me.name || email !== me.email || role !== (me.role || '') || tags !== (me.tags || []).join(', ')
  const acct = useAccount((a) => a.user)
  const bad = !name.trim() ? 'name' : !isEmail(email) ? 'email' : null
  const save = () => {
    if (bad) return
    if (acct && name.trim() !== acct.name)
      void api<{ user: typeof acct }>('PATCH', '/api/auth/profile', { name: name.trim() })
        .then((r) => useAccount.setState({ user: r.user }))
        .catch((e) =>
          toast({
            title: 'Имя не сохранилось на сервере',
            desc: (e as Error).message,
            icon: 'warn',
            tone: 'warn',
          }),
        )
    st().updateMe({
      name: name.trim(),
      email: email.trim(),
      role: role.trim(),
      tags: tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    })
    toast({ title: 'Профиль сохранён', icon: 'check', tone: 'ok' })
  }
  const onPhoto = (f?: File) => {
    if (!f) return
    if (!f.type.startsWith('image/'))
      return toast({ title: 'Нужна картинка', desc: 'PNG, JPG или WebP', tone: 'warn', icon: 'warn' })
    const img = new Image()
    const url = URL.createObjectURL(f)
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 160
      const k = Math.max(160 / img.width, 160 / img.height)
      c.getContext('2d')!.drawImage(
        img,
        (160 - img.width * k) / 2,
        (160 - img.height * k) / 2,
        img.width * k,
        img.height * k,
      )
      st().updateMe({ avatar: c.toDataURL('image/jpeg', 0.86) })
      URL.revokeObjectURL(url)
    }
    img.src = url
  }
  return (
    <>
      <h2>Аккаунт</h2>
      <p className="sd">
        Профиль видят участники проектов: роль, часовой пояс и теги помогают понять, кому назначать задачи.
      </p>
      <div className="acc-head">
        <div
          className="acc-av"
          role="button"
          tabIndex={0}
          onClick={() => file.current?.click()}
          title="Сменить фото"
        >
          <Avatar person={me} size={72} round />
          <span className="acc-up">
            <Icon name="upload" size={15} />
          </span>
        </div>
        <div className="acc-hx">
          <div className="acc-n">{me.name}</div>
          <div className="acc-e">{me.email}</div>
          <div className="acc-acts">
            <button className="btn sm" onClick={() => file.current?.click()}>
              <Icon name="image" size={13} />
              Загрузить фото
            </button>
            {me.avatar && (
              <button className="btn gho sm" onClick={() => st().updateMe({ avatar: undefined })}>
                Убрать
              </button>
            )}
          </div>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onPhoto(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div className="fgrid">
        <div className={'field' + (bad === 'name' ? ' bad' : '')}>
          <label>Имя</label>
          <input aria-label="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          {bad === 'name' && <div className="ferr">Имя не может быть пустым</div>}
        </div>
        <div className={'field' + (bad === 'email' ? ' bad' : '')}>
          <label>Почта</label>
          <input
            aria-label="Почта"
            value={email}
            readOnly={!!acct}
            title={acct ? 'Почта привязана к аккаунту' : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {bad === 'email' && <div className="ferr">Проверь адрес</div>}
        </div>
        <div className="field">
          <label>Роль</label>
          <input
            aria-label="Роль"
            value={role}
            placeholder="Например, Backend"
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Часовой пояс</label>
          <select
            className="sel"
            aria-label="Часовой пояс"
            value={me.tz || 'Europe/Moscow'}
            onChange={(e) => st().updateMe({ tz: e.target.value })}
          >
            {TZ.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </div>
        <div className="field span2">
          <label>Теги навыков — через запятую</label>
          <input
            aria-label="Теги навыков"
            value={tags}
            placeholder="Rust, ревью, Postgres"
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label>Статус</label>
        <Segmented
          wide
          label="Статус"
          value={me.status || 'online'}
          onChange={(k) => st().updateMe({ status: k })}
          options={STATUS.map((x) => ({ k: x.k, t: x.t, icon: <i className={'g ' + x.k} /> }))}
        />
      </div>
      <div className="set-actions">
        <button className="btn pri" disabled={!dirty || !!bad} onClick={save}>
          Сохранить
        </button>
        {dirty && (
          <button
            className="btn gho"
            onClick={() => {
              setName(me.name)
              setEmail(me.email)
              setRole(me.role || '')
              setTags((me.tags || []).join(', '))
            }}
          >
            Отменить
          </button>
        )}
      </div>
      <AccountSecurity />
      <div className="set-danger">
        <div className="srow">
          <div className="sl">
            <div className="t">Выйти из аккаунта</div>
            <div className="d">Проекты останутся на этом устройстве.</div>
          </div>
          <button className="btn sm" onClick={() => void logout()}>
            <Icon name="logout" size={13} />
            Выйти
          </button>
        </div>
        <div className="srow">
          <div className="sl">
            <div className="t">Стереть данные приложения</div>
            <div className="d">
              Удалит проекты, чаты, задачи, провайдеров и ключи из приложения. Файлы в папках проектов на
              диске останутся.
            </div>
          </div>
          <button
            className="btn sm danger"
            onClick={() =>
              st().openModal({
                type: 'confirm',
                danger: true,
                title: 'Стереть данные приложения?',
                body: 'Проекты, чаты, задачи, провайдеры и ключи будут удалены из приложения. Папки проектов на диске не трогаем. Отменить нельзя.',
                confirm: 'Стереть',
                run: () => {
                  st().resetData()
                  toast({ title: 'Данные приложения стёрты', icon: 'refresh' })
                },
              })
            }
          >
            <Icon name="refresh" size={13} />
            Стереть
          </button>
        </div>
      </div>
    </>
  )
}

export function Members() {
  return <MembersPanel />
}

function Providers() {
  const providers = useStore((s) => s.providers)
  const model = useStore((s) => s.model)
  const st = useStore.getState
  return (
    <>
      <h2>Провайдеры</h2>
      <p className="sd">
        Модели, которыми работают агенты. Ключ хранится только на этом устройстве. Пока не подключён ни один
        провайдер, агенты не отвечают.
      </p>
      {providers.map((p) => (
        <div
          className={'prov' + (p.on ? '' : ' off')}
          key={p.id}
          onClick={() => st().openModal({ type: 'provider', id: p.id })}
        >
          <span className="pi">
            <BrandIcon kind={p.kind} size={20} />
          </span>
          <div className="px">
            <div className="pn">
              <button className="popen" onClick={() => st().openModal({ type: 'provider', id: p.id })}>
                {p.name}
              </button>
              {model.startsWith(p.id + ':') && <span className="tag">по умолчанию</span>}
            </div>
            <div className="pm">
              {p.models.length}{' '}
              {p.models.length === 1 ? 'модель' : p.models.length < 5 ? 'модели' : 'моделей'} ·{' '}
              {p.apiKey ? 'ключ добавлен' : p.kind === 'ollama' ? 'локально, без ключа' : 'нет ключа'}
            </div>
          </div>
          <span onClick={(e) => e.stopPropagation()}>
            <Switch on={p.on} onChange={() => st().toggleProvider(p.id)} label={'Включить ' + p.name} />
          </span>
          <Icon name="chev" size={15} className="pchev" />
        </div>
      ))}
      <button className="btn" onClick={() => st().openModal({ type: 'provider' })}>
        <Icon name="plus" size={14} />
        Добавить провайдера
      </button>
    </>
  )
}

const NEW_PIPELINE: [string, string] = [
  '.tetra/pipelines/test.yaml',
  'name: test\ntrigger: [manual]\nsteps:\n  - name: Тесты\n    run: npm test\n',
]

function Deploy() {
  const p = useProject()!
  const st = useStore.getState
  const pipes = useMemo(() => pipelinesOf(p.files), [p.files])
  useBackend((b) => b.status)
  const running = p.deploy.runs.some((r) => r.status === 'running')
  return (
    <>
      <h2>Деплой</h2>
      <p className="sd">
        Пайплайны лежат в <code>.tetra/pipelines/</code>. Каждый шаг — настоящая команда, которую shell
        запускает в папке проекта на диске (нужен запущенный сервер).
      </p>
      <div className="srow">
        <div className="sl">
          <div className="t">Автодеплой превью</div>
          <div className="d">
            По триггерам пайплайнов: после правок агента (version) или git-коммита (commit); push — оба.
            Работает при подключённом бэкенде, шаги выполняются по-настоящему.
          </div>
        </div>
        <Switch
          on={p.deploy.auto}
          onChange={(v) =>
            st().up((pp) => {
              pp.deploy.auto = v
            })
          }
          label="Автодеплой"
        />
      </div>
      <div className="set-sub">Пайплайны</div>
      {pipes.length ? (
        pipes.map((d) => (
          <div className="pipe" key={d.file}>
            <span className="pi">
              <Icon name={d.name === 'release' ? 'rocket' : 'eye'} size={16} />
            </span>
            <div className="px">
              <div className="pn">
                {d.name}
                <span className="mono dim">{d.file}</span>
              </div>
              <div className="psteps">
                {d.steps.map((s, i) => (
                  <span key={i} className="pst">
                    {s.name}
                  </span>
                ))}
              </div>
              <div className="pm">
                триггер: {d.trigger.join(', ')}
                {d.schedule ? ` · ${describeSchedule(d.schedule)}` : ''}
              </div>
              {d.badSchedule && (
                <div className="pm pm-warn">
                  Расписание «{d.badSchedule}» не распознано. Пример:{' '}
                  <span className="mono">schedule: every 30m</span> (от 5 минут) или{' '}
                  <span className="mono">schedule: daily 09:30</span>
                </div>
              )}
              {(() => {
                const ss = scheduleStatus(p.id, d, p.deploy.auto)
                if (!ss) return null
                return (
                  <div className={'pm' + (ss.ok ? '' : ' pm-warn')}>
                    {ss.ok
                      ? `следующий запуск: ${new Date(ss.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : ss.text}
                  </div>
                )
              })()}
            </div>
            <div className="pacts">
              <button
                className="iconbtn sm"
                title="Открыть YAML"
                onClick={() => {
                  st().closeModal()
                  st().openFile(d.file)
                }}
              >
                <Icon name="file" size={14} />
              </button>
              <button
                className="btn sm"
                disabled={running}
                onClick={() => {
                  runPipeline(d.name)
                  st().openModal({ type: 'deploy' })
                }}
              >
                <Icon name="play" size={12} />
                Запустить
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="cl-empty">
          Пайплайнов нет.{' '}
          <button className="linkbtn" onClick={() => st().writeFile(...NEW_PIPELINE)}>
            Создать пример
          </button>{' '}
          или попроси агента.
        </div>
      )}
      <div className="set-sub">Последние запуски</div>
      {p.deploy.runs.slice(0, 5).map((r) => (
        <div
          className="runrow"
          key={r.id}
          role="button"
          tabIndex={0}
          onClick={() => st().openModal({ type: 'deploy' })}
        >
          <span className={'rstate ' + r.status}>
            {r.status === 'running' ? (
              <span className="tspin" />
            ) : (
              <Icon name={r.status === 'ok' ? 'check' : 'x'} size={12} />
            )}
          </span>
          <span className="mono">{r.pipeline || r.kind}</span>
          <span className="dim">v{r.version}</span>
          <span className="grow" />
          <span className="dim">{ago(r.at)}</span>
        </div>
      ))}
      {!p.deploy.runs.length && <div className="cl-empty">Запусков ещё не было.</div>}
    </>
  )
}

function Appearance() {
  const s = useStore((x) => x.settings)
  const set = useStore((x) => x.setSetting)
  const setsIn = useRef<HTMLInputElement>(null)
  const row = (k: keyof SettingsT, t: string, d: string) => (
    <div className="srow" key={k}>
      <div className="sl">
        <div className="t">{t}</div>
        <div className="d">{d}</div>
      </div>
      <Switch on={!!s[k]} onChange={(v) => set(k, v)} label={t} />
    </div>
  )
  return (
    <>
      <h2>Оформление</h2>
      <p className="sd">
        Тёмная или светлая тема с одним акцентным цветом. Всё, что отвлекает, можно выключить.
      </p>
      <div className="srow">
        <div className="sl">
          <div className="t">Тема</div>
          <div className="d">«Как в системе» следует настройке ОС.</div>
        </div>
        <Segmented
          label="Тема"
          value={(s.theme || 'dark') as 'dark' | 'light' | 'system'}
          onChange={(k) => set('theme', k)}
          options={[
            { k: 'dark', t: 'Тёмная' },
            { k: 'light', t: 'Светлая' },
            { k: 'system', t: 'Системная' },
          ]}
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Акценты</div>
          <div className="d">
            «Градиент» — мягкий сине-фиолетово-розовый переход на главных кнопках, активной вкладке,
            индикаторах и вокруг поля ввода. «Спокойный» — один плоский цвет.
          </div>
        </div>
        <Segmented
          label="Акценты"
          value={s.look || 'gradient'}
          onChange={(k) => set('look', k)}
          options={[
            { k: 'calm', t: 'Спокойный' },
            { k: 'gradient', t: 'Градиент' },
          ]}
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Плотность</div>
          <div className="d">
            Компактный режим: меньше отступов в списках, дереве файлов и настройках — помещается больше.
          </div>
        </div>
        <Segmented
          label="Плотность"
          value={s.density || 'comfortable'}
          onChange={(k) => set('density', k)}
          options={[
            { k: 'comfortable', t: 'Свободно' },
            { k: 'compact', t: 'Компактно' },
          ]}
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Размер кода</div>
          <div className="d">Шрифт в панели кода и редакторе.</div>
        </div>
        <Segmented
          label="Размер кода"
          value={String(s.codeSize || 12.5)}
          onChange={(k) => set('codeSize', +k as 11.5 | 12.5 | 14)}
          options={[
            { k: '11.5', t: 'Мелкий' },
            { k: '12.5', t: 'Обычный' },
            { k: '14', t: 'Крупный' },
          ]}
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Шрифты</div>
          <div className="d">
            Слева интерфейс, справа код. Inter, JetBrains Mono и Fira Code работают, только если установлены в
            системе; ничего не скачивается, при отсутствии берётся следующий похожий.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            className="sel"
            aria-label="Шрифт интерфейса"
            style={{ width: 150 }}
            value={s.uiFont || 'inter'}
            onChange={(e) => set('uiFont', e.target.value)}
          >
            {UI_FONTS.map((f) => (
              <option key={f.k} value={f.k}>
                {f.t}
              </option>
            ))}
          </select>
          <select
            className="sel"
            aria-label="Шрифт кода"
            style={{ width: 170 }}
            value={s.codeFont || 'jb'}
            onChange={(e) => set('codeFont', e.target.value)}
          >
            {CODE_FONTS.map((f) => (
              <option key={f.k} value={f.k}>
                {f.t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Перенос настроек</div>
          <div className="d">
            Тема, шрифты, горячие клавиши, лимит расходов и переключатели — в один файл и обратно. Ключи
            провайдеров и адрес сервера не переносятся.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn sm"
            onClick={() => {
              download(
                'tetrafree-settings.json',
                JSON.stringify(buildSettings(useStore.getState().settings), null, 2),
                'application/json',
              )
              toast({ title: 'Настройки сохранены', icon: 'down' })
            }}
          >
            <Icon name="down" size={13} />
            Экспорт
          </button>
          <button className="btn sm" onClick={() => setsIn.current?.click()}>
            <Icon name="upload" size={13} />
            Импорт
          </button>
          <input
            ref={setsIn}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              f.text()
                .then((t) => {
                  const s = parseSettings(t)
                  Object.entries(s).forEach(([k, v]) => set(k as keyof SettingsT, v as never))
                  toast({
                    title: 'Настройки применены',
                    desc: `параметров: ${Object.keys(s).length}`,
                    icon: 'check',
                    tone: 'ok',
                  })
                })
                .catch((er) =>
                  toast({
                    title: 'Не удалось импортировать',
                    desc: (er as Error).message,
                    icon: 'warn',
                    tone: 'warn',
                  }),
                )
            }}
          />
        </div>
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Сбросить оформление</div>
          <div className="d">
            Вернёт тему, плотность, размер кода и переключатели ниже к значениям по умолчанию. Остальные
            настройки не трогаются.
          </div>
        </div>
        <button
          className="btn sm"
          onClick={() => {
            ;(['theme', 'density', 'codeSize', 'look', 'uiFont', 'codeFont'] as const).forEach((k) =>
              set(k, undefined as never),
            )
            set('accents', true)
            set('ambient', true)
            localStorage.removeItem('tf.termSize')
            toast({ title: 'Оформление сброшено', icon: 'check' })
          }}
        >
          Сбросить
        </button>
      </div>
      {row(
        'accents',
        'Цветной акцент',
        'Индиго на активных элементах и индикаторах работы агентов. Без него — чистый монохром.',
      )}
      {row(
        'ambient',
        'Фоновое свечение',
        'Фоновое изображение с медленным движением, искры и свет под курсором.',
      )}
      {row('reducedMotion', 'Меньше анимации', 'Отключает переходы и пульсации. Удобно на слабых машинах.')}
      {row(
        'enterToSend',
        'Enter отправляет сообщение',
        'Иначе отправка — по ' + modKey + '+Enter, а Enter переносит строку.',
      )}
      {row('showOnline', 'Показывать, кто в сети', 'Статус участников в сайдбаре и списке людей.')}
      {row(
        'notifyEscalations',
        'Уведомлять об эскалациях',
        'Всплывающее уведомление, когда агенту нужно твоё решение.',
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Уведомления Windows</div>
          <div className="d">
            Когда окно не в фокусе: агент закончил, ждёт решения или упал с ошибкой. Клик по уведомлению
            открывает чат.
          </div>
        </div>
        <Switch
          on={!!s.osNotify}
          label="Уведомления Windows"
          onChange={async (v) => {
            if (!v) return set('osNotify', false)
            const r = await enableOsNotify()
            set('osNotify', r === 'granted')
            if (r !== 'granted')
              toast({
                title: 'Уведомления не разрешены',
                desc:
                  r === 'unsupported'
                    ? 'Окно не поддерживает уведомления'
                    : 'Разреши их для TetraFree в параметрах Windows',
                icon: 'warn',
                tone: 'warn',
              })
          }}
        />
      </div>
      <SystemRows />
      <UpdateRow />
    </>
  )
}

/** Проверка и установка обновлений из GitHub Releases (только десктоп) */
function UpdateRow() {
  const [st, setSt] = useState<'idle' | 'busy' | 'none' | 'ready' | 'err'>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [err, setErr] = useState('')
  const auto = useStore((x) => x.settings.autoUpdate !== false)
  const setSetting = useStore((x) => x.setSetting)
  if (!isDesktop) return null
  const check = async () => {
    setSt('busy')
    try {
      const u = await updCheck()
      setInfo(u)
      setSt(u ? 'ready' : 'none')
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
      setSt('err')
    }
  }
  const install = async () => {
    setSt('busy')
    try {
      await updInstall()
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
      setSt('err')
    }
  }
  return (
    <>
      <div className="srow">
        <div className="sl">
          <div className="t">Обновляться при запуске</div>
          <div className="d">
            Как в Discord: при старте приложение проверяет GitHub Releases, сразу скачивает новую версию и
            перезапускается уже обновлённым. Без сети запускается как обычно.
          </div>
        </div>
        <Switch on={auto} label="Обновляться при запуске" onChange={(v) => setSetting('autoUpdate', v)} />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Обновления</div>
          <div className="d">
            {st === 'none' && `Установлена последняя версия (${APP_VERSION}).`}
            {st === 'ready' && info && `Доступна версия ${info.version}. ${info.notes ?? ''}`}
            {st === 'err' && `Не удалось: ${err}`}
            {(st === 'idle' || st === 'busy') &&
              `Сейчас ${APP_VERSION}. Новые версии берутся из GitHub Releases.`}
          </div>
        </div>
        {st === 'ready' ? (
          <button className="btn sm pri" onClick={install}>
            Установить и перезапустить
          </button>
        ) : (
          <button className="btn sm" disabled={st === 'busy'} onClick={check}>
            {st === 'busy' ? 'Проверяю…' : 'Проверить'}
          </button>
        )}
      </div>
    </>
  )
}

/** Автозапуск, трей и глобальная «быстрая задача» — только в десктопной сборке с фичей extras */
function SystemRows() {
  const [info, setInfo] = useState<SysInfo | null>(null)
  useEffect(() => {
    void sysInfo().then(setInfo)
  }, [])
  if (!info) return null
  const fail = (e: unknown) =>
    toast({
      title: 'Не удалось изменить',
      desc: String((e as Error)?.message ?? e),
      icon: 'warn',
      tone: 'warn',
    })
  return (
    <>
      <div className="srow">
        <div className="sl">
          <div className="t">Запускать вместе с Windows</div>
          <div className="d">
            TetraFree стартует при входе в систему; если включён значок в трее — сразу прячется в него.
          </div>
        </div>
        <Switch
          on={info.autostart}
          label="Запускать вместе с Windows"
          onChange={(v) =>
            sysSetAutostart(v)
              .then(() => setInfo({ ...info, autostart: v }))
              .catch(fail)
          }
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Значок в трее</div>
          <div className="d">
            Закрытие окна прячет приложение в трей, агенты и сервер продолжают работать. Выход — в меню
            значка.
          </div>
        </div>
        <Switch
          on={info.tray}
          label="Значок в трее"
          onChange={(v) =>
            sysSetTray(v)
              .then(() => setInfo({ ...info, tray: v }))
              .catch(fail)
          }
        />
      </div>
      {info.shortcut && (
        <div className="srow">
          <div className="sl">
            <div className="t">Быстрая задача из любого окна</div>
            <div className="d">
              <kbd>{info.shortcut}</kbd> показывает TetraFree и открывает форму новой задачи.
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function Shortcuts() {
  const [hq, setHq] = useState('')
  const [rec, setRec] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const custom = useStore((x) => x.settings.keys)
  const set = useStore((x) => x.setSetting)
  const map = effective(custom)
  const needle = hq.trim().toLowerCase()
  const keysOf = (h: (typeof HOTKEYS)[number]) => (h.id ? parts(map[h.id], modKey) : h.keys)
  const shown = needle
    ? HOTKEYS.filter(
        (h) => h.label.toLowerCase().includes(needle) || keysOf(h).join(' ').toLowerCase().includes(needle),
      )
    : HOTKEYS
  const changed = Object.keys(custom || {}).length
  useEffect(() => {
    if (!rec) return
    const on = (e: KeyboardEvent) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRec(null)
        setErr('')
        return
      }
      const c = comboOf(e)
      if (!c) {
        setErr('Эту клавишу назначить нельзя')
        return
      }
      const bad = check(map, rec, c)
      if (bad) {
        setErr(bad)
        return
      }
      const def = ACTIONS.find((a) => a.id === rec)!.def
      const next = { ...(custom || {}) }
      if (c === def) delete next[rec]
      else next[rec] = c
      set('keys', Object.keys(next).length ? next : undefined)
      setRec(null)
      setErr('')
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [rec, custom]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <h2>Горячие клавиши</h2>
      <p className="sd">
        Почти всё делается с клавиатуры. Нажми на сочетание, чтобы заменить его, и набери новое (Esc —
        отмена). Работает в любой раскладке. Палитра команд понимает префиксы: <code>&gt;</code> команды,{' '}
        <code>@</code> люди, <code>#</code> чаты, <code>/</code> файлы, <code>?</code> текст, <code>*</code>{' '}
        задачи, <code>:</code> строка, <code>!</code> TODO из кода.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="hk-search" style={{ flex: 1 }}>
          <Icon name="search" size={13} />
          <input
            value={hq}
            onChange={(e) => setHq(e.target.value)}
            placeholder="Найти сочетание"
            aria-label="Найти сочетание"
          />
        </label>
        {changed > 0 && (
          <button
            className="btn sm"
            onClick={() => {
              set('keys', undefined)
              setRec(null)
              setErr('')
            }}
          >
            Сбросить все ({changed})
          </button>
        )}
      </div>
      {err && (
        <div className="hk-err" role="alert">
          {err}
        </div>
      )}
      <div className="hk-grid">
        {!shown.length && (
          <div className="t4" style={{ padding: '10px 2px' }}>
            Ничего не найдено
          </div>
        )}
        {shown.map((h) => (
          <div className="hk" key={h.label}>
            <span>{h.label}</span>
            {h.id ? (
              <span className="hk-k">
                {custom?.[h.id] && (
                  <button
                    className="linkbtn hk-reset"
                    onClick={() => {
                      const n = { ...custom }
                      delete n[h.id!]
                      set('keys', Object.keys(n).length ? n : undefined)
                    }}
                  >
                    сбросить
                  </button>
                )}
                <button
                  className={'hk-edit' + (rec === h.id ? ' rec' : '')}
                  aria-label={`${h.label}: изменить сочетание`}
                  onClick={() => {
                    setRec(rec === h.id ? null : h.id!)
                    setErr('')
                  }}
                >
                  {rec === h.id ? (
                    <span className="t4">Нажми сочетание…</span>
                  ) : (
                    keysOf(h).map((k, i) => <Kbd key={i}>{k}</Kbd>)
                  )}
                </button>
              </span>
            ) : (
              <span className="hk-k">
                {h.keys.map((k, i) => (
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function StorageRow() {
  const used = useMemo(() => storageUsed(), [])
  const lvl = storageLevel(used)
  return (
    <div className="srow">
      <div className="sl">
        <div className="t">Локальное хранилище</div>
        <div className="d">
          Проекты, чаты и настройки лежат в хранилище приложения. Занято {fmtMb(used)} из примерно{' '}
          {fmtMb(STORAGE_LIMIT)}.
          {lvl !== 'ok' &&
            ' Места остаётся мало: сделайте резервную копию и удалите старые проекты, иначе новые изменения перестанут сохраняться.'}
        </div>
        <div
          className={'meter ' + lvl}
          role="progressbar"
          aria-label="Занято локальное хранилище"
          aria-valuenow={Math.min(100, Math.round((used / STORAGE_LIMIT) * 100))}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: Math.min(100, (used / STORAGE_LIMIT) * 100) + '%' }} />
        </div>
      </div>
    </div>
  )
}

function BackendSection() {
  const backupIn = useRef<HTMLInputElement>(null)
  const b = useBackend()
  const set = useStore((x) => x.setSetting)
  const sync = useStore((x) => x.settings.backendSync !== false)
  const av = useStore((x) => x.settings.autoVerify !== false)
  const url = useStore((x) => x.settings.backendUrl || '')
  const project = useProject()
  const [draft, setDraft] = useState(url)
  const [busy, setBusy] = useState(false)
  const autoBk = useStore((x) => x.settings.autoBackup)
  const [bks, setBks] = useState<BackupInfo | null>(null)
  const eds = useEditors((x) => x.list)
  const edLoaded = useEditors((x) => x.loaded)
  const edPref = useStore((x) => x.settings.editor)
  const edPath = useStore((x) => x.settings.editorPath || '')
  const [edDraft, setEdDraft] = useState(edPath)
  const [edMsg, setEdMsg] = useState('')
  const applyEdPath = async () => {
    const v = edDraft.trim().replace(/^"(.*)"$/, '$1')
    if (!v) {
      set('editorPath', undefined)
      setEdMsg('')
      void loadEditors()
      return
    }
    try {
      const r = await bCheckEditor(v)
      if (!r.ok) return setEdMsg(r.reason || 'Файл не найден')
      set('editorPath', v)
      set('editor', 'custom')
      setEdMsg('Добавлено: ' + r.name)
      void loadEditors()
    } catch (e) {
      setEdMsg((e as Error).message)
    }
  }
  useEffect(() => {
    if (b.status === 'online') void loadEditors()
  }, [b.status])
  useEffect(() => {
    if (b.status === 'online')
      bBackup()
        .then(setBks)
        .catch(() => {})
  }, [b.status])
  const apply = () => {
    set('backendUrl', draft.trim() || undefined)
    setBackendUrl(draft)
  }
  return (
    <>
      <h2>Бэкенд и диск</h2>
      <p className="sd">
        Локальный сервер TetraFree даёт настоящую папку проекта на диске, реальный терминал, git-коммиты на
        каждую версию и запросы к моделям без CORS. Без него терминала, пайплайнов и папки на диске нет.
      </p>
      {project && (
        <div className="srow">
          <div className="sl">
            <div className="t">Папка проекта «{project.name}»</div>
            <div className="d mono">{project.path || 'определится при первой синхронизации'}</div>
          </div>
          <button
            className="btn sm"
            disabled={b.status !== 'online'}
            onClick={() => void bReveal(project).catch(() => {})}
          >
            Показать
          </button>
          <button
            className="btn sm"
            disabled={b.status !== 'online'}
            onClick={() => useStore.getState().openModal({ type: 'projectFolder', id: project.id })}
          >
            Сменить…
          </button>
        </div>
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Состояние</div>
          <div className="d">
            {b.status === 'online'
              ? `Подключён · v${b.info?.version} · Node ${b.info?.node} · ${b.info?.platform}`
              : b.status === 'checking'
                ? 'Проверяю…'
                : 'Не найден. Запусти в папке приложения: npm run server (или npm run dev — он уже встроен)'}
          </div>
        </div>
        <span className={'chip sm' + (b.status === 'online' ? ' live' : '')}>
          {b.status === 'online' ? 'онлайн' : b.status === 'checking' ? 'проверка' : 'офлайн'}
        </span>
      </div>
      {b.status === 'online' && (
        <div className="srow">
          <div className="sl">
            <div className="t">Корневая папка проектов</div>
            <div className="d mono">{b.info?.root}</div>
          </div>
        </div>
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Адрес бэкенда</div>
          <div className="d">
            Пусто — искать автоматически (тот же адрес, затем 127.0.0.1:3001). Принимаются только локальные
            адреса.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="inp"
            style={{ width: 210 }}
            placeholder="http://127.0.0.1:3001"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
          />
          <button className="btn sm" onClick={apply}>
            Подключить
          </button>
        </div>
      </div>
      {b.status === 'online' && (
        <div className="srow">
          <div className="sl">
            <div className="t">Внешний редактор</div>
            <div className="d">
              {!edLoaded
                ? 'Ищу установленные редакторы…'
                : eds.length
                  ? 'Открывается из меню файла, палитры и проекта на главном экране — сразу на нужной строке.'
                  : 'Не найден: установи VS Code, Cursor, Zed или Sublime Text, TetraFree увидит их сам.'}
            </div>
          </div>
          {eds.length > 0 && (
            <Segmented
              label="Редактор по умолчанию"
              value={pickEditor(eds, edPref)?.id ?? ''}
              options={eds.map((e) => ({ k: e.id, t: e.name }))}
              onChange={(k) => set('editor', k)}
            />
          )}
        </div>
      )}
      {b.status === 'online' && (
        <div className="srow">
          <div className="sl">
            <div className="t">Свой редактор</div>
            <div className="d">
              {edMsg ||
                'Если твоего редактора нет в списке (портативная версия, другая папка) — укажи полный путь к программе. Пусто — убрать.'}
            </div>
          </div>
          <input
            className="inp mono"
            style={{ width: 260 }}
            value={edDraft}
            placeholder="C:\\Tools\\Code\\Code.exe"
            aria-label="Путь к редактору"
            onChange={(e) => setEdDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void applyEdPath()}
          />
          <button className="btn sm" onClick={() => void applyEdPath()}>
            Применить
          </button>
        </div>
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Синхронизация с диском</div>
          <div className="d">
            Файлы проекта пишутся в папку сразу после правки. Если ты меняешь файлы в VS Code или командами в
            терминале, правки подхватываются и становятся версией «Правки с диска».
          </div>
        </div>
        <Switch on={sync} onChange={(v) => set('backendSync', v)} label="Синхронизация" />
      </div>
      {project && b.status === 'online' && (
        <div className="srow">
          <div className="sl">
            <div className="t">Проект «{project.name}»</div>
            <div className="d">
              {b.syncing
                ? 'Синхронизация…'
                : b.lastSync
                  ? `Последняя сверка ${ago(b.lastSync)}`
                  : 'Ещё не сверялся'}
              {b.lastError ? ` · ошибка: ${b.lastError}` : ''}
            </div>
          </div>
          <button
            className="btn sm"
            disabled={busy || !sync}
            onClick={async () => {
              setBusy(true)
              const r = await resyncNow()
              setBusy(false)
              toast({
                title: r ? 'Сверка выполнена' : 'Не удалось сверить',
                desc: r ? `на диск: ${r.pushed} · с диска: ${r.pulled}` : useBackend.getState().lastError,
                icon: r ? 'check' : 'warn',
                tone: r ? 'ok' : 'err',
              })
            }}
          >
            <Icon name="refresh" size={13} />
            Сверить сейчас
          </button>
        </div>
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Проверять правки агента</div>
          <div className="d">
            После правок живой модели запускается typecheck / lint / test проекта (или проверка синтаксиса).
            Если проверка падает, агент один раз исправляет ошибки сам. Нужен реальный shell.
          </div>
        </div>
        <Switch
          on={av}
          label="Проверять правки агента"
          onChange={(v) => useStore.getState().setSetting('autoVerify', v)}
        />
      </div>
      <StorageRow />
      <div className="srow">
        <div className="sl">
          <div className="t">Резервная копия</div>
          <div className="d">
            Все проекты и настройки одним файлом. Ключи провайдеров в файл не попадают. При восстановлении
            ничего не затирается — совпавшие проекты получают новое имя.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn sm"
            onClick={() => {
              const n = exportBackup()
              toast({ title: 'Копия сохранена', desc: `проектов: ${n}`, icon: 'down' })
            }}
          >
            <Icon name="down" size={13} />
            Сохранить
          </button>
          <button className="btn sm" onClick={() => backupIn.current?.click()}>
            <Icon name="upload" size={13} />
            Восстановить
          </button>
          <input
            ref={backupIn}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f)
                importBackup(f)
                  .then((n) =>
                    toast({ title: 'Копия восстановлена', desc: `добавлено проектов: ${n}`, icon: 'check' }),
                  )
                  .catch((er) =>
                    toast({
                      title: 'Не удалось восстановить',
                      desc: (er as Error).message,
                      icon: 'warn',
                      tone: 'warn',
                    }),
                  )
            }}
          />
        </div>
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Копия на диск</div>
          <div className="d">
            {autoBk === false ? 'Выключено.' : 'Раз в сутки сама.'}{' '}
            {lastAutoBackup() ? `Последняя ${ago(lastAutoBackup())}.` : 'Ещё не делалась.'}{' '}
            {bks ? `В папке ${bks.dir} — ${bks.list.length} шт., хранятся 14 последних.` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Switch
            on={autoBk !== false}
            label="Копия на диск каждый день"
            onChange={(v) => set('autoBackup', v)}
          />
          <button
            className="btn sm"
            disabled={busy || b.status !== 'online'}
            onClick={async () => {
              setBusy(true)
              try {
                setBks(await backupNow())
              } catch (er) {
                toast({
                  title: 'Не удалось сделать копию',
                  desc: (er as Error).message,
                  icon: 'warn',
                  tone: 'warn',
                })
              }
              setBusy(false)
            }}
          >
            <Icon name="down" size={13} />
            Сделать сейчас
          </button>
        </div>
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Проверить подключение</div>
        </div>
        <button className="btn sm" onClick={() => void detectBackend()}>
          <Icon name="refresh" size={13} />
          Проверить
        </button>
      </div>
      {isDesktop && (
        <div className="srow col">
          <ServerHelp always />
        </div>
      )}
    </>
  )
}

/** Сводка для отчёта об ошибке: версия, система, сервер, проект. Ключей и содержимого файлов нет. */
function diagnostics() {
  const s = useStore.getState()
  const b = useBackend.getState()
  const p = s.projects.find((x) => x.id === s.projectId)
  const i = b.info
  return [
    `TetraFree ${APP_VERSION}`,
    `Окно: ${navigator.userAgent}`,
    `Сервер: ${b.status}${i ? ` · v${i.version} · node ${i.node} · ${i.platform} · shell ${i.shell} · git ${i.git ? 'да' : 'нет'} · pty ${i.pty ? 'да' : 'нет'}` : ''}`,
    b.lastError ? `Последняя ошибка синхронизации: ${b.lastError}` : '',
    `Проектов: ${s.projects.length}; провайдеров: ${s.providers.length}; модель: ${s.model || 'не выбрана'}`,
    p
      ? `Проект: ${p.name} · ${p.path || 'путь не определён'} · файлов ${Object.keys(p.files).length} · версий ${p.versions.length}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function WhatsNew() {
  useEffect(() => {
    markSeen()
  }, [])
  return (
    <>
      <h2>Что нового</h2>
      <div className="set-actions">
        <button
          className="btn sm"
          onClick={() => {
            copyText(diagnostics())
            toast({
              title: 'Диагностика скопирована',
              desc: 'Без ключей и содержимого файлов',
              icon: 'copy',
              tone: 'ok',
            })
          }}
        >
          <Icon name="copy" size={13} />
          Скопировать диагностику
        </button>
      </div>
      <p className="sd">
        История обновлений. Версия {APP_VERSION}. x.y.Z — исправления, x.Y.0 — новые функции, X.0.0 — крупные
        переработки.
      </p>
      <div className="rel-list">
        {RELEASES.map((r, i) => (
          <article key={r.v} className={'rel' + (i === 0 ? ' cur' : '')}>
            <header>
              <span className={'rel-kind ' + r.kind}>{KIND_LABEL[r.kind]}</span>
              <b>{r.name}</b>
              <span className="mono rel-v">v{r.v}</span>
              <span className="grow" />
              <time className="t4">
                {new Date(r.date).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            </header>
            <p>{r.lead}</p>
            <ul>
              {r.notes.map((n, j) => (
                <li key={j}>
                  <span className={'rel-n ' + n.k}>{NOTE_LABEL[n.k]}</span>
                  {n.t}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  )
}
