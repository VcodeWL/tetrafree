/* Глубокая копия данных стора. structuredClone падает на прокси и функциях в объекте (Immer, обработчики);
   всё состояние — обычный JSON (оно и сохраняется через JSON), поэтому копируем через него. */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
