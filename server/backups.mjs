/* Имена файлов автокопий и ротация: храним N последних. */
export const PREFIX = 'tetrafree-auto-'
export const stamp = (d = new Date()) => {
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
export const nameFor = (d) => `${PREFIX}${stamp(d)}.json`
export const isBackupName = (n) => /^tetrafree-auto-\d{8}-\d{6}\.json$/.test(n)
/** Какие файлы удалить, чтобы осталось `keep` самых новых (имя содержит время, сортировка по имени = по времени) */
export function stale(names, keep) {
  const own = names.filter(isBackupName).sort()
  return own.slice(0, Math.max(0, own.length - Math.max(1, keep)))
}
