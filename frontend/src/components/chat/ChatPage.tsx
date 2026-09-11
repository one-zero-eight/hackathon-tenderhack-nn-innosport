import { useEffect, useRef, useState } from 'react'
import { LuArrowDown, LuList, LuPanelLeft, LuSparkles, LuLoaderCircle, LuInfo } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { useChat } from '@/features/chat/useChat'
import ChatSidebar from './ChatSidebar'
import ChatOutline from './ChatOutline'
import ChatComposer from './ChatComposer'
import ClarificationCard from './ClarificationCard'
import SpecialistContact from './SpecialistContact'

export default function ChatPage() {
  const chat = useChat()
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [activeMessage, setActiveMessage] = useState('')
  const [nearBottom, setNearBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const previousChat = useRef(chat.activeChatId)
  const messages = chat.activeChat.messages

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
    setRightOpen(false)
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
  const outline = <ChatOutline messages={messages} activeId={activeMessage} onNavigate={navigate} />

  return (
    <div className="bg-background text-foreground flex h-dvh overflow-hidden">
      <aside className="border-border hidden w-64 shrink-0 border-r md:block">{sidebar}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" className="p-2 md:hidden" aria-label="Открыть список чатов" onClick={() => setLeftOpen(true)}>
              <LuPanelLeft className="size-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{chat.activeChat.title}</h1>
              <p className="text-foreground/40 mt-0.5 text-xs">Ваш персональный помощник</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="border-border bg-surface-2 text-foreground/50 rounded-full border px-2.5 py-1 text-[10px] font-medium">Деморежим</span>
            <Button variant="ghost" className="p-2 xl:hidden" aria-label="Открыть навигацию по диалогу" onClick={() => setRightOpen(true)}>
              <LuList className="size-5" />
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="relative flex min-w-0 flex-1 flex-col">
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
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 sm:px-8">
                {!messages.length ? (
                  <section className="my-auto py-10 text-center">
                    <span className="border-primary/10 bg-primary/5 text-primary mx-auto mb-6 grid size-16 place-items-center rounded-2xl border">
                      <LuSparkles className="size-7" />
                    </span>
                    <p className="text-primary mb-3 text-xs font-medium tracking-[0.2em] uppercase">InnoSport · Помощник</p>
                    <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Чем можем помочь?</h2>
                    <p className="text-foreground/55 mx-auto mt-4 max-w-md text-sm leading-7">Опишите ваш вопрос — ассистент поможет разобраться и при необходимости уточнит детали.</p>
                    <div className="border-border bg-surface-2 text-foreground/50 mx-auto mt-8 flex max-w-md gap-3 rounded-xl border p-4 text-left text-xs leading-5">
                      <LuInfo className="mt-0.5 size-4 shrink-0" />
                      <p>Это демонстрация интерфейса без подключения к ИИ. Отправьте вопрос, чтобы проверить три шага уточнения. Переписка сохраняется только в этом браузере.</p>
                    </div>
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
                        <div className={`text-foreground/40 mb-2 flex items-center gap-2 text-xs ${message.role === 'user' ? 'justify-end' : ''}`}>
                          {message.role === 'assistant' && (
                            <span className="bg-primary/10 text-primary grid size-6 place-items-center rounded-lg">
                              <LuSparkles className="size-3" />
                            </span>
                          )}
                          <span>{message.role === 'user' ? 'Вы' : 'Ассистент'}</span>
                          {message.clarificationId && <span className="bg-primary/5 text-primary rounded px-1.5 py-0.5 text-[10px]">Уточнение</span>}
                          <time dateTime={message.createdAt} className="text-[10px]">
                            {new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </time>
                        </div>
                        <div className={`text-sm leading-7 break-words whitespace-pre-wrap ${message.role === 'user' ? 'bg-surface-2 rounded-2xl rounded-tr-md px-5 py-3' : 'text-foreground/85'}`}>{message.content}</div>
                        {message.clarification && <ClarificationCard request={message.clarification} answered={messages.some((item) => item.clarificationId === message.clarification?.id)} busy={chat.busy} onAnswer={chat.answer} />}
                      </article>
                    ))}
                  </div>
                )}
                {chat.busy && (
                  <div role="status" className="text-foreground/50 mt-6 flex items-center gap-2 text-sm">
                    <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    Готовим ответ…
                  </div>
                )}
              </div>
            </div>
            <div className="bg-background shrink-0 px-4 pt-2 pb-4 sm:px-8">
              <div className="mx-auto max-w-3xl">
                {!nearBottom && messages.length > 0 && (
                  <div className="mb-3 flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const element = scrollRef.current
                        if (element) element.scrollTop = element.scrollHeight
                        stickToBottom.current = true
                      }}
                      className="bg-background flex items-center gap-2 rounded-full"
                    >
                      <LuArrowDown className="size-3" />К последнему сообщению
                    </Button>
                  </div>
                )}
                {chat.error && (
                  <p role="alert" className="border-error/20 bg-error/5 text-error mb-3 rounded-xl border p-3 text-sm">
                    {chat.error} Попробуйте отправить ещё раз — ваш ввод сохранён.
                  </p>
                )}
                {chat.clarificationCount >= 3 && <SpecialistContact key={chat.activeChatId} />}
                <ChatComposer draft={chat.draft} onDraft={chat.setDraft} onSend={chat.send} busy={chat.busy} awaitingClarification={!!chat.pendingClarification} />
                <p className="text-foreground/35 mt-3 text-center text-[10px] leading-4">Демонстрационные ответы · Не вводите персональные и конфиденциальные данные</p>
              </div>
            </div>
          </main>
          <aside className="border-border hidden w-52 shrink-0 border-l xl:block">{outline}</aside>
        </div>
      </div>
      <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} title="Ваши чаты">
        {sidebar}
      </Drawer>
      <Drawer open={rightOpen} onClose={() => setRightOpen(false)} title="По диалогу" side="right">
        {outline}
      </Drawer>
    </div>
  )
}
