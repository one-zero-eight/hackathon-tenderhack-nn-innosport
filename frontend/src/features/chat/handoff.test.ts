/// <reference types="node" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { chatFromDialogView, mapSpecialistResponse } from './dialog-map.ts'
import { applySpecialistHandoff, createChat, parseChatHistory, serializeChatHistory } from './model.ts'
import type { SchemaDialogResponse } from '../../api/types.ts'

const now = '2026-09-12T10:00:00.000Z'

for (const line of ['L1', 'L2', 'L3'] as const) {
  test(`handoff uses endpoint line ${line} before closing and preserves it in history`, () => {
    const response: SchemaDialogResponse = {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'escalate', line, closed: true,
      reply: `Ваш запрос отправлен на ${line.slice(1)} линию поддержки`,
    }
    const chat = { ...createChat(response.id, now), offerSpecialist: true }
    const next = applySpecialistHandoff(chat, mapSpecialistResponse({ ...response, reply: 'Не использовать вместо номера линии' }), 'handoff', now)
    assert.equal(next.messages.at(-1)?.content, response.reply)
    assert.equal(next.messages.at(-1)?.role, 'assistant')
    assert.equal(next.messages.at(-1)?.kind, 'handoff')
    assert.equal(next.status, 'closed')
    assert.equal(next.handoff?.line, line)
    const restored = parseChatHistory(serializeChatHistory([next], next.id))
    assert.equal(restored?.chats[0].handoff?.line, line)
    assert.equal(restored?.chats[0].messages.at(-1)?.content, response.reply)
    const remote = chatFromDialogView({ ...response, messages: [{ role: 'assistant', content: response.reply }] })
    assert.equal(remote.handoff?.line, line)
    assert.equal(remote.messages.at(-1)?.content, response.reply)
  })
}

test('missing line or an unsuccessful escalation must not invent a handoff', () => {
  const response: SchemaDialogResponse = { id: 'dialog', status: 'escalate', closed: true, reply: '' }
  assert.throws(() => mapSpecialistResponse(response))
  assert.throws(() => mapSpecialistResponse({ ...response, line: 'L1', closed: false }))
  assert.throws(() => mapSpecialistResponse({ ...response, line: 'L1', status: 'closed_abuse' }))
  const chat = { ...createChat('dialog', now), offerSpecialist: true }
  assert.equal(applySpecialistHandoff(chat, { requestId: 'dialog', simulated: false, closed: true }, 'handoff', now), chat)
})
