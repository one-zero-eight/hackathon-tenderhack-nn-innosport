import type { Chat, ChatMessage } from '@/features/chat/types'

export interface FeedbackContext {
  request: ChatMessage
  answer: ChatMessage
}

export function getFeedbackContext(chat: Chat): FeedbackContext | null {
  if (!chat.feedback) return null
  for (let answerIndex = chat.messages.length - 1; answerIndex >= 0; answerIndex -= 1) {
    const answer = chat.messages[answerIndex]
    if (answer.role !== 'assistant' || answer.kind !== 'answer' || !answer.content.trim()) continue
    for (let requestIndex = answerIndex - 1; requestIndex >= 0; requestIndex -= 1) {
      const request = chat.messages[requestIndex]
      if (request.role === 'user') return { request, answer }
    }
  }
  return null
}
