/* Выбор шрифтов из системных: ничего не скачиваем и не вшиваем. Если выбранного шрифта нет в системе, браузер берёт следующий в списке. */
export const UI_FONTS: { k: string; t: string; stack: string }[] = [
  { k: 'inter', t: 'Inter', stack: '"Inter",-apple-system,"Segoe UI",Roboto,system-ui,sans-serif' },
  { k: 'segoe', t: 'Segoe UI', stack: '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif' },
  { k: 'system', t: 'Системный', stack: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' },
  { k: 'arial', t: 'Arial', stack: 'Arial,"Helvetica Neue",sans-serif' },
]
export const CODE_FONTS: { k: string; t: string; stack: string }[] = [
  { k: 'jb', t: 'JetBrains Mono', stack: '"JetBrains Mono","SF Mono",ui-monospace,Consolas,monospace' },
  { k: 'cascadia', t: 'Cascadia Code', stack: '"Cascadia Code","Cascadia Mono",Consolas,monospace' },
  { k: 'consolas', t: 'Consolas', stack: 'Consolas,"Courier New",monospace' },
  { k: 'fira', t: 'Fira Code', stack: '"Fira Code",Consolas,monospace' },
  { k: 'courier', t: 'Courier New', stack: '"Courier New",monospace' },
]
export const uiStack = (k?: string) => (UI_FONTS.find((f) => f.k === k) || UI_FONTS[0]).stack
export const codeStack = (k?: string) => (CODE_FONTS.find((f) => f.k === k) || CODE_FONTS[0]).stack
