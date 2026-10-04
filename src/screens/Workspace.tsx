import { lazy, Suspense, type CSSProperties } from 'react'
import { useLayout } from '../lib/layout'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, useProject } from '../store'
import { Sidebar } from '../workspace/Sidebar'
import { ChatView } from '../workspace/ChatView'
import { DocView } from '../workspace/DocView'
import { TasksView } from '../workspace/TasksView'
import { RightPane } from '../workspace/RightPane'
import { Hero } from '../workspace/Hero'
import { Boot } from './Boot'

/* Студия дизайна и терминал (xterm) нужны не сразу — грузятся по требованию */
const Studio = lazy(() => import('../design/Studio').then((m) => ({ default: m.Studio })))
const Dock = lazy(() => import('../workspace/Terminal').then((m) => ({ default: m.Dock })))

export function Workspace() {
  const p = useProject()
  const center = useStore((s) => s.center)
  const mode = useStore((s) => s.mode)
  const rightOpen = useStore((s) => s.rightOpen)
  const rightWidth = useStore((s) => s.rightWidth)
  const dock = useStore((s) => s.dock)
  const sideHidden = useStore((s) => s.sideHidden)
  const sideOpen = useStore((s) => s.sideOpen)
  const sideW = useLayout((l) => l.sideW)
  const dockH = useLayout((l) => l.dockH)

  if (!p) return null
  const chat = center.kind === 'chat' ? p.chats.find((c) => c.id === center.id) : undefined
  const doc = center.kind === 'doc' ? p.docs.find((d) => d.id === center.id) : undefined
  const key = center.kind + ('id' in center ? center.id : '')
  const main = chat ? (
    <ChatView chat={chat} />
  ) : doc ? (
    <DocView doc={doc} />
  ) : center.kind === 'tasks' ? (
    <TasksView />
  ) : (
    <Hero />
  )

  return (
    <div
      className={'ws' + (sideHidden ? ' noside' : '') + (sideOpen ? ' sideopen' : '')}
      style={{ '--side-w': sideW + 'px', '--dock-h': dockH + 'px' } as CSSProperties}
    >
      <Sidebar />
      <div className="side-scrim" onClick={() => useStore.getState().setSideOpen(false)} />
      <main className="center">
        <button
          className="mobnav iconbtn"
          onClick={() => useStore.getState().setSideOpen(true)}
          aria-label="Меню"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </button>
        {mode === 'design' ? (
          <Suspense fallback={null}>
            <Studio />
          </Suspense>
        ) : (
          <div
            className={'split' + (rightOpen ? '' : ' full')}
            style={
              rightOpen
                ? { gridTemplateColumns: `minmax(0,1fr) clamp(340px, ${rightWidth}%, calc(100% - 520px))` }
                : undefined
            }
          >
            <div className="pane-left">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={key}
                  className="pane-anim"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {main}
                </motion.div>
              </AnimatePresence>
            </div>
            {rightOpen && <RightPane />}
          </div>
        )}
        {dock && mode === 'dev' && (
          <Suspense fallback={null}>
            <Dock />
          </Suspense>
        )}
      </main>
      <Boot />
    </div>
  )
}
