import type { Chat, ChatMessage, ChatReply, ClarificationAnswer, ClarificationRequest } from './types.ts'

// Keep local demo history separate from future server-backed conversations.
export const CHAT_STORAGE_KEY = 'innosport.chat.v1'
export const CHAT_STORAGE_VERSION = 1

export interface ChatHistory {
  version: typeof CHAT_STORAGE_VERSION
  chats: Chat[]
  activeChatId: string
}

/** Identity and time are supplied by the caller to keep model operations pure. */
export function createChat(id: string, now: string): Chat {
  return { id, title: 'Новое обращение', updatedAt: now, messages: [] }
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
  if (userMessage.role !== 'user') throw new Error('An exchange must start with a user message')
  if (!isChatReply(reply)) throw new Error('Invalid chat reply')
  const assistantMessage: ChatMessage = {
    id: `${userMessage.id}:reply`,
    role: 'assistant',
    content: reply.content,
    createdAt: userMessage.createdAt,
    ...(reply.clarification ? { clarification: reply.clarification } : {}),
  }
  const firstMessage = !chat.messages.some((message) => message.role === 'user')
  const title = userMessage.content.trim().replace(/\s+/g, ' ')
  return {
    ...chat,
    title: firstMessage ? title.slice(0, 64) || chat.title : chat.title,
    updatedAt: userMessage.createdAt,
    messages: [...chat.messages, userMessage, assistantMessage],
  }
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

export function isChatReply(value: unknown): value is ChatReply {
  return isRecord(value) && typeof value.content === 'string' && (value.clarification === undefined || isClarificationRequest(value.clarification))
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    isTimestamp(value.createdAt) &&
    (value.clarificationId === undefined || isNonemptyString(value.clarificationId)) &&
    (value.clarification === undefined || isClarificationRequest(value.clarification))
  )
}

function isChat(value: unknown): value is Chat {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.title) &&
    isTimestamp(value.updatedAt) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    new Set(value.messages.map((message) => message.id)).size === value.messages.length
  )
}

/** Invalid, incompatible, and corrupt snapshots are ignored as a whole. */
export function parseChatHistory(raw: string | null): ChatHistory | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      value.version !== CHAT_STORAGE_VERSION ||
      !Array.isArray(value.chats) ||
      value.chats.length === 0 ||
      !value.chats.every(isChat) ||
      new Set(value.chats.map((chat) => chat.id)).size !== value.chats.length ||
      typeof value.activeChatId !== 'string' ||
      !value.chats.some((chat) => chat.id === value.activeChatId)
    ) {
      return null
    }
    const chats = value.chats.map((chat) => (chat.title === 'Новый чат' ? { ...chat, title: 'Новое обращение' } : chat))
    return { version: CHAT_STORAGE_VERSION, chats, activeChatId: value.activeChatId }
  } catch {
    return null
  }
}

export function serializeChatHistory(chats: Chat[], activeChatId: string): string {
  return JSON.stringify({ version: CHAT_STORAGE_VERSION, chats, activeChatId })
}
