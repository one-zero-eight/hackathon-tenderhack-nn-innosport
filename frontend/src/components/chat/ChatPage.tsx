import { useEffect, useRef, useState } from 'react'
import { LuArrowDown, LuPanelLeft, LuSparkles, LuLoaderCircle } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { useChat } from '@/features/chat/useChat'
import ChatSidebar from './ChatSidebar'
import ChatOutline from './ChatOutline'
import ChatComposer from './ChatComposer'
import ClarificationCard from './ClarificationCard'
import SpecialistContact from './SpecialistContact'
import BotFeedbackCard from './BotFeedbackCard'
import ChatStatusActions from './ChatStatusActions'

export default function ChatPage() {
  const chat = useChat()
  const [leftOpen, setLeftOpen] = useState(false)
  const [activeMessage, setActiveMessage] = useState('')
  const [nearBottom, setNearBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const previousChat = useRef(chat.activeChatId)
  const messages = chat.activeChat.messages
  const closed = chat.activeChat.status === 'closed'

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (previousChat.current !== chat.activeChatId || stickToBottom.current) {
      container.scrollTop = container.scrollHeight
      stickToBottom.current = true
    }
    previousChat.current = chat.activeChatId
  }, [chat.activeChatId, messages.length, chat.busy])

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
  }, [chat.activeChatId, messages.length])

  const navigate = (id: string) => {
    stickToBottom.current = false
    const element = document.getElementById(`message-${id}`)
    element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
    setActiveMessage(id)
  }
  const sidebar = (
    <ChatSidebar
      chats={chat.chats}
      activeId={chat.activeChatId}
      onSelect={(id) => {
        chat.selectChat(id)
        setLeftOpen(false)
      }}
      onCreate={() => {
        chat.createChat()
        setLeftOpen(false)
      }}
    />
  )
  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <aside className="border-border hidden w-64 shrink-0 border-r md:block">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <main className="relative flex min-w-0 flex-1 flex-col">
            <Button variant="ghost" className="bg-background/90 absolute top-4 left-4 z-20 p-2 shadow-sm backdrop-blur md:hidden" aria-label="Открыть список обращений" onClick={() => setLeftOpen(true)}>
              <LuPanelLeft className="size-5" />
            </Button>
            <ChatOutline messages={messages} activeId={activeMessage} onNavigate={navigate} />
            <div
              ref={scrollRef}
              onScroll={() => {
                const element = scrollRef.current!
                const near = element.scrollHeight - element.scrollTop - element.clientHeight < 100
                stickToBottom.current = near
                setNearBottom(near)
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
                        <div className={`text-ui-body leading-7 break-words whitespace-pre-wrap ${message.role === 'user' ? 'bg-surface-2 rounded-2xl rounded-tr-md px-5 py-3' : 'text-foreground/85'}`}>{message.content}</div>
                        {message.kind === 'handoff' && chat.activeChat.handoff?.simulated && <p className="text-foreground/45 text-ui-small mt-2">Демонстрация: реальная заявка не отправлена, связь со специалистом не установлена.</p>}
                        {message.clarification && (
                          <ClarificationCard request={message.clarification} answered={messages.some((item) => item.clarificationId === message.clarification?.id)} busy={chat.busy} closed={closed} onAnswer={chat.answer} />
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {(chat.canFeedback || chat.activeChat.feedback) && (
                  <BotFeedbackCard key={chat.activeChatId} feedback={chat.activeChat.feedback} waitingForSpecialist={!!chat.activeChat.handoff && !closed} busy={chat.busy} onSubmit={chat.submitFeedback} onDismiss={chat.dismissFeedback} />
                )}
                {chat.busy && (
                  <div role="status" className="text-foreground/50 text-ui-body mt-6 flex items-center gap-2">
                    <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    Готовим ответ…
                  </div>
                )}
              </div>
            </div>
            <div className="bg-background shrink-0 px-4 pt-2 pb-4 sm:px-8">
              <div className="mx-auto max-w-3xl">
                {chat.error && (
                  <p role="alert" className="border-error/20 bg-error/5 text-error text-ui-body mb-3 rounded-xl border p-3">
                    {chat.error}
                  </p>
                )}
                {chat.activeChat.handoff && (
                  <p role="status" className="text-primary text-ui-body mb-3 text-center">
                    {closed ? (chat.activeChat.handoff.simulated ? 'Демонстрационная передача специалисту сохранена' : 'Обращение было передано специалисту') : chat.activeChat.handoff.simulated ? 'Деморежим: ожидаем специалиста' : 'Ожидаем специалиста'}
                  </p>
                )}
                <ChatStatusActions
                  closed={closed}
                  busy={chat.busy}
                  latestAction={
                    !nearBottom && messages.length > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="К последнему сообщению"
                        onClick={() => {
                          const element = scrollRef.current
                          if (element) element.scrollTop = element.scrollHeight
                          stickToBottom.current = true
                        }}
                        className="bg-background flex items-center gap-2 rounded-full"
                      >
                        <LuArrowDown className="size-3" />
                        <span className="hidden sm:inline">К последнему сообщению</span>
                      </Button>
                    ) : undefined
                  }
                  onClose={chat.closeChat}
                  onReopen={chat.reopenChat}
                />
                {!closed && !chat.activeChat.handoff && chat.clarificationCount >= 3 && <SpecialistContact busy={chat.busy} onContact={chat.contactSpecialist} />}
                {!closed && <ChatComposer draft={chat.draft} onDraft={chat.setDraft} onSend={chat.send} busy={chat.busy} awaitingClarification={!!chat.pendingClarification} />}
              </div>
            </div>
          </main>
        </div>
      </div>
      <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} title="Ваши обращения">
        {sidebar}
      </Drawer>
    </div>
  )
}
