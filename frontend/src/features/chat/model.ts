import type { Chat, ChatMessage, ChatMessageKind, ChatReply, ClarificationAnswer, ClarificationRequest, FeedbackRating, SpecialistResponse } from './types.ts'

// Keep the original key so valid v1 local history is migrated in place.
// Feedback stays local. Conversation turns are sent to the dialog API.
export const CHAT_STORAGE_KEY = 'support.chat.v1'
export const CHAT_STORAGE_VERSION = 2

export interface ChatHistory {
  version: typeof CHAT_STORAGE_VERSION
  chats: Chat[]
  activeChatId: string
}

/** Identity and time are supplied by the caller to keep model operations pure. */
export function createChat(id: string, now: string): Chat {
  return { id, title: 'Новое обращение', updatedAt: now, messages: [], status: 'open', feedbackDismissed: false }
}

/** Unknown/legacy text, notices, questions and handoff confirmations are not answers. */
export function isSubstantiveAnswer(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.kind === 'answer' && message.content.trim().length > 0
}

export function canFeedback(chat: Chat): boolean {
  return !chat.feedback && !chat.feedbackDismissed && (chat.status === 'closed' || Boolean(chat.handoff)) && chat.messages.some(isSubstantiveAnswer)
}

export function canContactSpecialist(chat: Chat): boolean {
  return chat.status === 'open' && !chat.handoff && (clarificationCount(chat) >= 3 || Boolean(chat.offerSpecialist))
}

export function closeChat(chat: Chat, noticeId: string, now: string): Chat {
  if (chat.status === 'closed') return chat
  return {
    ...chat, status: 'closed', closedAt: now, updatedAt: now,
    messages: [...chat.messages, { id: noticeId, role: 'assistant', kind: 'notice', content: 'Обращение закрыто.', createdAt: now }],
  }
}

export function reopenChat(chat: Chat, noticeId: string, now: string): Chat {
  if (chat.status === 'open') return chat
  const reopened = { ...chat }
  delete reopened.closedAt
  return {
    ...reopened, status: 'open', updatedAt: now,
    messages: [...chat.messages, { id: noticeId, role: 'assistant', kind: 'notice', content: 'Обращение открыто повторно.', createdAt: now }],
  }
}

/** Call only after the optional transport has successfully returned a valid response. */
export function applySpecialistHandoff(chat: Chat, response: SpecialistResponse, messageId: string, now: string): Chat {
  if (!canContactSpecialist(chat) || !isSpecialistResponse(response)) return chat
  const specialistType = response.specialistType?.trim()
  const next: Chat = {
    ...chat, updatedAt: now, offerSpecialist: false,
    handoff: { requestId: response.requestId, simulated: response.simulated, ...(specialistType ? { specialistType } : {}), createdAt: now },
    messages: [...chat.messages, {
      id: messageId, role: 'assistant', kind: 'handoff', createdAt: now,
      content: specialistType ? `Специалист по ${specialistType} скоро свяжется с Вами` : 'Специалист службы поддержки скоро свяжется с Вами',
    }],
  }
  if (!response.closed) return next
  return { ...next, status: 'closed', closedAt: now }
}

export function submitFeedback(chat: Chat, rating: FeedbackRating, comment: string, now: string): Chat {
  if (!canFeedback(chat) || !isFeedbackRating(rating) || typeof comment !== 'string') return chat
  return { ...chat, feedback: { rating, comment: rating === 'complete' ? '' : comment.trim(), submittedAt: now }, updatedAt: now }
}

export function dismissFeedback(chat: Chat): Chat {
  return canFeedback(chat) ? { ...chat, feedbackDismissed: true } : chat
}

/** Only committed user messages count; repeated answers never inflate the count. */
export function clarificationCount(chat: Chat): number {
  return new Set(chat.messages.filter((message) => message.role === 'user' && message.clarificationId).map((message) => message.clarificationId)).size
}

