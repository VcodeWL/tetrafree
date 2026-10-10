/* Правка .tetra/mcp.json из интерфейса (чистые функции). Формат — как у Claude Code, поэтому .mcp.json тоже понимаем. */
export const MCP_FILES = ['.tetra/mcp.json', '.mcp.json']

export type McpCfg =
  | { command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }
  | { url: string; headers?: Record<string, string>; disabled?: boolean }

/** Куда писать: уже существующий конфиг, иначе .tetra/mcp.json */
export const configPath = (files: Record<string, string>) => MCP_FILES.find((f) => f in files) || MCP_FILES[0]

/** «npx -y @scope/pkg "папка с пробелом"» → слова; кавычки "…" и '…' склеивают слово */
export function splitCommand(line: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line.trim())))
    out.push(m[1] !== undefined ? m[1].replace(/\\(["\\])/g, '$1') : (m[2] ?? m[3]))
  return out
}

/** «KEY=значение» построчно → объект. Пустые строки и # пропускаются; неверные строки — в errors */
export function parseKv(text: string): { obj: Record<string, string>; errors: string[] } {
  const obj: Record<string, string> = {}
  const errors: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const m = l.match(/^([\w.-]+)\s*[=:]\s*(.*)$/)
    if (m) obj[m[1]] = m[2].trim()
    else errors.push(l)
  }
  return { obj, errors }
}

export const validName = (n: string) => /^[\w.-]{1,40}$/.test(n)

function read(text: string | undefined): {
  servers: Record<string, McpCfg>
  key: string
  rest: Record<string, unknown>
} {
  let j: Record<string, unknown> = {}
  try {
    const v = JSON.parse(text || '{}')
    if (v && typeof v === 'object' && !Array.isArray(v)) j = v
  } catch {
    throw new Error('Файл конфигурации повреждён (не JSON) — исправь его вручную, чтобы ничего не потерять')
  }
  const key = 'servers' in j && !('mcpServers' in j) ? 'servers' : 'mcpServers'
  const servers = (j[key] && typeof j[key] === 'object' ? j[key] : {}) as Record<string, McpCfg>
  return { servers, key, rest: j }
}

/** Добавляет сервер (или заменяет с тем же именем), остальное содержимое файла сохраняет */
export function addServer(text: string | undefined, name: string, cfg: McpCfg): string {
  if (!validName(name)) throw new Error('Имя: латиница, цифры, _ . - (до 40 знаков)')
  const { servers, key, rest } = read(text)
  return JSON.stringify({ ...rest, [key]: { ...servers, [name]: cfg } }, null, 2) + '\n'
}

export function removeServer(text: string | undefined, name: string): string {
  const { servers, key, rest } = read(text)
  const next = { ...servers }
  delete next[name]
  return JSON.stringify({ ...rest, [key]: next }, null, 2) + '\n'
}

/** Готовая запись по описанию из формы */
export function buildCfg(kind: 'cmd' | 'http', line: string, kv: string): { cfg?: McpCfg; error?: string } {
  const { obj, errors } = parseKv(kv)
  if (errors.length) return { error: `Строка «${errors[0]}» — нужен вид КЛЮЧ=значение` }
  if (kind === 'http') {
    if (!/^https?:\/\/\S+$/i.test(line.trim()))
      return { error: 'Адрес должен начинаться с http:// или https://' }
    return { cfg: { url: line.trim(), ...(Object.keys(obj).length ? { headers: obj } : {}) } }
  }
  const w = splitCommand(line)
  if (!w.length) return { error: 'Укажи команду, например: npx -y @modelcontextprotocol/server-memory' }
  return {
    cfg: {
      command: w[0],
      ...(w.length > 1 ? { args: w.slice(1) } : {}),
      ...(Object.keys(obj).length ? { env: obj } : {}),
    },
  }
}
