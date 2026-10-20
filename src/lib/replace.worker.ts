import { executeReplace, type ReplaceRequest } from './replace'

// Avoid adding WebWorker to the shared TS lib (DOM and WebWorker globals overlap).
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<ReplaceRequest>) => void
  postMessage: (data: ReturnType<typeof executeReplace>) => void
}
scope.onmessage = (event) => scope.postMessage(executeReplace(event.data))
