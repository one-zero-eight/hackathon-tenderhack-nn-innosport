export interface ClarificationOption {
  id: string
  label: string
  description?: string
}

export interface ClarificationRequest {
  id: string
  question: string
  options: ClarificationOption[]
  multiple?: boolean
}

export interface ClarificationAnswer {
  optionIds: string[]
  other: string
}

export type ChatMessageKind = 'answer' | 'clarification' | 'handoff' | 'notice'
export type FeedbackRating = 'complete' | 'partial' | 'irrelevant'

export interface SpecialistResponse {
  specialistType?: string
  requestId: string
  simulated: boolean
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
  clarification?: ClarificationRequest
  clarificationId?: string
}

export interface Chat {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
  status: 'open' | 'closed'
  closedAt?: string
  handoff?: ChatHandoff
  feedback?: ChatFeedback
  feedbackDismissed: boolean
}

export interface ChatReply {
  content: string
  kind?: ChatMessageKind
  clarification?: ClarificationRequest
}

// Implement this frontend boundary with the real $api once its contract is available.
export interface ChatTransport {
  send: (messages: readonly ChatMessage[], signal: AbortSignal) => Promise<ChatReply>
  requestSpecialist?: (chat: Chat, signal: AbortSignal) => Promise<SpecialistResponse>
}
