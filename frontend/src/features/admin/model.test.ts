/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat } from '../chat/types.ts'
import { getFeedbackContext } from './model.ts'

const baseChat: Chat = {
  id: 'appeal',
  title: 'Appeal',
  updatedAt: '2026-09-12T12:00:00.000Z',
  status: 'closed',
  closedAt: '2026-09-12T12:00:00.000Z',
  feedbackDismissed: false,
  feedback: { rating: 'partial', comment: 'More detail needed', submittedAt: '2026-09-12T12:00:00.000Z' },
  messages: [
    { id: 'u1', role: 'user', content: 'First request', createdAt: '2026-09-12T11:00:00.000Z' },
    { id: 'a1', role: 'assistant', kind: 'answer', content: 'First answer', createdAt: '2026-09-12T11:01:00.000Z' },
    { id: 'u2', role: 'user', content: 'Latest request', createdAt: '2026-09-12T11:02:00.000Z' },
    { id: 'a2', role: 'assistant', kind: 'notice', content: 'Not an answer', createdAt: '2026-09-12T11:03:00.000Z' },
    { id: 'a3', role: 'assistant', kind: 'answer', content: 'Latest answer', createdAt: '2026-09-12T11:04:00.000Z' },
  ],
}

test('feedback context uses the latest substantive answer and its preceding user request', () => {
  const context = getFeedbackContext(baseChat)
  assert.equal(context?.request.id, 'u2')
  assert.equal(context?.answer.id, 'a3')
})

test('feedback context is absent without feedback or a substantive answer', () => {
  assert.equal(getFeedbackContext({ ...baseChat, feedback: undefined }), null)
  assert.equal(getFeedbackContext({ ...baseChat, messages: baseChat.messages.filter((message) => message.kind !== 'answer') }), null)
})
