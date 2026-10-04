/* Копия server/ignore.mjs (клиент должен знать, какие файлы сервер не показывает, чтобы не счесть их удалёнными).
   Упрощённый разбор корневого .gitignore. Поддержано: имена, `dir/`, `/путь`, `*.ext`, `*` внутри имени, `**` перед именем. Отрицания (!) не учитываются. */
export function makeIgnore(text = ''): (rel: string, isDir: boolean) => boolean {
  const rules: { dirOnly: boolean; anchored: boolean; re: RegExp }[] = []
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    if (dirOnly) line = line.slice(0, -1)
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/')
    line = line.replace(/^\/+/, '').replace(/^\*\*\//, '')
    if (!line) continue
    const re = line
      .split('*')
      .map((s: string) => s.replace(/[.+?^$(){}|\\\[\]]/g, '\\$&'))
      .join('[^/]*')
    rules.push({ dirOnly, anchored, re: new RegExp('^' + re + '$') })
  }
  /** rel — путь от корня через «/», isDir — это папка */
  return (rel, isDir) => {
    const parts = rel.split('/')
    return rules.some((r) => {
      if (r.anchored) {
        /* путь целиком или любой его родитель совпадает с правилом */
        for (let i = 1; i <= parts.length; i++) {
          const sub = parts.slice(0, i).join('/')
          if (r.re.test(sub) && (i < parts.length || !r.dirOnly || isDir)) return true
        }
        return false
      }
      return parts.some((seg, i) => r.re.test(seg) && (i < parts.length - 1 || !r.dirOnly || isDir))
    })
  }
}
