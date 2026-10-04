import { Component, type ReactNode } from 'react'

/* Если экран упал — не белый лист, а понятное сообщение и выход */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error) {
    console.error(err)
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="crash">
        <h2>Этот экран не смог отрисоваться</h2>
        <p>Данные проекта не пострадали. Можно вернуться назад или перезапустить окно.</p>
        <pre>{this.state.err.message}</pre>
        <div className="crash-acts">
          <button className="btn" onClick={() => this.setState({ err: null })}>
            Попробовать снова
          </button>
          <button className="btn pri" onClick={() => location.reload()}>
            Перезапустить
          </button>
        </div>
      </div>
    )
  }
}
