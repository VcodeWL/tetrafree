import crypto from 'node:crypto'
const SAFE = Symbol('publicError')
export function publicError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra, [SAFE]: true })
}
export function publicFailure(
  error,
  fallback = 'Не удалось выполнить операцию',
  status = 500,
  scope = 'server',
) {
  if (error?.[SAFE]) return { status: error.status, error: { message: error.message, ...error.extra } }
  const correlationId = crypto.randomBytes(8).toString('hex')
  // Do not log arbitrary remote stderr/messages, paths, URL credentials or tokens.
  // Bounded categorical diagnostics are sufficient to correlate a local incident.
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'INTERNAL'
  console.error(`[${scope}] ${correlationId} ${code}`)
  return { status, error: { message: fallback, correlationId } }
}
