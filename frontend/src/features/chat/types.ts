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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  clarification?: ClarificationRequest
  clarificationId?: string
}

export interface Chat {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
}

export interface ChatReply {
  content: string
  clarification?: ClarificationRequest
}

// Implement this frontend boundary with the real $api once its contract is available.
export interface ChatTransport {
  send: (messages: readonly ChatMessage[], signal: AbortSignal) => Promise<ChatReply>
}
