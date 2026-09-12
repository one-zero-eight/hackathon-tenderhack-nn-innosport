import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { LuLoaderCircle, LuSparkles } from 'react-icons/lu'
import type { Chat } from '@/features/chat/types'
import ChatOutline from './ChatOutline'
import MarkdownMessage from './MarkdownMessage'

export interface ChatTranscriptHandle {
  scrollToBottom: () => void
}

interface ChatTranscriptProps {
  chat: Chat
  busy?: boolean
  afterMessages?: ReactNode
  onNearBottomChange?: (nearBottom: boolean) => void
}

const ChatTranscript = forwardRef<ChatTranscriptHandle, ChatTranscriptProps>(({ chat, busy = false, afterMessages, onNearBottomChange }, ref) => {
  const [activeMessage, setActiveMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const previousChat = useRef(chat.id)
  const previousUserMessage = useRef<string | undefined>(undefined)
  const messages = chat.messages
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.id

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const submittedMessage = busy && latestUserMessage !== previousUserMessage.current
    if (previousChat.current !== chat.id || submittedMessage || stickToBottom.current) {
      container.scrollTop = container.scrollHeight
      stickToBottom.current = true
      onNearBottomChange?.(true)
    }
    previousChat.current = chat.id
    previousUserMessage.current = latestUserMessage
  }, [chat.id, messages.length, latestUserMessage, busy, onNearBottomChange])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId!
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top)
          else visible.delete(id)
        }
        const first = [...visible].sort((a, b) => a[1] - b[1])[0]
        if (first) setActiveMessage(first[0])
      },
      { root: container, rootMargin: '0px 0px -20% 0px', threshold: 0 },
    )
    container.querySelectorAll('[data-user-message]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [chat.id, messages.length])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        const container = scrollRef.current
        if (!container) return
        container.scrollTop = container.scrollHeight
        stickToBottom.current = true
        onNearBottomChange?.(true)
      },
    }),
    [onNearBottomChange],
  )

  const navigate = (id: string) => {
    stickToBottom.current = false
    const element = document.getElementById(`message-${id}`)
    element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
    setActiveMessage(id)
  }

  return (
    <>
      <ChatOutline messages={messages} activeId={activeMessage} onNavigate={navigate} />
      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current!
          const near = element.scrollHeight - element.scrollTop - element.clientHeight < 100
          stickToBottom.current = near
          onNearBottomChange?.(near)
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-16 sm:px-8">
          {!messages.length ? (
            <section className="my-auto py-10 text-center">
              <span className="border-primary/10 bg-primary/5 text-primary mx-auto mb-6 grid size-16 place-items-center rounded-2xl border">
                <LuSparkles className="size-7" />
              </span>
              <p className="text-primary text-ui-small mb-3 font-medium tracking-[0.2em] uppercase">ИИ-Помощник</p>
              <h2 className="text-ui-title font-semibold tracking-tight">Чем можем помочь?</h2>
              <p className="text-foreground/55 text-ui-body mx-auto mt-4 max-w-md leading-7">Опишите ваш вопрос — ассистент поможет разобраться и при необходимости уточнит детали.</p>
            </section>
          ) : (
            <div className="space-y-8">
              {messages.map((message) => (
                <article
                  key={message.id}
                  id={`message-${message.id}`}
                  data-message-id={message.id}
                  data-user-message={message.role === 'user' ? '' : undefined}
                  className={`scroll-mt-6 ${message.role === 'user' ? 'ml-auto max-w-[90%] sm:max-w-[80%]' : 'w-full'}`}
                >
                  <div className={`text-foreground/40 text-ui-small mb-2 flex items-center gap-2 ${message.role === 'user' ? 'justify-end' : ''}`}>
                    {message.role === 'assistant' && (
                      <span className="bg-primary/10 text-primary grid size-6 place-items-center rounded-lg">
                        <LuSparkles className="size-3" />
                      </span>
                    )}
                    <span>{message.role === 'user' ? 'Вы' : message.kind === 'notice' ? 'Статус обращения' : 'Ассистент'}</span>
                    <time dateTime={message.createdAt} className="text-ui-small">
                      {new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  {message.role === 'assistant' ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <div className="text-ui-body bg-surface-2 rounded-2xl rounded-tr-md px-5 py-3 leading-7 break-words whitespace-pre-wrap">{message.content}</div>
                  )}
                  {message.kind === 'handoff' && chat.handoff?.simulated && <p className="text-foreground/45 text-ui-small mt-2">Демонстрация: реальная заявка не отправлена, связь со специалистом не установлена.</p>}
                </article>
              ))}
            </div>
          )}
          {afterMessages}
          {busy && (
            <div role="status" className="text-foreground/50 text-ui-body mt-6 flex items-center gap-2">
              <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Готовим ответ…
            </div>
          )}
        </div>
      </div>
    </>
  )
})

ChatTranscript.displayName = 'ChatTranscript'

export default ChatTranscript
