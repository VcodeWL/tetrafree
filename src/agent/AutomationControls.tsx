import { Icon } from '../components/ui/Icon'
import {
  useAutomationControl,
  pauseAutomations,
  resumeAutomations,
  stopEverything,
} from './automationControl'

/** Embeddable in TitleBar/StatusBar and settings; does not start any scheduler. */
export function AutomationControls() {
  const { paused, storageError } = useAutomationControl()
  return (
    <span className="automation-controls" role="group" aria-label="Управление автоматическими запусками">
      <button
        className="btn sm gho"
        aria-label={paused ? 'Возобновить автоматизации' : 'Пауза автоматизаций'}
        onClick={paused ? resumeAutomations : pauseAutomations}
        title={
          storageError
            ? 'Хранилище недоступно; запуск заблокирован'
            : 'Расписания действуют только пока приложение открыто и проект выбран'
        }
      >
        {paused ? (
          <Icon name="play" size={13} />
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3v10M11 3v10" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
        <span className="automation-control-label">
          {paused ? 'Возобновить автоматизации' : 'Пауза автоматизаций'}
        </span>
      </button>
      <button
        className="btn sm"
        aria-label="Остановить всё"
        onClick={stopEverything}
        title="Прервать агентов, циклы, пайплайны и очередь; расписания останутся на паузе"
      >
        <Icon name="stop" size={13} />
        <span className="automation-control-label">Остановить всё</span>
      </button>
      {storageError && (
        <span
          role="alert"
          className="automation-control-error"
          title="Не удалось сохранить настройки. Автоматизации заблокированы."
        >
          <Icon name="warn" size={14} />
          <span className="sr-only">Не удалось сохранить настройки. Автоматизации заблокированы.</span>
        </span>
      )}
    </span>
  )
}
