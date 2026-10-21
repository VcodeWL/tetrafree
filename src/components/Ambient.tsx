/* Исходный фон сохранён. Статичный слой без частиц, таймеров и слежения за курсором.
   Цвет и интенсивность задаёт тема; настройка ambient отключает весь фон. */
import bg from '../assets/bg.jpg'

export function Ambient() {
  return (
    <div id="bg" aria-hidden="true">
      <div className="bg-img">
        <img src={bg} alt="" draggable={false} />
      </div>
    </div>
  )
}
