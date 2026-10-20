import { useStore, toast } from '../store'
import { parseMd } from './mdimport'
import type { Block } from '../types'

const MAX = 300,
  BIG = 1_500_000

/** Выбор .md файлов (или папки) → документы текущего проекта */
export function importMd(folder: boolean) {
  const pid = useStore.getState().projectId
  if (!pid) return
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.multiple = true
  if (folder) inp.setAttribute('webkitdirectory', '')
  else inp.accept = '.md,.markdown,.txt,text/markdown,text/plain'
  inp.onchange = async () => {
    const all = Array.from(inp.files || []).filter((f) => /\.(md|markdown|txt)$/i.test(f.name))
    const skipped = (inp.files?.length || 0) - all.length
    const files = all.filter((f) => f.size <= BIG).slice(0, MAX)
    if (!files.length) {
      toast({
        title: 'Нет подходящих файлов',
        desc: 'Нужны .md, .markdown или .txt',
        icon: 'warn',
        tone: 'warn',
      })
      return
    }
    const docs: { title: string; blocks: Block[] }[] = []
    try {
      for (const f of files.sort((a, b) => a.name.localeCompare(b.name)))
        docs.push(parseMd(await f.text(), f.name.replace(/\.[^.]+$/, '')))
    } catch {
      toast({
        title: 'Импорт отменён',
        desc: 'Не удалось прочитать файлы. Документы не изменены.',
        icon: 'warn',
        tone: 'err',
      })
      return
    }
    const project = useStore.getState().projects.find((p) => p.id === pid)
    if (!project) {
      toast({ title: 'Импорт отменён', desc: 'Исходный проект удалён', icon: 'warn', tone: 'warn' })
      return
    }
    useStore.getState().addDocs(docs, pid)
    const note = [
      `В проект «${project.name}»`,
      skipped ? `пропущено других файлов: ${skipped}` : '',
      all.length > files.length ? `слишком больших или сверх ${MAX}: ${all.length - files.length}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    toast({
      title: `Импортировано документов: ${docs.length}`,
      desc: note || undefined,
      icon: 'check',
      tone: 'ok',
    })
  }
  inp.click()
}
