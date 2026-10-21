/* Pure engine policies: no store, provider transport, timers or filesystem effects.
   Reservation is deliberately conservative; displayed usage is a text-length estimate,
   not exact provider token accounting. Keep these two concepts separate. */
import type { Price, Usage } from '../lib/usage'
import type { ChatMsg } from './llm'

export const AUTOMATION_MAX_TOKENS = 16000

export function usageEstimate(
  acct: { inChars: number; steps: number },
  outChars: number,
  modelId: string,
  local: boolean,
): Usage {
  return {
    inTok: Math.round(acct.inChars / 3.2),
    outTok: Math.round(outChars / 3.2),
    steps: acct.steps,
    mid: modelId,
    free: local,
  }
}

/** UTF-8 request bytes, image allowance and capped output; null means unknown tariff.
 * A zero known price and a local model are different from a missing/invalid tariff.
 * This reservation is not a billing guarantee (provider overhead/context can differ).
 */
export function requestReservation(
  system: string,
  messages: readonly Pick<ChatMsg, 'content' | 'images'>[],
  local: boolean,
  prices: Price | null,
): number | null {
  if (local) return 0
  if (
    !prices ||
    !Number.isFinite(prices.inp) ||
    prices.inp < 0 ||
    !Number.isFinite(prices.out) ||
    prices.out < 0
  )
    return null
  const bytes =
    new TextEncoder().encode(system + messages.map((m) => m.content).join('')).length +
    messages.reduce((sum, m) => sum + (m.images?.length || 0), 0) * 12000
  return (bytes * prices.inp + AUTOMATION_MAX_TOKENS * prices.out) / 1e6
}

export function verifyCommand(files: Record<string, string>, changed: string[]): string | null {
  try {
    const pkg = JSON.parse(files['package.json'] || 'null')
    const sc = pkg?.scripts || {}
    for (const k of ['typecheck', 'lint', 'test'])
      if (sc[k] && !(k === 'test' && /no test specified/.test(sc[k]))) return `npm run ${k} --silent`
  } catch {
    /* package.json битый — проверим ниже */
  }
  // No shell quoting of user-controlled filenames. Standalone JS/Python checks
  // wait for a structured argv server endpoint; fixed package scripts still work.
  void changed
  return null
}
