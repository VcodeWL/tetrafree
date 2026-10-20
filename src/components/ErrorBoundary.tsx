import { Component, type ReactNode } from 'react'

/* Если экран упал — не белый лист, а понятное сообщение и выход */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null; saving: boolean; restartError: string }
> {
  state = { err: null as Error | null, saving: false, restartError: '' }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error) {
    if (import.meta.env.DEV) console.error('Ошибка отображения интерфейса', err.name)
  }
  async restart() {
    if (this.state.saving) return
    this.setState({ saving: true, restartError: '' })
    try {
      await (await import('../store/persistence')).flushPersistence()
      location.reload()
    } catch {
      this.setState({
        saving: false,
        restartError:
          'Сохранение не подтверждено. Окно не перезапущено; попробуй снова после освобождения места.',
      })
    }
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="crash">
        <h2>Этот экран не смог отрисоваться</h2>
        <p>
          Сохранённые данные не очищались. Попробуй открыть экран снова; перед перезапуском будет проверено
          сохранение текущего состояния.
        </p>
        <p className="dim">
          {this.state.err.name === 'ChunkLoadError' ||
          /dynamically imported module|Loading chunk/i.test(this.state.err.message)
            ? 'Не удалось загрузить часть интерфейса. Проверь соединение с локальным сервером.'
            : 'Внутренняя ошибка отображения. Работа фоновых служб могла продолжиться.'}
        </p>
        {this.state.restartError && <p role="alert">{this.state.restartError}</p>}
        <div className="crash-acts">
          <button className="btn" onClick={() => this.setState({ err: null })}>
            Попробовать снова
          </button>
          <button className="btn pri" disabled={this.state.saving} onClick={() => void this.restart()}>
            {this.state.saving ? 'Проверяю сохранение…' : 'Сохранить и перезапустить'}
          </button>
        </div>
      </div>
    )
  }
}
