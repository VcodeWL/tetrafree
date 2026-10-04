/* Триггеры пайплайнов: какие из них запускать после события. Чистая логика — запуск в ci.ts. */
export type TriggerEvent = 'version' | 'commit'

/** `version` — появилась новая версия проекта (правки агента или редактора), `commit` — git-коммит из панели Git;
    `push` — любое из двух. `manual`, `tag` и прочее автоматически не запускаются. */
export const matchesTrigger = (trigger: string[], ev: TriggerEvent): boolean =>
  trigger.some((t) => t === ev || t === 'push')

export const pipelinesFor = <T extends { trigger: string[]; steps: unknown[] }>(
  defs: T[],
  ev: TriggerEvent,
): T[] => defs.filter((d) => d.steps.length > 0 && matchesTrigger(d.trigger, ev))
