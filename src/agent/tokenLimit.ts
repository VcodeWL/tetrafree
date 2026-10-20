import type { ProviderKind } from '../types'
/** API output caps are a best effort provider control, not a guaranteed billing ceiling. */
export function tokenLimit(kind: ProviderKind, model: string, maxTokens?: number): Record<string, number> {
  if (maxTokens === undefined) return kind === 'anthropic' ? { max_tokens: 16000 } : {}
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000)
    throw new Error('Недопустимый лимит токенов ответа')
  return kind === 'openai' && /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/i.test(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}
