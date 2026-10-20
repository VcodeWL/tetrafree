import type { Provider } from '../types'
/** An open settings draft is not authority to revive a provider/key changed elsewhere. */
export function assertProviderDraft(current: Provider | undefined, initial: Provider | null) {
  if (JSON.stringify(current ?? null) !== JSON.stringify(initial))
    throw new Error('Провайдер изменён в другом окне. Открой его настройки заново.')
}
