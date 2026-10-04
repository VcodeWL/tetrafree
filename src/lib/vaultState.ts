/* Состояние защищённого хранилища ключей. Отдельный модуль без зависимостей — его читает persistence,
   чтобы не вписывать в localStorage ключи, которые уже надёжно лежат на стороне сервера. */
import type { Provider } from '../types'

/** id провайдера → ключ, который сервер подтвердил (записал или вернул) */
const synced = new Map<string, string>()

export const vaultSynced = () => synced

/** убирает из списка ключи, подтверждённые хранилищем; всё остальное остаётся как есть */
export function stripSecrets(providers: Provider[]): Provider[] {
  return providers.map((p) => (p.apiKey && synced.get(p.id) === p.apiKey ? { ...p, apiKey: '' } : p))
}
