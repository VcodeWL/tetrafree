import { lazy, Suspense } from 'react'
import { useStore } from '../store'
import { ProviderModal, NewChatModal, ConfirmModal, RenameModal, ShortcutsModal, TaskModal } from './Forms'
import { NewProjectModal, ProjectFolderModal } from './NewProject'

/* Тяжёлые окна грузятся при первом открытии — запуск приложения от этого быстрее */
const BlameModal = lazy(() => import('./BlameModal').then((m) => ({ default: m.BlameModal })))
const TrashModal = lazy(() => import('./TrashModal').then((m) => ({ default: m.TrashModal })))
const SettingsModal = lazy(() => import('./Settings').then((m) => ({ default: m.SettingsModal })))
const VersionsModal = lazy(() => import('./Versions').then((m) => ({ default: m.VersionsModal })))
const ActivityModal = lazy(() => import('./Activity').then((m) => ({ default: m.ActivityModal })))
const DeployModal = lazy(() => import('./Deploy').then((m) => ({ default: m.DeployModal })))
const ReplaceModal = lazy(() => import('./Replace').then((m) => ({ default: m.ReplaceModal })))
const RemoteModal = lazy(() => import('./Remote').then((m) => ({ default: m.RemoteModal })))
const TodayModal = lazy(() => import('./Today').then((m) => ({ default: m.TodayModal })))
const CompareModal = lazy(() => import('./Compare').then((m) => ({ default: m.CompareModal })))
const ReplayModal = lazy(() => import('./Replay').then((m) => ({ default: m.ReplayModal })))

export function ModalRoot() {
  const body = useModalBody()
  return <Suspense fallback={null}>{body}</Suspense>
}

function useModalBody() {
  const m = useStore((s) => s.modal)
  const hasProject = useStore(
    (s) => !!s.projects.find((p) => p.id === s.projectId) && s.screen === 'workspace',
  )
  if (!m) return null
  const needsProject = [
    'versions',
    'activity',
    'deploy',
    'members',
    'newChat',
    'task',
    'replay',
    'blame',
    'trash',
    'replace',
    'remote',
  ].includes(m.type)
  if (needsProject && !hasProject) return null
  switch (m.type) {
    case 'settings':
      return <SettingsModal key={'s' + (m.section || '')} section={m.section} />
    case 'members':
      return <SettingsModal section="members" />
    case 'versions':
      return <VersionsModal focus={m.focus} />
    case 'replay':
      return <ReplayModal chatId={m.chatId} msgId={m.msgId} />
    case 'activity':
      return <ActivityModal />
    case 'deploy':
      return <DeployModal />
    case 'provider':
      return <ProviderModal key={m.id || 'new'} id={m.id} />
    case 'newChat':
      return <NewChatModal />
    case 'projectFolder':
      return <ProjectFolderModal id={m.id} />
    case 'newProject':
      return <NewProjectModal mode={m.mode} />
    case 'confirm':
      return <ConfirmModal {...m} />
    case 'rename':
      return <RenameModal {...m} />
    case 'remote':
      return <RemoteModal />
    case 'replace':
      return <ReplaceModal find={m.find} />
    case 'today':
      return <TodayModal />
    case 'blame':
      return <BlameModal path={m.path} />
    case 'trash':
      return <TrashModal />
    case 'compare':
      return <CompareModal a={m.a} b={m.b} />
    case 'shortcuts':
      return <ShortcutsModal />
    case 'task':
      return <TaskModal key={m.id || 'new'} id={m.id} status={m.status} />
  }
}
