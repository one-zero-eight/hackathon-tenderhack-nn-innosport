/// <reference types="node" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { readDialogStream } from './stream.ts'
import type { ChatToolCall } from './types.ts'

const response = { id: '1234567890abcdef12345678', reply: 'Готовый ответ', closed: false }
const encode = (event: object) => `${JSON.stringify(event)}\n`
const done = encode({ type: 'done', response })
const encoder = new TextEncoder()

function source(text: string, bytewise = false) {
  const bytes = encoder.encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      else controller.enqueue(bytes)
      controller.close()
    },
  })
  return stream
}

function signal() { return new AbortController().signal }

test('decodes split UTF-8 and JSON lines, replacing snapshots including round resets', async () => {
  const snapshots: string[] = []
  const text = ['П', 'Привет 世界', '', 'Новый ответ'].map((text) => encode({ type: 'text', text })).join('')
  const stream = source(text + done, true)
  assert.deepEqual(await readDialogStream(stream, signal(), (text) => snapshots.push(text)), response)
  assert.deepEqual(snapshots, ['П', 'Привет 世界', '', 'Новый ответ'])
  assert.equal(stream.locked, false)
})

test('delivers ordered tool updates interleaved with text and round resets', async () => {
  const first = { id: 'search-1', name: 'search', arguments: { query: 'закупка' }, result: {} }
  const second = { id: 'clarify-2', name: 'clarify', arguments: { question: 'Какой раздел?' }, result: {} }
  const events = [
    { type: 'tool', tool_call: { ...first, arguments: {} }, status: 'preparing' },
    { type: 'tool', tool_call: first, status: 'running' },
    { type: 'tool', tool_call: { ...first, result: { sources: ['one'] } }, status: 'completed' },
    { type: 'text', text: 'Нашли информацию' },
    { type: 'text', text: '' },
    { type: 'tool', tool_call: second, status: 'running' },
    { type: 'tool', tool_call: { ...second, result: { status: 'awaiting_user' } }, status: 'awaiting_user' },
    { type: 'tool', tool_call: { ...first, result: { error: 'Ошибка чтения' } }, status: 'error' },
  ]
  const updates: (ChatToolCall | string)[] = []
  const result = await readDialogStream(source(events.map(encode).join('') + done, true), signal(), (text) => updates.push(text), (tool) => updates.push(tool))
  assert.deepEqual(result, response)
  assert.deepEqual(updates, events.map((event) => event.type === 'text' ? event.text : { ...event.tool_call, status: event.status }))
})

test('accepts tool events without an optional observer', async () => {
  const event = { type: 'tool', tool_call: { id: 'one', name: 'search', arguments: {}, result: {} }, status: 'running' }
  assert.deepEqual(await readDialogStream(source(encode(event) + done), signal()), response)
})

for (const status of [undefined, null, '', 'pending', 'RUNNING', 1, {}, []]) {
  test(`rejects invalid tool status ${JSON.stringify(status)}`, async () => {
    const updates: ChatToolCall[] = []
    const stream = source(encode({ type: 'tool', tool_call: { id: 'one', name: 'search', arguments: {}, result: {} }, status }) + done)
    await assert.rejects(readDialogStream(stream, signal(), undefined, (tool) => updates.push(tool)), /Invalid dialog stream event/)
    assert.deepEqual(updates, [])
    assert.equal(stream.locked, false)
  })
}

for (const tool_call of [undefined, null, {}, { id: '', name: 'search', arguments: {}, result: {} }, { id: 'one', name: 'search', arguments: [], result: {} }, { id: 'one', name: 'search', arguments: {}, result: null }]) {
  test(`rejects malformed tool call ${JSON.stringify(tool_call)}`, async () => {
    const stream = source(encode({ type: 'tool', tool_call, status: 'running' }) + done)
    await assert.rejects(readDialogStream(stream, signal()), /Invalid dialog stream event/)
    assert.equal(stream.locked, false)
  })
}

test('accepts a final complete done line without a newline and ignores blank CRLF lines', async () => {
  assert.deepEqual(await readDialogStream(source(`\r\n${done.trim()}\r`), signal()), response)
})

test('stops and cancels the reader immediately after confirmation', async () => {
  let cancelled = false
  const snapshots: string[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(done + encode({ type: 'text', text: 'late' }))) },
    cancel() { cancelled = true },
  })
  assert.deepEqual(await readDialogStream(stream, signal(), (text) => snapshots.push(text)), response)
  assert.deepEqual(snapshots, [])
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})

test('reports error events and cancels/releases an open reader', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(encode({ type: 'error', detail: 'Generation failed' }))) },
    cancel() { cancelled = true },
  })
  await assert.rejects(readDialogStream(stream, signal()), /Generation failed/)
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})

for (const [name, text] of [
  ['empty stream', ''],
  ['text without confirmation', encode({ type: 'text', text: 'Partial answer' })],
  ['truncated final JSON', encode({ type: 'text', text: 'Partial answer' }) + '{"type":"done","response":'],
  ['unknown event', encode({ type: 'unknown' })],
  ['invalid text', encode({ type: 'text', text: 42 })],
  ['invalid confirmation', encode({ type: 'done', response: null })],
]) {
  test(`rejects ${name} without retaining the reader lock`, async () => {
    const stream = source(text)
    await assert.rejects(readDialogStream(stream, signal()))
    assert.equal(stream.locked, false)
  })
}

test('cancellation interrupts a pending read and releases the reader', async () => {
  let cancelled = false
  const controller = new AbortController()
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const result = readDialogStream(stream, controller.signal)
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})

test('an already aborted signal cancels without delivering text', async () => {
  const controller = new AbortController()
  controller.abort()
  const stream = source(encode({ type: 'text', text: 'Never delivered' }) + done)
  const snapshots: string[] = []
  await assert.rejects(readDialogStream(stream, controller.signal, (text) => snapshots.push(text)), { name: 'AbortError' })
  assert.deepEqual(snapshots, [])
  assert.equal(stream.locked, false)
})

test('a network failure after partial text cannot confirm an exchange', async () => {
  let reads = 0
  const snapshots: string[] = []
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode(encode({ type: 'text', text: 'Partial answer' })))
      else controller.error(new Error('Connection lost'))
    },
  })
  await assert.rejects(readDialogStream(stream, signal(), (text) => snapshots.push(text)), /Connection lost/)
  assert.deepEqual(snapshots, ['Partial answer'])
  assert.equal(stream.locked, false)
})

test('rejects incomplete UTF-8 instead of displaying corrupted text', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xd0))
      controller.close()
    },
  })
  await assert.rejects(readDialogStream(stream, signal()))
  assert.equal(stream.locked, false)
})
