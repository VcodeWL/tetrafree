import type { TaskFilter } from '../lib/taskviews'
import type {
  Actor,
  Block,
  Center,
  Chat,
  ChatAgent,
  ID,
  Lane,
  Memory,
  Message,
  Person,
  Project,
  Provider,
  Settings,
  Task,
  TaskStatus,
  Version,
} from '../types'
import type { IconName } from '../components/ui/iconData'

export type Full = S & Actions
export type SetState = (fn: (s: Full) => void) => void
export type GetState = () => Full

export interface Toast {
  id: ID
  title: string
  desc?: string
  icon?: IconName
  tone?: 'ok' | 'warn' | 'err'
  action?: { label: string; run: () => void }
}
export type ModalState =
  | { type: 'settings'; section?: string }
  | { type: 'versions'; focus?: number }
  | { type: 'activity' }
  | { type: 'deploy' }
  | { type: 'members' }
  | { type: 'provider'; id?: ID }
  | { type: 'newChat' }
  | { type: 'projectFolder'; id: ID }
  | { type: 'newProject'; mode?: 'new' | 'open' }
  | { type: 'task'; id?: ID; status?: TaskStatus }
  | { type: 'replace'; find?: string }
  | { type: 'today' }
  | { type: 'compare'; a?: string; b?: string }
  | { type: 'trash' }
  | { type: 'replay'; chatId: ID; msgId: ID }
  | { type: 'blame'; path: string }
  | { type: 'confirm'; title: string; body: string; danger?: boolean; confirm: string; run: () => void }
  | {
      type: 'rename'
      title: string
      value: string
      run: (v: string) => void
      check?: (v: string) => string | null
      label?: string
      hint?: string
    }
  | { type: 'shortcuts' }
export interface BuildSummary {
  version: number
  files: number
  components: number
  screen: string
}

export interface Persisted {
  authed: boolean
  people: Record<ID, Person>
  projects: Project[]
  providers: Provider[]
  settings: Settings
  model: string
  rightWidth: number
  taskView: 'board' | 'list' | 'timeline'
  lastProject: ID | null
  sort: 'recent' | 'name'
}
export interface UI {
  screen: 'auth' | 'launcher' | 'workspace'
  authMode: 'signin' | 'signup'
  projectId: ID | null
  center: Center
  mode: 'dev' | 'design'
  rightOpen: boolean
  rightTab: 'code' | 'browser' | 'git'
  activeFile: string | null
  dirty: Record<string, string>
  closedDirs: Record<string, boolean>
  viewVersion: Record<ID, number | null>
  modal: ModalState | null
  palette: boolean
  toasts: Toast[]
  summary: BuildSummary | null
  sideOpen: boolean
  drafts: Record<ID, string>
  dock: boolean
  sideHidden: boolean
}
export type S = Persisted & UI
export type P = (p: Project) => void

export interface Actions {
  signIn: (name: string | null, email: string, hue?: number) => void
  signOut: () => void
  setAuthMode: (m: UI['authMode']) => void
  toLauncher: () => void
  openProject: (id: ID) => void
  createProject: (o: { name: string; path: string; template: string; adopt?: boolean }) => ID
  renameProject: (id: ID, name: string) => void
  deleteProject: (id: ID) => void
  duplicateProject: (id: ID) => void
  setSort: (s: Persisted['sort']) => void
  up: (fn: P, pid?: ID) => void
  setCenter: (c: Center) => void
  setMode: (m: UI['mode']) => void
  setRight: (o: Partial<Pick<UI, 'rightOpen' | 'rightTab'>>) => void
  setRightWidth: (w: number) => void
  openFile: (path: string) => void
  setDirty: (path: string, content: string | null) => void
  toggleDir: (dir: string) => void
  createChat: (o: { title: string; creator: Actor; agents: ChatAgent[]; first?: Message[] }) => ID
  renameChat: (id: ID, title: string) => void
  duplicateChat: (id: ID) => ID | null
  deleteChat: (id: ID) => void
  pushMsg: (chatId: ID, m: Message, pid?: ID) => void
  patchMsg: (chatId: ID, msgId: ID, patch: Partial<Message>, pid?: ID) => void
  setChat: (chatId: ID, patch: Partial<Chat>, pid?: ID) => void
  setDraft: (chatId: ID, v: string) => void
  createDoc: () => ID
  /** добавить готовые документы (импорт); открывает первый */
  addDocs: (docs: { title: string; blocks: Block[] }[]) => void
  updateDoc: (id: ID, patch: { title?: string; blocks?: Block[] }) => void
  deleteDoc: (id: ID) => void
  saveTask: (t: Partial<Task> & { title: string }) => ID
  moveTask: (id: ID, status: TaskStatus, beforeId?: ID | null) => void
  deleteTask: (id: ID) => void
  setTaskView: (v: Persisted['taskView']) => void
  writeFile: (path: string, content: string, pid?: ID) => void
  deleteFile: (path: string) => void
  renameFile: (from: string, to: string) => void
  addDir: (path: string) => void
  deletePath: (path: string) => void
  saveTaskView: (name: string, f: TaskFilter) => void
  removeTaskView: (id: ID) => void
  /** вернуть файлы из корзины (paths) в проект; занятый путь получает суффикс */
  restoreTrash: (paths: string[]) => string[]
  dropTrash: (paths?: string[]) => void
  renamePath: (from: string, to: string) => void
  commit: (v: Omit<Version, 'n' | 'at' | 'snapshot'>, pid?: ID) => number
  rollback: (n: number) => number
  setViewVersion: (n: number | null) => void
  setLanes: (fn: (l: Lane[]) => Lane[], pid?: ID) => void
  removeMember: (id: ID) => void
  updateMe: (patch: Partial<Person>) => void
  saveProvider: (p: Provider) => void
  deleteProvider: (id: ID) => void
  toggleProvider: (id: ID) => void
  setModel: (m: string) => void
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: ID) => void
  openModal: (m: ModalState) => void
  closeModal: () => void
  setPalette: (v: boolean) => void
  setSummary: (s: BuildSummary | null) => void
  setSideOpen: (v: boolean) => void
  resetData: () => void
  setDock: (v: boolean) => void
  setSideHidden: (v: boolean) => void
  remember: (m: Omit<Memory, 'id' | 'at'>, pid?: ID) => void
  forget: (id: ID) => void
  editMemory: (id: ID, patch: Partial<Pick<Memory, 'text' | 'kind'>>) => void
  restoreMemory: (m: Memory) => void
  addComment: (c: { file: string; line: number; anchor: string; text: string }) => void
  toggleComment: (id: ID) => void
  deleteComment: (id: ID) => void
  importProject: (p: Project) => void
  restoreProject: (p: Project, index: number) => void
  restoreChat: (c: Chat, index: number) => void
}
