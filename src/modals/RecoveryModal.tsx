import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Modal, MHead } from '../components/ui/Modal'
import { Icon } from '../components/ui/Icon'
import {
  recoveryEntries,
  recoveryVariants,
  restoreRecoveryCopy,
  type RecoveryKind,
} from '../lib/recoveryCenter'
import { download, ago } from '../lib/util'
import { flushPersistence } from '../store/persistence'

const LABEL: Record<RecoveryKind, string> = {
  trash: 'Корзина и несохранённые правки',
  disk: 'Конфликт с диском',
  cloud: 'Облачная копия',
  journal: 'Журнал синхронизации',
  agent: 'Копия перед правкой агента',
}
export function RecoveryModal() {
  const projects = useStore((s) => s.projects)
  const current = useStore((s) => s.projectId)
  const [pid, setPid] = useState(current || projects[0]?.id || '')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const project = projects.find((p) => p.id === pid)
  const entries = useMemo(() => (project ? recoveryEntries(project) : []), [project])
  const filtered = useMemo(
    () => entries.filter((e) => (e.source + LABEL[e.kind]).toLowerCase().includes(query.toLowerCase())),
    [entries, query],
  )
  const entry = entries.find((e) => e.id === selected)
  const variants = useMemo(() => (entry ? recoveryVariants(entry) : []), [entry])
  const variant = variants.find((v) => v.id === choice) || variants[0]
  const live = project && variant ? project.files[variant.path] : undefined
  const restore = async () => {
    if (!project || !entry || !variant || busy) return
    const sourcePid = project.id
    setBusy(true)
    setNotice('')
    try {
      let path = ''
      useStore.setState((s) => {
        const origin = s.projects.find((p) => p.id === sourcePid)
        if (!origin) throw new Error('Исходный проект уже удалён')
        path = restoreRecoveryCopy(origin, entry, variant)
      })
      try {
        await flushPersistence()
        setNotice(`Копия сохранена: ${path}. Исходный файл и recovery не изменены.`)
      } catch {
        setNotice(
          `Копия ${path} есть в памяти, но сохранение не подтверждено. Скачай исходник и не закрывай приложение.`,
        )
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Не удалось создать копию')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal label="Центр восстановления" wide busy={busy}>
      <MHead
        icon="clock"
        title="Центр восстановления"
        sub="Просмотр конфликтов и сохранённых правок. Восстановление создаёт отдельную копию — текущие файлы не затираются."
      />
      <div className="recovery-toolbar">
        <label>
          Проект
          <select
            value={pid}
            disabled={busy}
            onChange={(e) => {
              setPid(e.target.value)
              setSelected('')
              setChoice('')
              setNotice('')
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Найти
          <input
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя файла или тип копии"
          />
        </label>
        <span className="dim">Копий: {filtered.length}</span>
      </div>
      <div className="recovery-layout">
        <div className="recovery-list" aria-label="Сохранённые копии">
          {!filtered.length && (
            <p className="dim">
              {project
                ? 'Сохранённых конфликтных или удалённых файлов пока нет.'
                : 'Выбери проект для просмотра.'}
            </p>
          )}
          {filtered.slice(0, 200).map((e) => (
            <button
              className={'recovery-item' + (e.id === selected ? ' on' : '')}
              disabled={busy}
              key={e.id}
              onClick={() => {
                setSelected(e.id)
                setChoice('')
                setNotice('')
              }}
            >
              <b>{e.source}</b>
              <span>
                {LABEL[e.kind]}
                {e.at ? ' · ' + ago(e.at) : ''}
              </span>
            </button>
          ))}
          {filtered.length > 200 && (
            <p className="dim">Показаны первые 200 копий. Уточни поиск, чтобы найти остальные.</p>
          )}
        </div>
        <div className="recovery-detail">
          {!entry ? (
            <p className="dim">Выбери копию слева. Содержимое отображается как текст и не выполняется.</p>
          ) : (
            <>
              <h3>{entry.source}</h3>
              {variants.length > 1 && (
                <label>
                  Файл и версия
                  <select
                    value={variant?.id || ''}
                    disabled={busy}
                    onChange={(e) => setChoice(e.target.value)}
                  >
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.path} — {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="recovery-actions">
                <button
                  className="btn sm"
                  onClick={() => download(entry.source.split('/').pop() || 'recovery.txt', entry.text)}
                >
                  <Icon name="down" size={13} />
                  Скачать исходную копию
                </button>
                {variant && (
                  <button className="btn sm pri" disabled={busy} onClick={() => void restore()}>
                    {busy ? 'Сохраняю…' : 'Создать восстановленную копию'}
                  </button>
                )}
              </div>
              {!variant && (
                <p className="dim">
                  Формат не предназначен для автоматического применения: это метаданные, большой или
                  неизвестный снимок. Его можно безопасно скачать и разобрать вручную. Удаления из журнала
                  автоматически не повторяются.
                </p>
              )}
              <div className="recovery-compare">
                <section>
                  <h4>Сохранённая версия{variant ? ' · ' + variant.label : ''}</h4>
                  <pre>{(variant?.text ?? entry.text).slice(0, 12000)}</pre>
                </section>
                {variant && (
                  <section>
                    <h4>Текущий файл · {variant.path}</h4>
                    {live === undefined ? (
                      <p className="dim">В исходном проекте такого файла сейчас нет.</p>
                    ) : (
                      <pre>{live.slice(0, 12000)}</pre>
                    )}
                  </section>
                )}
              </div>
              {(variant?.text ?? entry.text).length > 12000 && (
                <p className="dim">
                  Предпросмотр ограничен 12 000 символов; скачивание и восстановление сохраняют полный текст.
                </p>
              )}
            </>
          )}
          {notice && (
            <p className="recovery-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
