/* Поддельный OpenAI-совместимый сервер для проверки агента без настоящего ключа и денег.
   Запуск: node scripts/fake-llm.mjs [порт=8123]. В TetraFree: Настройки → Провайдеры → «Совместимый с OpenAI»,
   адрес http://127.0.0.1:8123/v1, ключ — любой (например, test), затем «Получить список моделей».
   Ответы чередуются: 1) создаёт файл hello.txt и запускает команду в shell; 2) финальный текст. */
import http from 'node:http'

const port = +(process.argv[2] || 8123)
let turn = 0
const send = (res, obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')

http
  .createServer((req, res) => {
    const url = req.url.split('?')[0]
    if (url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }))
    }
    if (url === '/v1/chat/completions' && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', async () => {
        const stream = (() => {
          try {
            return JSON.parse(body).stream !== false
          } catch {
            return true
          }
        })()
        const text =
          turn++ % 2 === 0
            ? 'Создаю файл и проверяю shell.\n<write path="hello.txt">привет из поддельной модели\n</write>\n<run>echo ok-from-shell</run>'
            : 'Готово: файл hello.txt создан, команда выполнена.'
        if (!stream) {
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(
            JSON.stringify({
              choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            }),
          )
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        for (let i = 0; i < text.length; i += 12) {
          send(res, { choices: [{ index: 0, delta: { content: text.slice(i, i + 12) } }] })
          await new Promise((r) => setTimeout(r, 25))
        }
        send(res, {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: (text.length / 4) | 0 },
        })
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  .listen(port, '127.0.0.1', () => console.log(`fake LLM: http://127.0.0.1:${port}/v1`))
