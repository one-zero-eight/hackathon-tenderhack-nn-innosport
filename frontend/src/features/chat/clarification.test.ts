/// <reference types="node" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { chatFromDialogView, chatFromListItem, mapDialogResponse } from './dialog-map.ts'
import { applyExchange, createChat, isChatReply, isSubstantiveAnswer, parseChatHistory, pendingClarificationMessageId, serializeChatHistory } from './model.ts'
import type { ChatMessage, ClarificationRequest } from './types.ts'

const now = '2026-09-12T12:00:00.000Z'
const request: ClarificationRequest = { id: 'clarification-1', question: 'Что хотите сделать?', options: ['Создать закупку', 'Найти закупку'] }
const userMessage: ChatMessage = { id: 'user-1', role: 'user', content: 'Помогите с закупкой', createdAt: now }
const reply = { content: 'Уточните задачу.', kind: 'notice' as const, clarification: request }
const pendingChat = () => applyExchange(createChat('1234567890abcdef12345678', now), userMessage, reply)

test('persists a structured card and pending request across local history reload', () => {
  const chat = pendingChat()
  const restored = parseChatHistory(serializeChatHistory([chat], chat.id))!.chats[0]
  assert.deepEqual(restored.clarification, request)
  assert.deepEqual(restored.messages[1].clarification, request)
  assert.equal(pendingClarificationMessageId(restored), 'user-1:reply')
  assert.equal(isSubstantiveAnswer(restored.messages[1]), false)
})

test('successful answer clears pending state but preserves the historical card', () => {
  const chat = applyExchange(pendingChat(), { ...userMessage, id: 'user-2', content: request.options[0], clarificationId: request.id }, { content: 'Ответ', kind: 'answer' })
  assert.equal(chat.clarification, undefined)
  assert.deepEqual(chat.messages[1].clarification, request)
  assert.equal(chat.messages[2].clarificationId, request.id)
  assert.equal(pendingClarificationMessageId(chat), undefined)
})

test('an optimistic outgoing answer keeps the same card available for retry', () => {
  const chat = pendingChat()
  const outgoing = { ...chat, messages: [...chat.messages, { ...userMessage, id: 'pending', pending: true }] }
  assert.equal(pendingClarificationMessageId(outgoing), pendingClarificationMessageId(chat))
  assert.equal(pendingClarificationMessageId(chat), 'user-1:reply')
})

test('only the last unanswered request can be active', () => {
  const chat = pendingChat()
  const nextRequest = { ...request, id: 'clarification-2' }
  const next = applyExchange(chat, { ...userMessage, id: 'user-2' }, { ...reply, clarification: nextRequest })
  assert.equal(pendingClarificationMessageId(next), 'user-2:reply')
  assert.equal(pendingClarificationMessageId({ ...next, clarification: request }), undefined)
  assert.equal(pendingClarificationMessageId({ ...chat, messages: [...chat.messages, { ...userMessage, id: 'user-2' }] }), undefined)
})

test('rejects malformed clarification payloads without interpreting assistant prose', () => {
  assert.equal(isChatReply(reply), true)
  assert.equal(isChatReply({ ...reply, clarification: { ...request, options: [{ label: 'invalid' }] } }), false)
  assert.equal(isChatReply({ ...reply, clarification: { ...request, id: '' } }), false)
  assert.equal(isChatReply({ content: '1. Первый вариант\n2. Другое' }), true)
})

test('maps pending and historical cards from the backend independently', () => {
  const chat = chatFromDialogView({
    id: '1234567890abcdef12345678', reply: 'Ответ', closed: false, updated_at: now,
    clarification: null,
    messages: [
      { role: 'user', content: userMessage.content },
      { role: 'assistant', content: reply.content, clarification: request },
      { role: 'user', content: request.options[0] },
      { role: 'assistant', content: 'Ответ' },
    ],
  })
  assert.deepEqual(chat.messages[1].clarification, request)
  assert.equal(chat.clarification, undefined)
  assert.equal(pendingClarificationMessageId(chat), undefined)
  const pending = chatFromDialogView({ id: chat.id, reply: reply.content, closed: false, updated_at: now, clarification: request, messages: [{ role: 'assistant', content: reply.content, clarification: request }] })
  assert.deepEqual(pending.clarification, request)
  assert.equal(pendingClarificationMessageId(pending), `${chat.id}:m0`)
  assert.deepEqual(mapDialogResponse({ id: chat.id, reply: reply.content, closed: false, clarification: request }).clarification, request)
})

test('fresh remote history updates cached messages instead of losing new cards', () => {
  const existing = createChat('1234567890abcdef12345678', now)
  existing.messages = [userMessage]
  const updated = chatFromDialogView({ id: existing.id, reply: reply.content, closed: false, updated_at: now, clarification: request, messages: [{ role: 'user', content: userMessage.content }, { role: 'assistant', content: reply.content, clarification: request }] }, existing)
  assert.equal(updated.messages.length, 2)
  assert.deepEqual(updated.messages[1].clarification, request)
  assert.ok(pendingClarificationMessageId(updated))
  const listed = chatFromListItem({ id: existing.id, title: existing.title, preview: '', closed: false, updated_at: now }, updated)
  assert.deepEqual(listed.clarification, request)
})

test('stale server snapshots do not resurrect an answered request', () => {
  const answered = applyExchange(pendingChat(), { ...userMessage, id: 'user-2', createdAt: '2026-09-12T12:01:00.000Z' }, { content: 'Ответ' })
  const merged = chatFromDialogView({ id: answered.id, reply: reply.content, closed: false, updated_at: now, clarification: request, messages: [{ role: 'assistant', content: reply.content, clarification: request }] }, answered)
  assert.equal(merged, answered)
  assert.equal(merged.clarification, undefined)
})
