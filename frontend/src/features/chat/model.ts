import type { Chat, ChatMessage, ChatMessageKind, ChatReply, ClarificationRequest, FeedbackRating, SpecialistResponse, SuggestedRephrase, ToolCall } from './types.ts'

// Keep the original key so valid v1 local history is migrated in place.
// Conversation turns and feedback are synchronized with the dialog API.
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

/** Drop one chat and keep the UI on another existing chat or the supplied replacement. */
export function withoutChat(history: ChatHistory, id: string, replacement: Chat): ChatHistory {
  const chats = history.chats.filter((chat) => chat.id !== id)
  if (chats.length === 0) return { ...history, chats: [replacement], activeChatId: replacement.id }
  return { ...history, chats, activeChatId: history.activeChatId === id ? chats[0].id : history.activeChatId }
}

export function withOnlyChat(replacement: Chat): ChatHistory {
  return { version: CHAT_STORAGE_VERSION, chats: [replacement], activeChatId: replacement.id }
}

/** Unknown/legacy text, notices, questions and handoff confirmations are not answers. */
export function isSubstantiveAnswer(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.kind === 'answer' && !message.clarification && !message.suggestedRephrase && message.content.trim().length > 0
}

export function canFeedback(chat: Chat): boolean {
  return !chat.feedback && !chat.feedbackDismissed && (chat.status === 'closed' || Boolean(chat.handoff)) && chat.messages.some(isSubstantiveAnswer)
}

export function canContactSpecialist(chat: Chat): boolean {
  return chat.status === 'open' && !chat.handoff
}

export function closeChat(chat: Chat, noticeId: string, now: string): Chat {
  if (chat.status === 'closed') return chat
  return {
    ...chat,
    status: 'closed',
    closedAt: now,
    updatedAt: now,
    messages: [...chat.messages, { id: noticeId, role: 'assistant', kind: 'notice', content: 'Обращение закрыто.', createdAt: now }],
  }
}

export function reopenChat(chat: Chat, noticeId: string, now: string): Chat {
  if (chat.status === 'open') return chat
  const reopened = { ...chat }
  delete reopened.closedAt
  return {
    ...reopened,
    status: 'open',
    updatedAt: now,
    messages: [...chat.messages, { id: noticeId, role: 'assistant', kind: 'notice', content: 'Обращение открыто повторно.', createdAt: now }],
  }
}

/** Call only after the optional transport has successfully returned a valid response. */
export function applySpecialistHandoff(chat: Chat, response: SpecialistResponse, messageId: string, now: string): Chat {
  if (!canContactSpecialist(chat) || !isSpecialistResponse(response) || (!response.simulated && !response.line)) return chat
  const specialistType = response.specialistType?.trim()
  const next: Chat = {
    ...chat,
    updatedAt: now,
    offerSpecialist: false,
    clarification: undefined,
    suggestedRephrase: undefined,
    handoff: { requestId: response.requestId, simulated: response.simulated, ...(response.line ? { line: response.line } : {}), ...(specialistType ? { specialistType } : {}), createdAt: now },
    messages: [
      ...chat.messages,
      {
        id: messageId,
        role: 'assistant',
        kind: 'handoff',
        createdAt: now,
        content: response.simulated ? 'Демонстрация: обращение передано специалисту. Реальная заявка не отправлена.' : `Ваш запрос отправлен на ${response.line!.slice(1)} линию поддержки`,
      },
    ],
  }
  if (!response.closed) return next
  return { ...next, status: 'closed', closedAt: now }
}

/** Apply only feedback confirmed by the transport, preserving the server timestamp. */
export function submitFeedback(chat: Chat, rating: FeedbackRating, comment: string, submittedAt: string): Chat {
  if (!canFeedback(chat) || !isFeedbackRating(rating) || typeof comment !== 'string' || !isTimestamp(submittedAt)) return chat
  return { ...chat, feedback: { rating, comment, submittedAt }, updatedAt: submittedAt }
}

