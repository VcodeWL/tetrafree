/* Заглушки загрузки: те же размеры, что у будущего содержимого, чтобы интерфейс не прыгал */
export function Skel({
  w,
  h = 12,
  r = 6,
  style,
}: {
  w?: number | string
  h?: number | string
  r?: number
  style?: React.CSSProperties
}) {
  return (
    <i className="skel" style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} aria-hidden />
  )
}
/** строка списка: иконка + две строки текста */
export function SkelRow() {
  return (
    <div className="skel-row" role="status" aria-label="Загрузка">
      <Skel w={28} h={28} r={8} />
      <div>
        <Skel w="46%" h={11} />
        <Skel w="72%" h={9} style={{ marginTop: 7 }} />
      </div>
    </div>
  )
}
export function SkelList({ n = 3 }: { n?: number }) {
  return (
    <div className="skel-list">
      {Array.from({ length: n }, (_, i) => (
        <SkelRow key={i} />
      ))}
    </div>
  )
}
/** состояние ошибки загрузки с повтором */
export function LoadError({
  text = 'Не удалось загрузить',
  onRetry,
}: {
  text?: string
  onRetry: () => void
}) {
  return (
    <div className="load-err" role="alert">
      <span>{text}</span>
      <button className="linkbtn" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}
