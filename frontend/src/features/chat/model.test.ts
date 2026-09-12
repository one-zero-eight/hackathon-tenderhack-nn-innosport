/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getEventListeners } from 'node:events'
import { applyExchange, applySpecialistHandoff, canContactSpecialist, canFeedback, CHAT_STORAGE_KEY, CHAT_STORAGE_VERSION, clarificationCount, closeChat, createChat, dismissFeedback, formatClarificationAnswer, isChatReply, isSpecialistResponse, isSubstantiveAnswer, parseChatHistory, pendingClarification, reopenChat, serializeChatHistory, submitFeedback } from './model.ts'
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
    title: 'Новое обращение',
    updatedAt: now,
    messages: [],
    status: 'open',
    feedbackDismissed: false,
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

test('history updates the previous default title without discarding an appeal', () => {
  const chat = { ...createChat('chat', now), title: 'Новый чат' }
  const history = parseChatHistory(serializeChatHistory([chat], chat.id))
  assert.equal(history?.chats[0].title, 'Новое обращение')
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

function clarifiedChat() {
  let chat = createChat('clarified', now)
  for (let index = 1; index <= 3; index += 1) {
    chat = applyExchange(chat, user(`answer-${index}`, `question-${index}`), { content: 'Принято', kind: 'notice' })
  }
  return chat
}
const specialistResponse = { specialistType: 'подбору спортивного инвентаря', requestId: 'specialist-1', simulated: true }

test('close/reopen append idempotent notices, reject exchanges and retain pending clarification', () => {
  const initial = applyExchange(createChat('lifecycle', now), user('m1'), { content: 'Вопрос', kind: 'clarification', clarification: request })
  const closed = closeChat(initial, 'closed', now)
  assert.equal(initial.status, 'open')
  assert.equal(closed.status, 'closed')
  assert.equal(closed.closedAt, now)
  assert.equal(closed.messages.at(-1)?.kind, 'notice')
  assert.equal(pendingClarification(closed)?.id, request.id)
  assert.equal(closeChat(closed, 'again', now), closed)
  assert.throws(() => applyExchange(closed, user('send'), { content: 'No', kind: 'answer' }), /closed chat/)
  assert.throws(() => applyExchange(closed, user('answer', request.id), { content: 'No' }), /closed chat/)
  const reopened = reopenChat(closed, 'opened', now)
  assert.equal(reopened.status, 'open')
  assert.equal(reopened.closedAt, undefined)
  assert.equal(reopened.messages.length, initial.messages.length + 2)
  assert.equal(reopened.messages.at(-1)?.kind, 'notice')
  assert.equal(pendingClarification(reopened)?.id, request.id)
  assert.equal(reopenChat(reopened, 'again', now), reopened)
  assert.equal(clarificationCount(reopened), 0)
})

test('only explicit nonempty assistant answers qualify, not legacy text or direct handoff', () => {
  for (const kind of [undefined, 'notice', 'clarification', 'handoff'] as const) {
    const chat = applyExchange(createChat('eligibility', now), user('u1'), { content: 'Some text', kind })
    assert.equal(isSubstantiveAnswer(chat.messages[1]), false)
    assert.equal(canFeedback(closeChat(chat, 'closed', now)), false)
  }
  for (const content of ['', '   ']) {
    const chat = applyExchange(createChat('blank', now), user('u1'), { content, kind: 'answer' })
    assert.equal(canFeedback(closeChat(chat, 'closed', now)), false)
  }
  assert.equal(isSubstantiveAnswer({ ...user('u1'), kind: 'answer' }), false)
  const answer = applyExchange(createChat('answered', now), user('u1'), { content: 'Полезный ответ', kind: 'answer' })
  assert.equal(canFeedback(answer), false)
  assert.equal(canFeedback(closeChat(answer, 'closed', now)), true)
  assert.equal(isChatReply({ content: 'x', kind: 'unknown' }), false)
})

test('specialist eligibility counts unique committed clarifications and requires open chat', () => {
  let chat = createChat('count', now)
  for (let index = 1; index <= 2; index += 1) {
    chat = applyExchange(chat, user(`m${index}`, `q${index}`), { content: 'Notice' })
    assert.equal(canContactSpecialist(chat), false)
    assert.equal(applySpecialistHandoff(chat, specialistResponse, 'handoff', now), chat)
  }
  chat = applyExchange(chat, user('duplicate', 'q2'), { content: 'Notice' })
  assert.equal(clarificationCount(chat), 2)
  assert.equal(canContactSpecialist(chat), false)
  chat = applyExchange(chat, user('m3', 'q3'), { content: 'Notice' })
  assert.equal(canContactSpecialist(chat), true)
  assert.equal(canContactSpecialist(closeChat(chat, 'closed', now)), false)
  const extra = applyExchange(chat, user('m4', 'q4'), { content: 'Notice' })
  assert.equal(canContactSpecialist(extra), true)
})

test('valid handoff is exact, idempotent and by itself never earns feedback', () => {
  const chat = clarifiedChat()
  const handedOff = applySpecialistHandoff(chat, specialistResponse, 'handoff', now)
  assert.deepEqual(handedOff.handoff, { ...specialistResponse, createdAt: now })
  assert.equal(handedOff.messages.at(-1)?.kind, 'handoff')
  assert.equal(handedOff.messages.at(-1)?.content, 'Специалист по подбору спортивного инвентаря скоро свяжется с Вами')
  assert.equal(canFeedback(handedOff), false)
  assert.equal(canFeedback(closeChat(handedOff, 'close', now)), false)
  assert.equal(canContactSpecialist(handedOff), false)
  assert.equal(applySpecialistHandoff(handedOff, specialistResponse, 'duplicate', now), handedOff)
  assert.equal(clarificationCount(handedOff), 3)
  for (const specialistType of [undefined, '', '   ']) {
    const fallback = applySpecialistHandoff(chat, { ...specialistResponse, specialistType }, 'fallback', now)
    assert.equal(fallback.messages.at(-1)?.content, 'Специалист службы поддержки скоро свяжется с Вами')
  }
  for (const response of [null, {}, { requestId: '', simulated: true }, { requestId: 'id' }, { requestId: 'id', simulated: 'true' }, { ...specialistResponse, specialistType: 12 }]) {
    assert.equal(isSpecialistResponse(response), false)
    assert.equal(applySpecialistHandoff(chat, response as never, 'invalid', now), chat)
  }
})

test('feedback is locally recorded once after answer and close or handoff; reopen retains decisions', () => {
  const answer = applyExchange(clarifiedChat(), user('substantive'), { content: 'Полезный ответ', kind: 'answer' })
  assert.equal(submitFeedback(answer, 'partial', 'No yet', now), answer)
  const handedOff = applySpecialistHandoff(answer, specialistResponse, 'handoff', now)
  assert.equal(canFeedback(handedOff), true)
  for (const rating of ['complete', 'partial', 'irrelevant'] as const) {
    const rated = submitFeedback(handedOff, rating, '  Детали  ', now)
    assert.deepEqual(rated.feedback, { rating, comment: rating === 'complete' ? '' : 'Детали', submittedAt: now })
    assert.equal(canFeedback(rated), false)
    assert.equal(submitFeedback(rated, 'irrelevant', 'duplicate', now), rated)
    const reopened = reopenChat(closeChat(rated, 'closed', now), 'opened', now)
    assert.deepEqual(reopened.feedback, rated.feedback)
    assert.deepEqual(reopened.handoff, rated.handoff)
    assert.equal(canFeedback(reopened), false)
    assert.equal(canContactSpecialist(reopened), false)
    assert.equal(clarificationCount(reopened), 3)
  }
  assert.equal(submitFeedback(handedOff, 'invalid' as never, '', now), handedOff)
  const closed = closeChat(answer, 'close', now)
  assert.equal(canFeedback(closed), true)
  assert.equal(canFeedback(reopenChat(closed, 'open', now)), false)
  const dismissed = dismissFeedback(closed)
  assert.equal(dismissed.feedbackDismissed, true)
  assert.equal(canFeedback(dismissed), false)
  assert.equal(dismissFeedback(dismissed), dismissed)
  assert.equal(submitFeedback(dismissed, 'complete', '', now), dismissed)
  assert.equal(reopenChat(dismissed, 'open', now).feedbackDismissed, true)
  assert.equal(dismissFeedback(answer), answer)
})

test('v1 migration preserves valid history, IDs, timestamps, count and pending without inventing answers', () => {
  const old = {
    id: 'legacy', title: 'Новый чат', updatedAt: now,
    messages: [user('u1', 'old-question'), { id: 'a1', role: 'assistant', content: 'Legacy answer-like text', createdAt: now }, { id: 'a2', role: 'assistant', content: 'Question', createdAt: now, clarification: request }],
  }
  const migrated = parseChatHistory(JSON.stringify({ version: 1, chats: [old], activeChatId: old.id }))!
  assert.equal(CHAT_STORAGE_KEY, 'support.chat.v1')
  assert.equal(migrated.version, 2)
  const chat = migrated.chats[0]
  assert.equal(chat.title, 'Новое обращение')
  assert.equal(chat.status, 'open')
  assert.equal(chat.feedbackDismissed, false)
  assert.equal(chat.messages.length, old.messages.length)
  assert.deepEqual(chat.messages.map(({ id, content, createdAt }) => ({ id, content, createdAt })), old.messages.map(({ id, content, createdAt }) => ({ id, content, createdAt })))
  assert.equal(chat.messages[1].kind, 'notice')
  assert.equal(chat.messages[2].kind, 'clarification')
  assert.equal(clarificationCount(chat), 1)
  assert.equal(pendingClarification(chat)?.id, request.id)
  assert.equal(canFeedback(closeChat(chat, 'closed', now)), false)
  assert.deepEqual(parseChatHistory(serializeChatHistory(migrated.chats, migrated.activeChatId)), migrated)
  for (const changes of [{ status: null }, { feedbackDismissed: null }, { updatedAt: 'bad' }]) {
    assert.equal(parseChatHistory(JSON.stringify({ version: 1, chats: [{ ...old, ...changes }], activeChatId: old.id })), null)
  }
})

test('v2 persistence round-trips handoff, close date, rating and dismissal and validates lifecycle fields', () => {
  const answer = applyExchange(clarifiedChat(), user('answer'), { content: 'Suggestion', kind: 'answer' })
  const handedOff = applySpecialistHandoff(answer, specialistResponse, 'handoff', now)
  const rated = closeChat(submitFeedback(handedOff, 'partial', 'More details', now), 'closed', now)
  const history = parseChatHistory(serializeChatHistory([rated], rated.id))!
  assert.deepEqual(history.chats[0].handoff, rated.handoff)
  assert.deepEqual(history.chats[0].feedback, rated.feedback)
  assert.equal(history.chats[0].closedAt, now)
  assert.equal(canFeedback(history.chats[0]), false)
  const dismissed = dismissFeedback(handedOff)
  assert.equal(parseChatHistory(serializeChatHistory([dismissed], dismissed.id))?.chats[0].feedbackDismissed, true)
  for (const changes of [
    { status: 'unknown' }, { status: undefined }, { status: 'closed', closedAt: undefined }, { closedAt: 'bad' },
    { feedbackDismissed: 'false' }, { feedbackDismissed: undefined },
    { handoff: { ...rated.handoff, simulated: undefined } }, { handoff: { ...rated.handoff, createdAt: 'bad' } },
    { feedback: { ...rated.feedback, rating: 'bad' } }, { feedback: { ...rated.feedback, comment: null } }, { feedback: { ...rated.feedback, submittedAt: 'bad' } },
    { messages: [{ ...rated.messages[0], kind: 'invalid' }] },
  ]) assert.equal(parseChatHistory(serializeChatHistory([{ ...rated, ...changes } as never], rated.id)), null)
})

test('demo specialist transport is abortable and explicitly simulated', async () => {
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(demoTransport.requestSpecialist!(clarifiedChat(), aborted.signal), { name: 'AbortError' })
  const during = new AbortController()
  const pending = demoTransport.requestSpecialist!(clarifiedChat(), during.signal)
  during.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  const result = await demoTransport.requestSpecialist!(clarifiedChat(), new AbortController().signal)
  assert.equal(isSpecialistResponse(result), true)
  assert.equal(result.specialistType, 'подбору спортивного инвентаря')
  assert.equal(result.simulated, true)
  assert.match(result.requestId, /^demo-specialist:/)
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
  assert.match(chat.messages.at(-1)!.content, /Пример ответа/)
  assert.equal(isSubstantiveAnswer(chat.messages.at(-1)!), true)
  assert.equal(chat.messages.slice(0, -1).some(isSubstantiveAnswer), false)
  assert.equal(canFeedback(chat), false)
  assert.equal(canFeedback(closeChat(chat, 'close-demo', now)), true)
  assert.match(chat.messages.at(-1)!.content, /не выполнялись/)
  assert.equal(pendingClarification(chat), undefined)
})
