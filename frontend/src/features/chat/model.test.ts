/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getEventListeners } from 'node:events'
import { applyExchange, CHAT_STORAGE_VERSION, clarificationCount, createChat, formatClarificationAnswer, parseChatHistory, pendingClarification, serializeChatHistory } from './model.ts'
import { demoDelay, demoTransport } from './demo-transport.ts'
import type { ChatMessage, ClarificationRequest } from './types.ts'

const now = '2026-04-25T12:00:00.000Z'
const request: ClarificationRequest = {
  id: 'question-1',
  question: 'Which sport?',
  options: [
    { id: 'football', label: 'Футбол' },
    { id: 'fitness', label: 'Фитнес' },
  ],
}
function user(id: string, clarificationId?: string): ChatMessage {
  return { id, role: 'user', content: 'Football equipment', createdAt: now, clarificationId }
}

test('createChat is deterministic and has no messages', () => {
  assert.deepEqual(createChat('chat-1', now), {
    id: 'chat-1',
    title: 'Новый чат',
    updatedAt: now,
    messages: [],
  })
})

test('applyExchange immutably commits exactly two messages and a title', () => {
  const chat = createChat('chat-1', now)
  const message = user('message-1')
  const result = applyExchange(chat, message, { content: 'Question', clarification: request })
  assert.equal(chat.messages.length, 0)
  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0], message)
  assert.equal(result.messages[1].role, 'assistant')
  assert.equal(result.messages[1].clarification, request)
  assert.equal(result.title, 'Football equipment')
  assert.equal(clarificationCount(result), 0)
  assert.deepEqual(pendingClarification(result), request)
})

test('counts distinct successful user answers only, not assistant metadata', () => {
  let chat = applyExchange(createChat('chat-1', now), user('m1'), {
    content: 'Question',
    clarification: request,
  })
  chat = applyExchange(chat, user('m2', request.id), { content: 'Accepted' })
  chat = applyExchange(chat, user('m3', request.id), { content: 'Repeated' })
  chat.messages.push({ id: 'a4', role: 'assistant', content: '', createdAt: now, clarificationId: 'ignored' })
  assert.equal(clarificationCount(chat), 1)
  assert.equal(pendingClarification(chat), undefined)
})

test('pendingClarification finds the latest unanswered assistant question', () => {
  const second = { ...request, id: 'question-2' }
  let chat = applyExchange(createChat('chat', now), user('m1'), { content: '', clarification: request })
  chat = applyExchange(chat, user('m2'), { content: '', clarification: second })
  assert.equal(pendingClarification(chat)?.id, second.id)
  chat = applyExchange(chat, user('m3', second.id), { content: '' })
  assert.equal(pendingClarification(chat)?.id, request.id)
})

test('failure does not commit a user message or increment a clarification count', async () => {
  const chat = applyExchange(createChat('chat', now), user('m1'), { content: '', clarification: request })
  const before = JSON.stringify(chat)
  const failingTransport = async () => {
    throw new Error('offline')
  }
  await assert.rejects(failingTransport, /offline/)
  assert.equal(JSON.stringify(chat), before)
  assert.equal(clarificationCount(chat), 0)
  assert.equal(pendingClarification(chat)?.id, request.id)
  assert.throws(() => applyExchange(chat, user('m2'), { content: 12 } as never), /Invalid chat reply/)
  assert.equal(JSON.stringify(chat), before)
})

test('clarification answers contain labels or Other text with valid cardinality', () => {
  assert.equal(formatClarificationAnswer(request, { optionIds: ['football'], other: '' }), 'Футбол')
  assert.equal(formatClarificationAnswer(request, { optionIds: [], other: '  Tennis  ' }), 'Tennis')
  assert.equal(formatClarificationAnswer(request, { optionIds: [], other: '  ' }), null)
  assert.equal(formatClarificationAnswer(request, { optionIds: ['unknown'], other: '' }), null)
  assert.equal(formatClarificationAnswer(request, { optionIds: ['football'], other: 'Tennis' }), null)
  assert.equal(formatClarificationAnswer(request, { optionIds: ['football', 'fitness'], other: '' }), null)
  assert.equal(
    formatClarificationAnswer(
      { ...request, multiple: true },
      {
        optionIds: ['football', 'fitness', 'football'],
        other: ' Tennis ',
      },
    ),
    'Футбол; Фитнес; Tennis',
  )
})

test('history round-trips the active chat and committed clarification messages', () => {
  const chat = applyExchange(createChat('chat', now), user('m1'), { content: '', clarification: request })
  const next = applyExchange(chat, user('m2', request.id), { content: 'Done' })
  const history = parseChatHistory(serializeChatHistory([next], next.id))
  assert.equal(history?.version, CHAT_STORAGE_VERSION)
  assert.equal(history?.activeChatId, next.id)
  assert.equal(clarificationCount(history!.chats[0]), 1)
  assert.equal(pendingClarification(history!.chats[0]), undefined)
})

test('history rejects corrupt, incompatible, and malformed data', () => {
  const chat = createChat('chat', now)
  const valid = { version: CHAT_STORAGE_VERSION, chats: [chat], activeChatId: chat.id }
  for (const value of [
    null,
    '',
    '{broken',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...valid, version: 99 }),
    JSON.stringify({ ...valid, activeChatId: 'missing' }),
    JSON.stringify({ ...valid, chats: [] }),
    JSON.stringify({ ...valid, chats: [chat, chat] }),
    JSON.stringify({ ...valid, chats: [{ ...chat, updatedAt: 'bad-date' }] }),
    JSON.stringify({ ...valid, chats: [{ ...chat, messages: [{ ...user('m1'), role: 'system' }] }] }),
    JSON.stringify({ ...valid, chats: [{ ...chat, messages: [{ ...user('m1'), clarification: { ...request, options: [{}] } }] }] }),
  ])
    assert.equal(parseChatHistory(value), null)
})

test('abortable delay rejects both already-aborted and in-flight requests', async () => {
  const before = new AbortController()
  before.abort()
  await assert.rejects(demoDelay(1, before.signal), { name: 'AbortError' })
  const during = new AbortController()
  const pending = demoDelay(10_000, during.signal)
  assert.equal(getEventListeners(during.signal, 'abort').length, 1)
  during.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(getEventListeners(during.signal, 'abort').length, 0)
  const success = new AbortController()
  await demoDelay(1, success.signal)
  assert.equal(getEventListeners(success.signal, 'abort').length, 0)
})

test('demo produces exactly three scripted clarifications then explicit demo result', async () => {
  let chat = createChat('demo-chat', now)
  const signal = new AbortController().signal
  for (let round = 0; round < 4; round += 1) {
    const message = user(`round-${round}`, pendingClarification(chat)?.id)
    const reply = await demoTransport.send([...chat.messages, message], signal)
    chat = applyExchange(chat, message, reply)
    assert.equal(clarificationCount(chat), round)
    assert.equal(Boolean(reply.clarification), round < 3)
  }
  assert.match(chat.messages.at(-1)!.content, /Демонстрация завершена/)
  assert.match(chat.messages.at(-1)!.content, /не выполнялись/)
  assert.equal(pendingClarification(chat), undefined)
})
