/** Только собственная рабочая область, не диалог, ввод или уже обработанная клавиша. */
export function designShortcutAllowed(
  event: Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'isComposing'>,
  scope: Pick<HTMLElement, 'contains'> | null,
  blocked: boolean,
): boolean {
  if (blocked || event.defaultPrevented || event.isComposing || !scope) return false
  const target = event.target as HTMLElement | null
  if (!target?.closest || !scope.contains(target)) return false
  return !target.closest(
    'input,textarea,select,[contenteditable]:not([contenteditable="false"]),button,a,[role="button"],[role="tab"],[role="menuitem"]',
  )
}
