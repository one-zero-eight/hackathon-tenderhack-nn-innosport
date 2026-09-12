import type { SchemaCitation, SchemaSpecialistContact, SchemaSupportLine } from '../../api/types.ts'

export interface ClarificationRequest {
  id: string
  question: string
  options: string[]
}

export interface SuggestedRephrase {
  id: string
  content: string
}

export type ChatMessageKind = 'answer' | 'handoff' | 'notice'
export type FeedbackRating = 'complete' | 'partial' | 'irrelevant'

export interface SpecialistResponse {
  specialistType?: string
  requestId: string
  simulated: boolean
  closed?: boolean
  line?: SchemaSupportLine
}

export interface ChatHandoff extends SpecialistResponse {
  createdAt: string
}

export interface ChatFeedback {
  rating: FeedbackRating
  comment: string
  submittedAt: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result: Record<string, unknown>
}

export type ChatToolStatus = 'preparing' | 'running' | 'completed' | 'error' | 'awaiting_user'

export interface ChatToolCall extends ToolCall {
  status: ChatToolStatus
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  kind?: ChatMessageKind
  citations?: SchemaCitation[]
  toolCalls?: (ToolCall | ChatToolCall)[]
  clarification?: ClarificationRequest
  clarificationId?: string
  suggestedRephrase?: SuggestedRephrase
  suggestionId?: string
  pending?: boolean
}

export interface Chat {
  id: string
  title: string
  preview?: string
  updatedAt: string
  messages: ChatMessage[]
  status: 'open' | 'closed'
  closedAt?: string
  handoff?: ChatHandoff
  feedback?: ChatFeedback
  feedbackDismissed: boolean
  offerSpecialist?: boolean
  clarification?: ClarificationRequest
  suggestedRephrase?: SuggestedRephrase
}

export interface ChatReply {
  content: string
  kind?: ChatMessageKind
  citations?: SchemaCitation[]
  toolCalls?: ToolCall[]
  closed?: boolean
  offerSpecialist?: boolean
  dialogId?: string
  clarification?: ClarificationRequest
  suggestedRephrase?: SuggestedRephrase
}

export interface ChatTransport {
  create?: (signal: AbortSignal) => Promise<{ id: string }>
  send: (messages: readonly ChatMessage[], signal: AbortSignal, chatId?: string, onText?: (text: string) => void, onTool?: (tool: ChatToolCall) => void) => Promise<ChatReply>
  requestSpecialist?: (chat: Chat, signal: AbortSignal, contact: SchemaSpecialistContact) => Promise<SpecialistResponse>
  submitFeedback?: (chatId: string, rating: FeedbackRating, comment: string, signal: AbortSignal) => Promise<ChatFeedback>
  close?: (chatId: string, signal: AbortSignal) => Promise<{ updatedAt: string | null }>
  delete?: (chatId: string, signal: AbortSignal) => Promise<void>
  deleteAll?: (signal: AbortSignal) => Promise<void>
}
