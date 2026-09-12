import type { SchemaCitation, SchemaDialogListItem, SchemaDialogResponse, SchemaDialogView, SchemaTopicRef } from '../../api/types.ts'
import { createChat, type ChatHistory } from './model.ts'
import type { Chat, ChatMessage, ChatReply, SpecialistResponse } from './types.ts'

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

function formatCitations(citations: SchemaCitation[]): string {
  if (!citations.length) return ''
  const lines = citations.map((citation) => {
    const label = [citation.document, citation.section].filter((part) => part.trim().length > 0).join(' — ')
    return `• ${label || citation.path}`
  })
  return `\n\nИсточники:\n${lines.join('\n')}`
}

export function mapDialogResponse(data: SchemaDialogResponse): ChatReply {
  const options = data.clarification_options ?? []
  const citations = data.citations ?? []
  const closed = Boolean(data.closed)
  const clarification =
    data.status === 'clarifying' && options.length > 0
      ? {
          id: `clarify:${data.id}:${options.map((option) => option.id).join(',')}`,
          question: data.reply,
          options: options.map((option: SchemaTopicRef) => ({ id: option.id, label: option.title })),
        }
      : undefined
  return {
    dialogId: data.id,
    content: `${data.reply}${data.status === 'answered' ? formatCitations(citations) : ''}`,
    kind: clarification ? 'clarification' : data.status === 'answered' ? 'answer' : 'notice',
    closed,
    offerSpecialist: data.status === 'escalate' && !closed,
    ...(clarification ? { clarification } : {}),
  }
}

export function mapSpecialistResponse(data: SchemaDialogResponse): SpecialistResponse {
  const line = data.line === 'L1' || data.line === 'L2' ? data.line : undefined
  return {
    requestId: data.id,
    simulated: false,
    closed: Boolean(data.closed),
    ...(line ? { line, specialistType: specialistTypeForLine(line) } : {}),
  }
}

function specialistTypeForLine(line: 'L1' | 'L2'): string {
  return line === 'L2' ? 'инцидентам и закупкам (L2)' : 'первой линии поддержки (L1)'
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
  const line = item.line === 'L1' || item.line === 'L2' ? item.line : undefined
  const chat: Chat = {
    id: item.id,
    title: item.title || existing?.title || 'Новое обращение',
    updatedAt,
    messages: existing?.messages ?? [],
    status,
    feedbackDismissed: existing?.feedbackDismissed ?? false,
    ...(item.preview ? { preview: item.preview } : existing?.preview ? { preview: existing.preview } : {}),
    ...(status === 'closed' ? { closedAt: existing?.closedAt ?? updatedAt } : {}),
    ...(existing?.feedback ? { feedback: existing.feedback } : {}),
    ...(item.status === 'escalate' && !item.closed ? { offerSpecialist: true } : existing?.offerSpecialist && status === 'open' ? { offerSpecialist: true } : {}),
  }
  if (existing?.handoff) chat.handoff = existing.handoff
  else if (item.status === 'escalate' && item.closed) {
    chat.handoff = {
      requestId: item.id,
      simulated: false,
      createdAt: existing?.handoff?.createdAt ?? updatedAt,
      ...(line ? { line, specialistType: specialistTypeForLine(line) } : {}),
    }
  }
  return chat
}

export function chatFromDialogView(view: SchemaDialogView, existing?: Chat): Chat {
  const updatedAt = toTimestamp(view.updated_at, existing?.updatedAt)
  const keepLocalMessages = Boolean(existing?.messages.length)
  const title = keepLocalMessages ? existing!.title : view.topic?.title || firstUserTitle(view.messages) || existing?.title || 'Новое обращение'
  const preview = keepLocalMessages
    ? existing?.preview
    : [...(view.messages ?? [])].reverse().find((message) => message.role === 'user')?.content.trim().replace(/\s+/g, ' ').slice(0, 80)
  const messages = keepLocalMessages ? existing!.messages : mapViewMessages(view, existing)
  return chatFromListItem(
    {
      id: view.id,
      title,
      preview: preview ?? existing?.preview ?? '',
      status: view.status,
      topic: view.topic,
      line: view.line,
      closed: Boolean(view.closed),
      reason: view.reason,
      updated_at: updatedAt,
    },
    { ...(existing ?? createChat(view.id, updatedAt)), messages },
  )
}

function mapViewMessages(view: SchemaDialogView, existing?: Chat): ChatMessage[] {
  const raw = view.messages ?? []
  const lastReply = mapDialogResponse(view)
  return raw.map((message, index) => {
    const role = message.role === 'user' ? 'user' : 'assistant'
    const previous = existing?.messages[index]
    if (previous && previous.role === role) return previous
    const isLastAssistant = role === 'assistant' && index === raw.length - 1
    return {
      id: previous?.id ?? `${view.id}:m${index}`,
      role,
      content: isLastAssistant ? lastReply.content : message.content,
      createdAt: previous?.createdAt ?? toTimestamp(view.updated_at),
      ...(role === 'assistant' ? { kind: isLastAssistant ? lastReply.kind : 'notice' } : {}),
      ...(isLastAssistant && lastReply.clarification ? { clarification: lastReply.clarification } : {}),
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
