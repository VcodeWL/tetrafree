/* Открытие проекта: пока идёт первая сверка с папкой на диске, показываем, что именно происходит.
   Никаких искусственных пауз: оверлей живёт ровно столько, сколько длится сверка (и не дольше 4 с). */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { Icon } from '../components/ui/Icon'
import { Logo } from '../components/ui/primitives'
import { backendOnline, useBackend } from '../lib/backend'
import { reconcile } from '../lib/sync'
import { nFiles, sleep } from '../lib/util'

export function Boot() {
  const pid = useStore((s) => s.projectId)
  const opened = useStore((s) => s.projects.find((p) => p.id === s.projectId)?.openedAt)
  const [show, setShow] = useState(false)
  const [detail, setDetail] = useState('')
  const [warn, setWarn] = useState(false)
  const run = useRef(0)

  useEffect(() => {
    if (!pid || !opened || !backendOnline()) return
    const ref = run
    const my = ++ref.current
    const alive = () => ref.current === my
    setShow(true)
    setWarn(false)
    setDetail(useStore.getState().projects.find((x) => x.id === pid)?.path || '')
    void (async () => {
      const r = await Promise.race([
        reconcile(pid, { quiet: true }),
        sleep(4000).then(() => 'timeout' as const),
      ])
      if (!alive()) return
      if (r === 'timeout') {
        setWarn(true)
        setDetail('Папка отвечает долго — досинхронизирую в фоне')
        await sleep(1200)
      } else if (!r) {
        setWarn(true)
        setDetail(useBackend.getState().lastError || 'Синхронизация уже идёт')
        await sleep(1500)
      } else {
        setDetail(
          `${r.pulled ? `прочитано с диска: ${nFiles(r.pulled)}` : 'файлы совпадают с диском'}${r.pushed ? ` · записано: ${r.pushed}` : ''}`,
        )
        if (r.truncated) {
          setWarn(true)
          setDetail('Папка большая: прочитана только часть файлов (до 2500 файлов / 4 МБ текста)')
          await sleep(2200)
        } else if (r.pulled || r.pushed) await sleep(500)
      }
      if (alive()) setShow(false)
    })()
    return () => {
      ref.current++
    }
  }, [pid, opened])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="boot"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          onClick={() => setShow(false)}
        >
          <div className="boot-card">
            <Logo size={44} />
            <div className="boot-t">Открываю проект</div>
            <ul>
              <li className={warn ? 'warn' : 'run'}>
                <span className="bi">
                  {warn ? (
                    <Icon name="warn" size={13} />
                  ) : (
                    <span className="tspin" style={{ width: 13, height: 13 }} />
                  )}
                </span>
                <div>
                  <b>Сверяю с папкой на диске</b>
                  <span className="mono">{detail}</span>
                </div>
              </li>
            </ul>
            <button className="linkbtn" onClick={() => setShow(false)}>
              Скрыть
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