export function pendingClarification(chat: Chat): ClarificationRequest | undefined {
  const answered = new Set(chat.messages.filter((message) => message.role === 'user').map((message) => message.clarificationId))
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index]
    if (message.role === 'assistant' && message.clarification && !answered.has(message.clarification.id)) {
      return message.clarification
    }
  }
  return undefined
}

/** Commit a successful exchange together; never call this on transport failure. */
export function applyExchange(chat: Chat, userMessage: ChatMessage, reply: ChatReply): Chat {
  if (chat.status === 'closed') throw new Error('Cannot send to a closed chat')
  if (userMessage.role !== 'user') throw new Error('An exchange must start with a user message')
  if (!isChatReply(reply)) throw new Error('Invalid chat reply')
  const assistantMessage: ChatMessage = {
    id: `${userMessage.id}:reply`,
    role: 'assistant',
    content: reply.content,
    kind: reply.kind ?? (reply.clarification ? 'clarification' : 'notice'),
    createdAt: userMessage.createdAt,
    ...(reply.clarification ? { clarification: reply.clarification } : {}),
  }
  const firstMessage = !chat.messages.some((message) => message.role === 'user')
  const title = userMessage.content.trim().replace(/\s+/g, ' ')
  const next: Chat = {
    ...chat,
    title: firstMessage ? title.slice(0, 64) || chat.title : chat.title,
    updatedAt: userMessage.createdAt,
    messages: [...chat.messages, userMessage, assistantMessage],
    offerSpecialist: Boolean(reply.offerSpecialist),
  }
  if (!reply.closed) return next
  return { ...next, status: 'closed', closedAt: userMessage.createdAt }
}

/** Render human-readable labels, never implementation option IDs. */
export function formatClarificationAnswer(request: ClarificationRequest, answer: ClarificationAnswer): string | null {
  const ids = [...new Set(answer.optionIds)]
  if (ids.some((id) => !request.options.some((option) => option.id === id))) return null
  const other = answer.other.trim()
  if (!request.multiple && ids.length + Number(Boolean(other)) > 1) return null
  const labels = request.options.filter((option) => ids.includes(option.id)).map((option) => option.label)
  if (other) labels.push(other)
  return labels.length ? labels.join('; ') : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isClarificationRequest(value: unknown): value is ClarificationRequest {
  if (!isRecord(value)) return false
  return (
    isNonemptyString(value.id) &&
    isNonemptyString(value.question) &&
    (value.multiple === undefined || typeof value.multiple === 'boolean') &&
    Array.isArray(value.options) &&
    value.options.every((option: unknown) => isRecord(option) && isNonemptyString(option.id) && isNonemptyString(option.label) && (option.description === undefined || typeof option.description === 'string')) &&
    new Set(value.options.map((option) => option.id)).size === value.options.length
  )
}

function isMessageKind(value: unknown): value is ChatMessageKind {
  return value === 'answer' || value === 'clarification' || value === 'handoff' || value === 'notice'
}

function isFeedbackRating(value: unknown): value is FeedbackRating {
  return value === 'complete' || value === 'partial' || value === 'irrelevant'
}

export function isSpecialistResponse(value: unknown): value is SpecialistResponse {
  return (
    isRecord(value) &&
    isNonemptyString(value.requestId) &&
    typeof value.simulated === 'boolean' &&
    (value.specialistType === undefined || typeof value.specialistType === 'string') &&
    (value.closed === undefined || typeof value.closed === 'boolean') &&
    (value.line === undefined || value.line === 'L1' || value.line === 'L2')
  )
}

export function isChatReply(value: unknown): value is ChatReply {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    (value.kind === undefined || isMessageKind(value.kind)) &&
    (value.clarification === undefined || isClarificationRequest(value.clarification)) &&
    (value.closed === undefined || typeof value.closed === 'boolean') &&
    (value.offerSpecialist === undefined || typeof value.offerSpecialist === 'boolean') &&
    (value.dialogId === undefined || isNonemptyString(value.dialogId))
  )
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (value.kind === undefined || isMessageKind(value.kind)) &&
    isTimestamp(value.createdAt) &&
    (value.clarificationId === undefined || isNonemptyString(value.clarificationId)) &&
    (value.clarification === undefined || isClarificationRequest(value.clarification))
  )
}

