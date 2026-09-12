import type { SchemaSupportLine } from '../../api/types.ts'

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

/** Feedback is persisted locally only, not submitted to a backend. */
export interface ChatFeedback {
  rating: FeedbackRating
  comment: string
  submittedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  kind?: ChatMessageKind
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
}

export interface ChatReply {
  content: string
  kind?: ChatMessageKind
  closed?: boolean
  offerSpecialist?: boolean
  dialogId?: string
}

export interface ChatTransport {
  create?: (signal: AbortSignal) => Promise<{ id: string }>
  send: (messages: readonly ChatMessage[], signal: AbortSignal, chatId?: string) => Promise<ChatReply>
  requestSpecialist?: (chat: Chat, signal: AbortSignal) => Promise<SpecialistResponse>
  delete?: (chatId: string, signal: AbortSignal) => Promise<void>
  deleteAll?: (signal: AbortSignal) => Promise<void>
}
