/* Обновление при запуске, как в Discord: до интерфейса — заставка «проверяю → скачиваю → перезапуск».
   Нет сети, сборка без автообновления или проверка дольше 8 секунд — заставка уходит, приложение работает как обычно. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Logo } from './ui/primitives'
import { useStore } from '../store'
import { isDesktop, onUpdateProgress, updCheck, updInstall, type UpdateInfo } from '../lib/desktop'

type Phase = 'check' | 'download' | 'install' | 'error' | 'done'

const mb = (n: number) => (n / 1048576).toFixed(1).replace('.', ',')

/** проверка с таймаутом: null — обновлений нет или проверить не вышло */
export async function checkWithTimeout(ms = 8000): Promise<UpdateInfo | null> {
  return Promise.race([
    updCheck().catch(() => null),
    new Promise<null>((r) => window.setTimeout(() => r(null), ms)),
  ])
}

export function UpdateGate() {
  const enabled = isDesktop && useStore.getState().settings.autoUpdate !== false
  const [phase, setPhase] = useState<Phase>(enabled ? 'check' : 'done')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [got, setGot] = useState<{ done: number; total: number | null }>({ done: 0, total: null })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let off = () => {}
    void (async () => {
      const u = await checkWithTimeout()
      if (!alive) return
      if (!u) return setPhase('done')
      setInfo(u)
      setPhase('download')
      off = await onUpdateProgress((done, total) => {
        if (!alive) return
        setGot({ done, total })
        if (total && done >= total) setPhase('install')
      })
      try {
        await updInstall() /* ставит и перезапускает — дальше код не выполнится */
      } catch (e) {
        if (!alive) return
        setErr(String((e as Error)?.message ?? e))
        setPhase('error')
        window.setTimeout(() => alive && setPhase('done'), 6000)
      }
    })()
    return () => {
      alive = false
      off()
    }
  }, [enabled])

  const pct = got.total ? Math.min(100, Math.round((got.done / got.total) * 100)) : null
  const title =
    phase === 'check'
      ? 'Проверяю обновления…'
      : phase === 'download'
        ? `Скачиваю версию ${info?.version ?? ''}`
        : phase === 'install'
          ? 'Устанавливаю и перезапускаюсь…'
          : 'Не удалось обновиться'
  return (
    <AnimatePresence>
      {phase !== 'done' && (
        <motion.div
          className="upd-gate"
          role="status"
          aria-live="polite"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          <motion.div
            className="upd-card"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Logo size={64} />
            <h1>{title}</h1>
            {(phase === 'download' || phase === 'install') && (
              <>
                <div
                  className="upd-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={phase === 'install' ? 100 : (pct ?? undefined)}
                  aria-label="Загрузка обновления"
                >
                  <i
                    className={pct === null && phase === 'download' ? 'ind' : ''}
                    style={{ width: phase === 'install' ? '100%' : pct === null ? undefined : pct + '%' }}
                  />
                </div>
                <p className="upd-sub">
                  {phase === 'install'
                    ? 'Сервер остановлен, запускается установщик'
                    : got.total
                      ? `${mb(got.done)} из ${mb(got.total)} МБ · ${pct}%`
                      : got.done
                        ? `${mb(got.done)} МБ`
                        : 'Подключаюсь к GitHub…'}
                </p>
              </>
            )}
            {phase === 'check' && (
              <div className="upd-bar">
                <i className="ind" />
              </div>
            )}
            {phase === 'error' && (
              <>
                <p className="upd-sub">{err}</p>
                <button className="btn sm" onClick={() => setPhase('done')}>
                  Продолжить без обновления
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
