import { createFileRoute } from '@tanstack/react-router'
import ChatPage from '@/components/chat/ChatPage'

export const Route = createFileRoute('/_chat')({
  component: ChatPage,
})
