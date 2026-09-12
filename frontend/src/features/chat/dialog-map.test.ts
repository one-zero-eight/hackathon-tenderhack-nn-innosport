/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatFromListItem, isBackendDialogId, isDialogNotFound, isDialogPayload, mapDialogResponse, mapSpecialistResponse, mergeRemoteDialog, mergeRemoteList } from './dialog-map.ts'
import { CHAT_STORAGE_VERSION, createChat, type ChatHistory } from './model.ts'
import type { ChatMessage } from './types.ts'

test('mapDialogResponse turns catalog options into a clarification card', () => {
  const reply = mapDialogResponse({
    id: '64b7f2c1a1b2c3d4e5f60789',
    reply: 'Уточните, пожалуйста, тему обращения. Выберите один из вариантов.',
    status: 'clarifying',
    closed: false,
    clarification_options: [
      { id: 't-001', title: 'Регистрация' },
      { id: 't-008', title: 'Сертификат ЭП' },
    ],
  })
  assert.equal(reply.kind, 'clarification')
  assert.equal(reply.dialogId, '64b7f2c1a1b2c3d4e5f60789')
  assert.equal(reply.clarification?.options[0]?.label, 'Регистрация')
  assert.equal(reply.offerSpecialist, false)
  assert.equal(reply.closed, false)
})

test('mapDialogResponse marks a grounded answer and appends citations', () => {
  const reply = mapDialogResponse({
    id: '64b7f2c1a1b2c3d4e5f60789',
    reply: 'Для регистрации нажмите кнопку «Регистрация».',
    status: 'answered',
    closed: false,
    topic: { id: 't-001', title: 'Регистрация' },
    citations: [{ document: 'Инструкция.pdf', section: '3.3 Регистрация', path: 'docs/Инструкция.pdf' }],
  })
  assert.equal(reply.kind, 'answer')
  assert.match(reply.content, /Регистрация/)
  assert.match(reply.content, /Источники/)
  assert.match(reply.content, /Инструкция\.pdf/)
})

test('mapDialogResponse offers a specialist when the dialog stays open', () => {
  const reply = mapDialogResponse({
    id: '64b7f2c1a1b2c3d4e5f60789',
    reply: 'Вы можете выбрать специалиста.',
    status: 'escalate',
    closed: false,
  })
  assert.equal(reply.kind, 'notice')
  assert.equal(reply.offerSpecialist, true)
})

test('mapSpecialistResponse uses the assigned support line', () => {
  const response = mapSpecialistResponse({
    id: '64b7f2c1a1b2c3d4e5f60789',
    reply: 'Передаём обращение сотруднику (линия L2).',
    status: 'escalate',
    line: 'L2',
    closed: true,
  })
  assert.equal(response.simulated, false)
  assert.equal(response.closed, true)
  assert.equal(response.line, 'L2')
  assert.match(response.specialistType ?? '', /L2/)
})

test('mergeRemoteList uses GET /dialogs summaries and keeps local messages', () => {
  const existing = { ...createChat('64b7f2c1a1b2c3d4e5f60789', '2026-04-25T12:00:00.000Z'), title: 'Старое', messages: [{ id: 'm1', role: 'user', content: 'hello', createdAt: '2026-04-25T12:00:00.000Z' } satisfies ChatMessage] }
  const history: ChatHistory = { version: CHAT_STORAGE_VERSION, chats: [existing], activeChatId: existing.id }
  const items = [
    { id: '64b7f2c1a1b2c3d4e5f60790', title: 'Регистрация', preview: 'Как зарегистрироваться?', closed: false, updated_at: '2026-04-25T13:00:00.000Z', status: 'answered' as const },
    { id: existing.id, title: 'Регистрация', preview: 'hello', closed: false, updated_at: '2026-04-25T12:30:00.000Z' },
  ]
  const merged = mergeRemoteList(history, items)
  assert.equal(merged.chats[0].id, '64b7f2c1a1b2c3d4e5f60790')
  assert.equal(merged.chats[1].messages, existing.messages)
  assert.equal(merged.chats[1].title, 'Регистрация')
  assert.equal(merged.chats[1].preview, 'hello')
  assert.equal(mergeRemoteList(merged, items), merged)
})

test('chatFromListItem and mergeRemoteDialog hydrate an empty appeal once', () => {
  const item = chatFromListItem({ id: '64b7f2c1a1b2c3d4e5f60789', title: 'Новое обращение', preview: '', closed: true, updated_at: '2026-04-25T12:00:00.000Z', status: 'escalate', line: 'L1' })
  assert.equal(item.status, 'closed')
  assert.equal(item.handoff?.line, 'L1')
  const history: ChatHistory = { version: CHAT_STORAGE_VERSION, chats: [item], activeChatId: item.id }
  const hydrated = mergeRemoteDialog(history, {
    id: item.id,
    reply: 'Уточните, пожалуйста, тему обращения. Выберите один из вариантов.',
    status: 'clarifying',
    closed: false,
    updated_at: '2026-04-25T12:00:00.000Z',
    clarification_options: [{ id: 't-001', title: 'Регистрация' }],
    messages: [
      { role: 'user', content: 'помогите' },
      { role: 'assistant', content: 'Уточните, пожалуйста, тему обращения. Выберите один из вариантов.' },
    ],
  })
  assert.equal(hydrated.chats[0].messages.length, 2)
  assert.equal(hydrated.chats[0].messages[1]?.kind, 'clarification')
  assert.equal(hydrated.chats[0].messages[1]?.clarification?.options[0]?.label, 'Регистрация')
  assert.equal(mergeRemoteDialog(hydrated, { id: item.id, reply: 'x', closed: false, messages: [{ role: 'user', content: 'other' }] }), hydrated)
})

test('mergeRemoteList drops backend chats when the server list is empty', () => {
  const remote = createChat('64b7f2c1a1b2c3d4e5f60789', '2026-04-25T12:00:00.000Z')
  const history: ChatHistory = { version: CHAT_STORAGE_VERSION, chats: [remote], activeChatId: remote.id }
  const merged = mergeRemoteList(history, [])
  assert.deepEqual(merged.chats, [])
})

test('dialog helpers recognize Mongo ids and not-found payloads', () => {
  assert.equal(isBackendDialogId('64b7f2c1a1b2c3d4e5f60789'), true)
  assert.equal(isBackendDialogId('chat-local-id'), false)
  assert.equal(isDialogNotFound({ detail: 'Dialog not found' }), true)
  assert.equal(isDialogPayload({ id: '1', reply: 'ok' }), true)
  assert.equal(isDialogPayload({ detail: 'Dialog not found' }), false)
})
