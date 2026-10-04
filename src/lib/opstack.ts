/* История файловых операций (создание, переименование, перемещение, удаление) с отменой и повтором. */
export interface Op {
  label: string
  undo: () => void
  redo: () => void
}

export class OpStack {
  private done: Op[] = []
  private undone: Op[] = []
  constructor(private max = 50) {}

  /** Новая операция сбрасывает «повтор», как в любом редакторе */
  push(op: Op) {
    this.done.push(op)
    if (this.done.length > this.max) this.done.shift()
    this.undone = []
  }
  get canUndo() {
    return this.done.length > 0
  }
  get canRedo() {
    return this.undone.length > 0
  }
  get nextUndo() {
    return this.done[this.done.length - 1]?.label
  }
  get nextRedo() {
    return this.undone[this.undone.length - 1]?.label
  }
  /** Если операция упала, она остаётся на месте — не теряем историю из-за одной ошибки */
  undo(): Op | null {
    const op = this.done[this.done.length - 1]
    if (!op) return null
    op.undo()
    this.done.pop()
    this.undone.push(op)
    return op
  }
  redo(): Op | null {
    const op = this.undone[this.undone.length - 1]
    if (!op) return null
    op.redo()
    this.undone.pop()
    this.done.push(op)
    return op
  }
  /** Отмена конкретной операции из тоста: только пока она ещё в истории */
  undoOp(op: Op): boolean {
    const i = this.done.indexOf(op)
    if (i < 0) return false
    op.undo()
    this.done.splice(i, 1)
    this.undone.push(op)
    return true
  }
}

const stacks = new Map<string, OpStack>()
export const opsFor = (pid: string) => {
  let s = stacks.get(pid)
  if (!s) stacks.set(pid, (s = new OpStack()))
  return s
}
