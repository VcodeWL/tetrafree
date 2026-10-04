/* Черновик сообщения коммита по списку изменённых файлов. Только подсказка — пользователь правит как хочет. */
export type MsgFile = { path: string; kind: 'new' | 'mod' | 'del' | 'ren' | 'conflict'; from?: string }
const base = (p: string) => p.split('/').pop() || p
const list = (ps: string[]) =>
  ps.length > 3 ? ps.slice(0, 3).map(base).join(', ') + ` и ещё ${ps.length - 3}` : ps.map(base).join(', ')

export function suggestMessage(files: MsgFile[]): string {
  if (!files.length) return ''
  if (files.length === 1) {
    const f = files[0]
    return f.kind === 'new'
      ? `Добавлен ${base(f.path)}`
      : f.kind === 'del'
        ? `Удалён ${base(f.path)}`
        : f.kind === 'ren'
          ? `Переименован ${f.from || f.path} → ${f.path}`
          : `Изменён ${base(f.path)}`
  }
  const by = (k: MsgFile['kind']) => files.filter((f) => f.kind === k).map((f) => f.path)
  const parts: string[] = []
  const add = by('new'),
    mod = by('mod').concat(by('conflict')),
    del = by('del'),
    ren = by('ren')
  if (add.length) parts.push('добавлено: ' + list(add))
  if (mod.length) parts.push('изменено: ' + list(mod))
  if (ren.length) parts.push('переименовано: ' + list(ren))
  if (del.length) parts.push('удалено: ' + list(del))
  const s = parts.join('; ')
  return s[0].toUpperCase() + s.slice(1)
}
