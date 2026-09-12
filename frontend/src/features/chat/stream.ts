import type { SchemaDialogResponse, SchemaDialogStreamEvent } from '../../api/types.ts'
import { isDialogPayload } from './dialog-map.ts'
import { isToolCall } from './model.ts'
import type { ChatToolCall } from './types.ts'

function parseEvent(line: string): SchemaDialogStreamEvent {
  const event: unknown = JSON.parse(line)
  if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('Invalid dialog stream event')
  if (event.type === 'text' && 'text' in event && typeof event.text === 'string') return { type: 'text', text: event.text }
  if (event.type === 'tool' && 'tool_call' in event && isToolCall(event.tool_call) && 'status' in event && (event.status === 'preparing' || event.status === 'running' || event.status === 'completed' || event.status === 'error' || event.status === 'awaiting_user')) {
    return { type: 'tool', text: '', tool_call: event.tool_call, status: event.status }
  }
  if (event.type === 'done' && 'response' in event && isDialogPayload(event.response)) return { type: 'done', text: '', response: event.response }
  if (event.type === 'error' && 'detail' in event && typeof event.detail === 'string') return { type: 'error', text: '', detail: event.detail }
  throw new Error('Invalid dialog stream event')
}

/** Text events replace the provisional snapshot; only done confirms an exchange. */
export async function readDialogStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, onText?: (text: string) => void, onTool?: (tool: ChatToolCall) => void): Promise<SchemaDialogResponse> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffered = ''
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const consume = (line: string): SchemaDialogResponse | undefined => {
    signal.throwIfAborted()
    if (!line.trim()) return
    const event = parseEvent(line)
    if (event.type === 'text') onText?.(event.text ?? '')
    else if (event.type === 'tool') onTool?.({ ...event.tool_call!, status: event.status! })
    else if (event.type === 'done') return event.response!
    else throw new Error(event.detail ?? 'Dialog stream failed')
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        const response = consume(line)
        if (response) return response
      }
      if (done) {
        const response = consume(buffered)
        if (response) return response
        throw new Error('Dialog stream ended before confirmation')
      }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    try {
      await reader.cancel()
    } catch {
      // Reading already reports network errors; cleanup must preserve that error.
    } finally {
      reader.releaseLock()
    }
  }
}
