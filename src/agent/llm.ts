/* Реальные модели: OpenAI-совместимый /chat/completions (OpenAI, Ollama, роутеры) и Anthropic /messages.
   Стрим читается побайтно; рассуждения (reasoning) показываются вживую отдельно от ответа.
   Если подключён локальный бэкенд — запрос идёт через него (нет проблем с CORS). */
import type { Provider } from '../types'
import { backendFetch } from '../lib/backend'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}
export interface StreamOpts {
  provider: Provider
  model: string
  system: string
  messages: ChatMsg[]
  signal: AbortSignal
  onDelta: (t: string) => void
  onReasoning?: (t: string) => void
  onOpen?: () => void
  maxTokens?: number
}

const IDLE_MS = 90_000

export async function streamChat(o: StreamOpts) {
  const { provider: p, model, system, messages, signal, onDelta, onReasoning, onOpen } = o
  const base = p.baseUrl.replace(/\/+$/, '')
  const anthropic = p.kind === 'anthropic'
  const url = anthropic ? base + '/messages' : base + '/chat/completions'
  const headers: Record<string, string> = anthropic
    ? {
        'content-type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : { 'content-type': 'application/json', ...(p.apiKey ? { authorization: 'Bearer ' + p.apiKey } : {}) }
  const body = anthropic
    ? { model, system, messages, max_tokens: o.maxTokens || 16000, stream: true }
    : { model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }
  const res = await backendFetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) })
  await ensureOk(res)
  onOpen?.()
  const ct = res.headers.get('content-type') || ''
  /* провайдер/прокси проигнорировал stream: true — разбираем целиком, но всё равно отдаём по кускам */
  if (ct.includes('application/json')) {
    const j = await res.json()
    const text = anthropic
      ? (j.content || []).map((c: { text?: string }) => c.text || '').join('')
      : j.choices?.[0]?.message?.content || ''
    const reason = anthropic
      ? ''
      : j.choices?.[0]?.message?.reasoning_content || j.choices?.[0]?.message?.reasoning || ''
    if (reason) onReasoning?.(reason)
    for (let i = 0; i < text.length; i += 24) onDelta(text.slice(i, i + 24))
    return
  }
  await readSse(res, signal, (data) => {
    if (data === '[DONE]') return
    let j: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      j = JSON.parse(data)
    } catch {
      return
    }
    if (anthropic) {
      if (j.type === 'content_block_delta') {
        if (j.delta?.type === 'thinking_delta' && j.delta.thinking) onReasoning?.(j.delta.thinking)
        else if (j.delta?.text) onDelta(j.delta.text)
      }
      if (j.type === 'error') throw new Error(j.error?.message || 'Ошибка Anthropic')
      return
    }
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error).slice(0, 200))
    const d = j.choices?.[0]?.delta
    if (!d) return
    const r = d.reasoning_content ?? d.reasoning
    if (r && typeof r === 'string') onReasoning?.(r)
    if (d.content) onDelta(d.content)
  })
}

async function ensureOk(res: Response) {
  if (res.ok) return
  let msg = `HTTP ${res.status}`
  try {
    const t = await res.text()
    try {
      const j = JSON.parse(t)
      msg += ' — ' + (j.error?.message || j.message || t.slice(0, 200))
    } catch {
      msg += ' — ' + t.slice(0, 200)
    }
  } catch {
    /* noop */
  }
  if (res.status === 401 || res.status === 403) msg += '. Проверь API-ключ.'
  if (res.status === 404) msg += '. Проверь Base URL и имя модели.'
  if (res.status === 429) msg += '. Лимит запросов — подожди и повтори.'
  throw new Error(msg)
}

async function readSse(res: Response, signal: AbortSignal, on: (data: string) => void) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const idle = new Promise<never>((_, rej) => {
      timer = setTimeout(
        () => rej(new Error(`Модель молчит больше ${IDLE_MS / 1000} с — соединение оборвано`)),
        IDLE_MS,
      )
    })
    let r: ReadableStreamReadResult<Uint8Array>
    try {
      r = await Promise.race([reader.read(), idle])
    } finally {
      clearTimeout(timer)
    }
    if (signal.aborted) {
      try {
        await reader.cancel()
      } catch {
        /* noop */
      }
      return
    }
    if (r.done) break
    buf += dec.decode(r.value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim()
        if (d) on(d)
      }
    }
  }
  const rest = buf.trim()
  if (rest.startsWith('data:')) on(rest.slice(5).trim())
}

/** Список моделей провайдера (GET /models). Работает для Anthropic, OpenAI, Ollama и совместимых API. */
export async function listModels(p: Pick<Provider, 'kind' | 'baseUrl' | 'apiKey'>, signal?: AbortSignal) {
  const base = p.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> =
    p.kind === 'anthropic'
      ? {
          'x-api-key': p.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : p.apiKey
        ? { authorization: 'Bearer ' + p.apiKey }
        : {}
  const res = await backendFetch(base + '/models?limit=200', { method: 'GET', signal, headers })
  await ensureOk(res)
  const j = (await res.json()) as {
    data?: { id?: string; display_name?: string }[]
    models?: { name?: string }[]
  }
  const rows = (j.data || []).filter((m) => m.id).map((m) => ({ id: m.id!, name: m.display_name || m.id! }))
  if (!rows.length && j.models) for (const m of j.models) if (m.name) rows.push({ id: m.name, name: m.name })
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}
