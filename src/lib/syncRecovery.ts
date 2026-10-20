/** Reserve files separately from directories: a directory may contain a recovery file. */
export function recoveryPath(
  path: string,
  suffix: string,
  occupied: Iterable<string>,
  directories: Iterable<string> = [],
): string {
  const keyOf = (p: string) =>
    p
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.replace(/[ .]+$/, '').toLowerCase())
      .join('/')
  const names = [...occupied].map(keyOf)
  const dirs = [...directories].map(keyOf)
  // A file occupying a parent makes every sibling candidate invalid. Flatten instead of looping forever.
  if (names.some((p) => keyOf(path).startsWith(p + '/'))) path = path.replace(/[/\\]/g, '_')
  const taken = (candidate: string) => {
    const key = keyOf(candidate)
    return (
      names.some((p) => p === key || p.startsWith(key + '/') || key.startsWith(p + '/')) ||
      dirs.some((p) => p === key || p.startsWith(key + '/'))
    )
  }
  for (let n = 1; ; n++) {
    const candidate = `${path}.${suffix}${n === 1 ? '' : '.' + n}`
    if (!taken(candidate)) return candidate
  }
}