export function dismissFeedback(chat: Chat): Chat {
  return canFeedback(chat) ? { ...chat, feedbackDismissed: true } : chat
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
    kind: reply.kind ?? 'notice',
    createdAt: userMessage.createdAt,
    ...(reply.toolCalls?.length ? { toolCalls: reply.toolCalls } : {}),
    ...(reply.citations?.length ? { citations: reply.citations } : {}),
    ...(reply.clarification ? { clarification: reply.clarification } : {}),
    ...(reply.suggestedRephrase ? { suggestedRephrase: reply.suggestedRephrase } : {}),
  }
  const firstMessage = !chat.messages.some((message) => message.role === 'user')
  const title = userMessage.content.trim().replace(/\s+/g, ' ')
  const next: Chat = {
    ...chat,
    title: firstMessage ? title.slice(0, 64) || chat.title : chat.title,
    updatedAt: userMessage.createdAt,
    messages: [...chat.messages, userMessage, assistantMessage],
    offerSpecialist: Boolean(reply.offerSpecialist),
    clarification: reply.closed ? undefined : reply.clarification,
    suggestedRephrase: reply.closed ? undefined : reply.suggestedRephrase,
  }
  if (!reply.closed) return next
  return { ...next, status: 'closed', closedAt: userMessage.createdAt }
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

function isMessageKind(value: unknown): value is ChatMessageKind {
  return value === 'answer' || value === 'handoff' || value === 'notice'
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
    (value.line === undefined || value.line === 'L1' || value.line === 'L2' || value.line === 'L3')
  )
}

export function isClarificationRequest(value: unknown): value is ClarificationRequest {
  return isRecord(value) && isNonemptyString(value.id) && isNonemptyString(value.question) && Array.isArray(value.options) && value.options.every(isNonemptyString)
}

export function isSuggestedRephrase(value: unknown): value is SuggestedRephrase {
  return isRecord(value) && isNonemptyString(value.id) && isNonemptyString(value.content)
}

/** Only the latest persisted, unanswered card can accept an answer. */
export function pendingClarificationMessageId(chat: Chat): string | undefined {
  if (!chat.clarification) return undefined
  for (let index = chat.messages.length - 1; index >= 0; index--) {
    const message = chat.messages[index]
    if (message.pending) continue
    if (message.role === 'user') return undefined
    if (message.role === 'assistant' && message.clarification) {
      return message.clarification.id === chat.clarification.id ? message.id : undefined
    }
  }
  return undefined
}

/** Only the latest persisted, unanswered rewrite can be submitted. */
export function pendingSuggestedRephraseMessageId(chat: Chat): string | undefined {
  if (!chat.suggestedRephrase) return undefined
  for (let index = chat.messages.length - 1; index >= 0; index--) {
    const message = chat.messages[index]
    if (message.pending) continue
    if (message.role === 'user') return undefined
    if (message.role === 'assistant' && message.suggestedRephrase) {
      return message.suggestedRephrase.id === chat.suggestedRephrase.id ? message.id : undefined
    }
  }
  return undefined
}

export function isToolCall(value: unknown, { preparing = false }: { preparing?: boolean } = {}): value is ToolCall {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    (isNonemptyString(value.name) || (preparing && value.name === '')) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    isRecord(value.arguments) &&
    isRecord(value.result)
  )
}

export function isChatReply(value: unknown): value is ChatReply {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    (value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every((call: unknown) => isToolCall(call)))) &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) && value.citations.every((citation: unknown) => isRecord(citation) && typeof citation.document === 'string' && typeof citation.section === 'string' && typeof citation.path === 'string'))) &&
    (value.kind === undefined || isMessageKind(value.kind)) &&
    (value.closed === undefined || typeof value.closed === 'boolean') &&
    (value.offerSpecialist === undefined || typeof value.offerSpecialist === 'boolean') &&
    (value.dialogId === undefined || isNonemptyString(value.dialogId)) &&
    (value.clarification === undefined || isClarificationRequest(value.clarification)) &&
    (value.suggestedRephrase === undefined || isSuggestedRephrase(value.suggestedRephrase))
  )
}

