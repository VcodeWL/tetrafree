import { useEffect, useRef, useState } from 'react'
import { Switch } from './ui/primitives'
import { useStore } from '../store'
import {
  sysInfo,
  sysSetAutostart,
  sysSetTray,
  sysSetNotifications,
  desktopQuit,
  type SysInfo,
} from '../lib/desktop'

/** Settings replacement for the old local SystemRows. Preferences default OFF
 * natively; UI only reports values read back after a successful OS operation. */
export function DesktopSystemRows() {
  const globalNotify = useStore((state) => state.settings.osNotify)
  const [info, setInfo] = useState<SysInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void sysInfo().then((value) => {
      if (mounted.current) setInfo(value)
    })
    return () => {
      mounted.current = false
    }
  }, [])
  if (!info) return null
  const change = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
      const next = await sysInfo()
      if (mounted.current && next) setInfo(next)
    } catch {
      if (mounted.current) setError('Не удалось изменить системную настройку. Повтори попытку в Windows.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <fieldset
      disabled={busy}
      aria-label="Системная интеграция Windows"
      style={{ border: 0, padding: 0, margin: 0 }}
    >
      {error && <p role="alert">{error}</p>}
      <div className="srow">
        <div className="sl">
          <div className="t">Запускать вместе с Windows</div>
          <div className="d">
            Только по твоему согласию. С включённым треем приложение может запускаться в фоне.
          </div>
        </div>
        <Switch
          on={info.autostart}
          label="Запускать вместе с Windows"
          onChange={(on) => {
            void change(() => sysSetAutostart(on))
          }}
        />
      </div>
      <div className="srow">
        <div className="sl">
          <div className="t">Значок в трее и работа в фоне</div>
          <div className="d">
            После подтверждённого сохранения закрытие скрывает окно; агенты и сервер продолжают работу. Полный
            выход — через меню значка или кнопку ниже. При ошибке сохранения окно остаётся открытым.
          </div>
        </div>
        <Switch
          on={info.tray}
          label="Значок в трее и работа в фоне"
          onChange={(on) => {
            void change(() => sysSetTray(on))
          }}
        />
      </div>
      {info.notificationSupported && (
        <div className="srow">
          <div className="sl">
            <div className="t">Уведомления Windows в фоне</div>
            <div className="d">
              Только когда окно не в фокусе. Для автоматизаций также включи их отдельное согласие. Настройки
              уведомлений и «Не беспокоить» Windows могут скрывать сообщения.
            </div>
          </div>
          <Switch
            on={info.notifications && !!globalNotify}
            label="Уведомления Windows в фоне"
            onChange={(on) => {
              void change(async () => {
                await sysSetNotifications(on)
                useStore.getState().setSetting('osNotify', on)
              })
            }}
          />
        </div>
      )}
      {info.shortcut && (
        <div className="srow">
          <div className="sl">
            <div className="t">Быстрая задача из любого окна</div>
            <div className="d">
              <kbd>{info.shortcut}</kbd> показывает TetraFree.
            </div>
          </div>
        </div>
      )}
      <div className="srow">
        <div className="sl">
          <div className="t">Полный выход</div>
          <div className="d">Сначала подтверждается сохранение, затем останавливаются сервер и агенты.</div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void change(desktopQuit)
          }}
        >
          Сохранить и выйти
        </button>
      </div>
    </fieldset>
  )
}
