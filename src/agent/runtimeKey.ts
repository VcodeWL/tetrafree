/* Runtime identities only. Historical project/chat/message IDs are never rewritten.
   Missing pid is an isolated legacy bucket, not a fallback to a different project. */
export const runtimeKey = (pid: string | undefined, chatId: string): string =>
  JSON.stringify([pid ?? null, chatId])
export const retryKey = (pid: string, chatId: string, msgId: string, partId: string): string =>
  JSON.stringify([pid, chatId, msgId, partId])
