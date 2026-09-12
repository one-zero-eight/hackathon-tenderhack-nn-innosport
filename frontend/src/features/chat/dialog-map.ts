import type { SchemaDialogFeedback, SchemaDialogListItem, SchemaDialogResponse, SchemaDialogView } from '../../api/types.ts'
import { createChat, type ChatHistory } from './model.ts'
import type { Chat, ChatFeedback, ChatMessage, ChatReply, SpecialistResponse } from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isBackendDialogId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test(id)
}

export function isDialogNotFound(error: unknown): boolean {
  return isRecord(error) && error.detail === 'Dialog not found'
}

export function isDialogPayload(value: unknown): value is SchemaDialogResponse {
  return isRecord(value) && typeof value.id === 'string' && typeof value.reply === 'string'
}

export function mapDialogFeedback(data: SchemaDialogFeedback): ChatFeedback {
  return { rating: data.rating, comment: data.comment ?? '', submittedAt: new Date(data.submitted_at).toISOString() }
}

export function mapDialogResponse(data: SchemaDialogResponse): ChatReply {
  const citations = data.citations ?? []
  const closed = Boolean(data.closed)
  return {
    dialogId: data.id,
    content: data.reply,
    ...(data.status === 'answered' && citations.length ? { citations } : {}),
    kind: (closed && data.reason !== 'user_closed') || data.clarification ? 'notice' : 'answer',
    ...(data.clarification ? { clarification: data.clarification } : {}),
    ...(data.tool_calls?.length ? { toolCalls: data.tool_calls } : {}),
    closed,
    offerSpecialist: data.status === 'escalate' && !closed,
  }
}

export function mapSpecialistResponse(data: SchemaDialogResponse): SpecialistResponse {
  const line = data.line
  if (data.status !== 'escalate' || !data.closed || (line !== 'L1' && line !== 'L2' && line !== 'L3')) {
    throw new Error('Invalid specialist escalation response')
  }
  return {
    requestId: data.id,
    simulated: false,
    closed: Boolean(data.closed),
    line,
  }
}

function toTimestamp(value?: string | null, fallback?: string): string {
  if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return fallback ?? new Date().toISOString()
}

function firstUserTitle(messages: { role: string; content: string }[] | undefined): string {
  const first = messages?.find((message) => message.role === 'user')?.content.trim().replace(/\s+/g, ' ') ?? ''
  return first.slice(0, 64)
}

export function chatFromListItem(item: SchemaDialogListItem, existing?: Chat): Chat {
  const status = item.closed ? 'closed' : 'open'
  const updatedAt = toTimestamp(item.updated_at, existing?.updatedAt)
  const line = item.line === 'L1' || item.line === 'L2' || item.line === 'L3' ? item.line : undefined
  const chat: Chat = {
    id: item.id,
    title: item.title || existing?.title || 'Новое обращение',
    updatedAt,
    messages: existing?.messages ?? [],
    ...(existing?.clarification ? { clarification: existing.clarification } : {}),
    status,
    feedbackDismissed: existing?.feedbackDismissed ?? false,
    ...(item.preview ? { preview: item.preview } : existing?.preview ? { preview: existing.preview } : {}),
    ...(status === 'closed' ? { closedAt: existing?.closedAt ?? updatedAt } : {}),
    ...(item.feedback ? { feedback: mapDialogFeedback(item.feedback) } : {}),
    ...(item.status === 'escalate' && !item.closed ? { offerSpecialist: true } : existing?.offerSpecialist && status === 'open' ? { offerSpecialist: true } : {}),
  }
  if (existing?.handoff) chat.handoff = existing.handoff
  else if (item.status === 'escalate' && item.closed && line) {
    chat.handoff = {
      requestId: item.id,
      simulated: false,
      createdAt: existing?.handoff?.createdAt ?? updatedAt,
      ...(line ? { line } : {}),
    }
  }
  return chat
}

export function chatFromDialogView(view: SchemaDialogView, existing?: Chat): Chat {
  const updatedAt = toTimestamp(view.updated_at, existing?.updatedAt)
  if (existing?.messages.length && updatedAt < existing.updatedAt) return existing
  const title = firstUserTitle(view.messages) || existing?.title || 'Новое обращение'
  const preview = [...(view.messages ?? [])].reverse().find((message) => message.role === 'user')?.content.trim().replace(/\s+/g, ' ').slice(0, 80)
  const messages = mapViewMessages(view, existing)
  return chatFromListItem(
    {
      id: view.id,
      title,
      preview: preview ?? existing?.preview ?? '',
      status: view.status,
      line: view.line,
      closed: Boolean(view.closed),
      reason: view.reason,
      feedback: view.feedback,
      updated_at: updatedAt,
    },
    { ...(existing ?? createChat(view.id, updatedAt)), messages, clarification: view.clarification ?? undefined },
  )
}