function migrateChat(value: unknown, version: number): Chat | null {
  if (!isRecord(value) || !isNonemptyString(value.id) || !isNonemptyString(value.title) || !isTimestamp(value.updatedAt) || !Array.isArray(value.messages) || !value.messages.every(isMessage) || new Set(value.messages.map((message) => message.id)).size !== value.messages.length) return null
  const status = version === 1 && value.status === undefined ? 'open' : value.status
  const feedbackDismissed = version === 1 && value.feedbackDismissed === undefined ? false : value.feedbackDismissed
  if ((status !== 'open' && status !== 'closed') || typeof feedbackDismissed !== 'boolean') return null
  if (value.offerSpecialist !== undefined && typeof value.offerSpecialist !== 'boolean') return null
  if (value.closedAt !== undefined && !isTimestamp(value.closedAt)) return null
  if (status === 'closed' && !isTimestamp(value.closedAt)) return null
  if (status === 'open' && value.closedAt !== undefined) return null
  const handoff = value.handoff
  if (handoff !== undefined && (!isRecord(handoff) || !isSpecialistResponse(handoff) || !isTimestamp(handoff.createdAt))) return null
  const feedback = value.feedback
  if (feedback !== undefined && (!isRecord(feedback) || !isFeedbackRating(feedback.rating) || typeof feedback.comment !== 'string' || !isTimestamp(feedback.submittedAt))) return null
  return {
    id: value.id,
    title: value.title === 'Новый чат' ? 'Новое обращение' : value.title,
    updatedAt: value.updatedAt,
    status,
    feedbackDismissed,
    messages: value.messages.map((message) => ({ ...message, kind: message.kind ?? (message.clarification ? 'clarification' : 'notice') })),
    ...(status === 'closed' ? { closedAt: value.closedAt as string } : {}),
    ...(handoff ? { handoff: { requestId: handoff.requestId as string, simulated: handoff.simulated as boolean, ...(handoff.specialistType !== undefined ? { specialistType: handoff.specialistType as string } : {}), createdAt: handoff.createdAt as string } } : {}),
    ...(feedback ? { feedback: { rating: feedback.rating as FeedbackRating, comment: feedback.rating === 'complete' ? '' : feedback.comment as string, submittedAt: feedback.submittedAt as string } } : {}),
    ...(value.offerSpecialist ? { offerSpecialist: true } : {}),
    ...(typeof value.preview === 'string' && value.preview ? { preview: value.preview } : {}),
  }
}

/** Invalid, incompatible, and corrupt snapshots are ignored as a whole. */
export function parseChatHistory(raw: string | null): ChatHistory | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      (value.version !== 1 && value.version !== CHAT_STORAGE_VERSION) ||
      !Array.isArray(value.chats) ||
      value.chats.length === 0 ||
      typeof value.activeChatId !== 'string'
    ) {
      return null
    }
    const chats = value.chats.map((chat) => migrateChat(chat, value.version as number))
    if (!chats.every((chat): chat is Chat => chat !== null) || new Set(chats.map((chat) => chat.id)).size !== chats.length || !chats.some((chat) => chat.id === value.activeChatId)) return null
    return { version: CHAT_STORAGE_VERSION, chats, activeChatId: value.activeChatId }
  } catch {
    return null
  }
}

export function serializeChatHistory(chats: Chat[], activeChatId: string): string {
  return JSON.stringify({ version: CHAT_STORAGE_VERSION, chats, activeChatId })
}