function isStoredMessage(value: unknown): value is Omit<ChatMessage, 'kind'> & { kind?: ChatMessageKind | 'clarification' } {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every((call: unknown) => isToolCall(call)))) &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) && value.citations.every((citation: unknown) => isRecord(citation) && typeof citation.document === 'string' && typeof citation.section === 'string' && typeof citation.path === 'string'))) &&
    (value.kind === undefined || value.kind === 'clarification' || isMessageKind(value.kind)) &&
    isTimestamp(value.createdAt) &&
    (value.clarification === undefined || isClarificationRequest(value.clarification)) &&
    (value.clarificationId === undefined || isNonemptyString(value.clarificationId)) &&
    (value.suggestedRephrase === undefined || isSuggestedRephrase(value.suggestedRephrase)) &&
    (value.suggestionId === undefined || isNonemptyString(value.suggestionId))
  )
}

function migrateChat(value: unknown, version: number): Chat | null {
  if (
    !isRecord(value) ||
    !isNonemptyString(value.id) ||
    !isNonemptyString(value.title) ||
    !isTimestamp(value.updatedAt) ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isStoredMessage) ||
    new Set(value.messages.map((message) => message.id)).size !== value.messages.length
  )
    return null
  const status = version === 1 && value.status === undefined ? 'open' : value.status
  const feedbackDismissed = version === 1 && value.feedbackDismissed === undefined ? false : value.feedbackDismissed
  if ((status !== 'open' && status !== 'closed') || typeof feedbackDismissed !== 'boolean') return null
  if (value.offerSpecialist !== undefined && typeof value.offerSpecialist !== 'boolean') return null
  if (value.clarification !== undefined && !isClarificationRequest(value.clarification)) return null
  if (value.suggestedRephrase !== undefined && !isSuggestedRephrase(value.suggestedRephrase)) return null
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
    ...(value.clarification ? { clarification: value.clarification as ClarificationRequest } : {}),
    ...(value.suggestedRephrase ? { suggestedRephrase: value.suggestedRephrase as SuggestedRephrase } : {}),
    messages: value.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      kind: message.kind === 'clarification' ? 'notice' : (message.kind ?? 'notice'),
      ...(message.clarification ? { clarification: message.clarification } : {}),
      ...(message.clarificationId ? { clarificationId: message.clarificationId } : {}),
      ...(message.suggestedRephrase ? { suggestedRephrase: message.suggestedRephrase } : {}),
      ...(message.suggestionId ? { suggestionId: message.suggestionId } : {}),
      ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
      ...(message.citations?.length ? { citations: message.citations } : {}),
    })),
    ...(status === 'closed' ? { closedAt: value.closedAt as string } : {}),
    ...(handoff
      ? {
          handoff: {
            requestId: handoff.requestId as string,
            simulated: handoff.simulated as boolean,
            ...(handoff.line ? { line: handoff.line } : {}),
            ...(handoff.specialistType !== undefined ? { specialistType: handoff.specialistType as string } : {}),
            createdAt: handoff.createdAt as string,
          },
        }
      : {}),
    ...(feedback ? { feedback: { rating: feedback.rating as FeedbackRating, comment: feedback.comment as string, submittedAt: feedback.submittedAt as string } } : {}),
    ...(value.offerSpecialist ? { offerSpecialist: true } : {}),
    ...(typeof value.preview === 'string' && value.preview ? { preview: value.preview } : {}),
  }
}

/** Invalid, incompatible, and corrupt snapshots are ignored as a whole. */
export function parseChatHistory(raw: string | null): ChatHistory | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || (value.version !== 1 && value.version !== CHAT_STORAGE_VERSION) || !Array.isArray(value.chats) || value.chats.length === 0 || typeof value.activeChatId !== 'string') {
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