function mapViewMessages(view: SchemaDialogView, existing?: Chat): ChatMessage[] {
  const raw = view.messages ?? []
  const lastReply = mapDialogResponse(view)
  const previousMessages = existing?.messages.filter((message) => message.kind !== 'notice' || message.clarification)
  return raw.map((message, index) => {
    const role = message.role === 'user' ? 'user' : 'assistant'
    const candidate = previousMessages?.[index]
    const previous = candidate?.role === role && candidate.content === message.content ? candidate : undefined
    const isLastAssistant = role === 'assistant' && index === raw.length - 1
    const citations = role === 'assistant' ? (isLastAssistant ? lastReply.citations : previous?.citations) : undefined
    return {
      id: previous?.id ?? `${view.id}:m${index}`,
      role,
      content: isLastAssistant ? lastReply.content : message.content,
      ...(citations?.length ? { citations } : {}),
      createdAt: previous?.createdAt ?? toTimestamp(view.updated_at),
      ...(role === 'assistant' ? { kind: message.clarification ? 'notice' : isLastAssistant ? lastReply.kind : 'answer' } : {}),
      ...(role === 'assistant' && message.clarification ? { clarification: message.clarification } : {}),
      ...(previous?.clarificationId ? { clarificationId: previous.clarificationId } : {}),
      ...(role === 'assistant' && message.tool_calls?.length ? { toolCalls: message.tool_calls } : {}),
    }
  })
}

function sameChat(left: Chat, right: Chat): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.preview === right.preview &&
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.closedAt === right.closedAt &&
    left.offerSpecialist === right.offerSpecialist &&
    left.clarification === right.clarification &&
    left.feedbackDismissed === right.feedbackDismissed &&
    left.messages === right.messages &&
    left.handoff === right.handoff &&
    left.feedback === right.feedback
  )
}

export function mergeRemoteList(history: ChatHistory, items: readonly SchemaDialogListItem[]): ChatHistory {
  const existingById = new Map(history.chats.map((chat) => [chat.id, chat]))
  const remoteChats = items.map((item) => chatFromListItem(item, existingById.get(item.id)))
  const remoteIds = new Set(items.map((item) => item.id))
  const localDraft = history.chats.find((chat) => !isBackendDialogId(chat.id) && !remoteIds.has(chat.id) && chat.id === history.activeChatId && chat.messages.length === 0)
  const chats = [...(localDraft ? [localDraft] : []), ...remoteChats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  if (chats.length === 0) {
    const locals = history.chats.filter((chat) => !isBackendDialogId(chat.id))
    if (locals.length === 0) {
      return history.chats.length === 0 ? history : { ...history, chats: [], activeChatId: history.activeChatId }
    }
    const activeChatId = locals.some((chat) => chat.id === history.activeChatId) ? history.activeChatId : locals[0].id
    if (history.activeChatId === activeChatId && history.chats.length === locals.length && history.chats.every((chat, index) => sameChat(chat, locals[index]))) {
      return history
    }
    return { ...history, chats: locals, activeChatId }
  }
  const activeChatId = chats.some((chat) => chat.id === history.activeChatId) ? history.activeChatId : chats[0].id
  if (history.activeChatId === activeChatId && history.chats.length === chats.length && history.chats.every((chat, index) => sameChat(chat, chats[index]))) {
    return history
  }
  return { ...history, chats, activeChatId }
}

export function mergeRemoteDialog(history: ChatHistory, view: SchemaDialogView): ChatHistory {
  const existing = history.chats.find((chat) => chat.id === view.id)
  const nextChat = chatFromDialogView(view, existing)
  if (existing && sameChat(existing, nextChat)) return history
  const chats = existing ? history.chats.map((chat) => (chat.id === view.id ? nextChat : chat)) : [nextChat, ...history.chats]
  return { ...history, chats, activeChatId: history.chats.some((chat) => chat.id === history.activeChatId) ? history.activeChatId : nextChat.id }
}
