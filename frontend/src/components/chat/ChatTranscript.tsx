import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { LuCheck, LuChevronDown, LuCircleAlert, LuClock, LuFileText, LuLoaderCircle, LuSparkles, LuWrench } from 'react-icons/lu'
import type { Chat, ChatMessage, ChatToolStatus, ClarificationRequest } from '@/features/chat/types'
import { pendingClarificationMessageId } from '@/features/chat/model'
import ClarificationCard from './ClarificationCard'
import ChatOutline from './ChatOutline'
import MarkdownMessage from './MarkdownMessage'
import PdfSourceDialog from './PdfSourceDialog'
import { pdfSourceUrl } from '@/features/chat/sources'

export interface ChatTranscriptHandle {
  scrollToBottom: () => void
}

interface ChatTranscriptProps {
  chat: Chat
  busy?: boolean
  afterMessages?: ReactNode
  onNearBottomChange?: (nearBottom: boolean) => void
  onAnswerClarification?: (request: ClarificationRequest, content: string) => Promise<boolean>
}

const toolStatuses = {
  preparing: { label: 'Подготовка вызова', Icon: LuLoaderCircle, className: 'text-foreground/55' },
  running: { label: 'Выполняется', Icon: LuLoaderCircle, className: 'text-primary' },
  completed: { label: 'Завершено', Icon: LuCheck, className: 'text-foreground/55' },
  error: { label: 'Ошибка', Icon: LuCircleAlert, className: 'text-red-600 dark:text-red-400' },
  awaiting_user: { label: 'Ожидает вашего ответа', Icon: LuClock, className: 'text-primary' },
} satisfies Record<ChatToolStatus, { label: string; Icon: typeof LuCheck; className: string }>

function toolStatus(call: NonNullable<ChatMessage['toolCalls']>[number], pending = false): ChatToolStatus {
  if (pending && 'status' in call) return call.status
  if (typeof call.result.error === 'string') return 'error'
  if (call.result.status === 'awaiting_user') return 'awaiting_user'
  return 'completed'
}

const toolActivityLabels: Record<string, string> = {
  search_knowledge: 'Ищем информацию…',
  read_section: 'Изучаем инструкцию…',
  ask_clarification: 'Уточняем вопрос…',
  respond: 'Готовим ответ…',
}

function ToolActivity({ message }: { message: ChatMessage }) {
  const calls = message.toolCalls ?? []
  const running = message.pending ? calls.find((call) => ['preparing', 'running'].includes(toolStatus(call, true))) : undefined
  return (
    <details className="group/activity mb-2 text-xs">
      <summary className="text-foreground/40 hover:text-foreground/65 focus-visible:outline-primary flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded py-1 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        {running ? <LuLoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin motion-reduce:animate-none" /> : <LuWrench aria-hidden="true" className="size-3 shrink-0" />}
        <span aria-live={message.pending ? 'polite' : 'off'}>{running ? `${toolStatus(running, true) === 'preparing' ? 'Подготовка вызова' : toolActivityLabels[running.name] ?? 'Выполняется'} · ${running.name}` : 'Детали ответа'}</span>
        <LuChevronDown aria-hidden="true" className="size-3 shrink-0 transition-transform group-open/activity:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ol aria-label="Вызовы инструментов" className="border-foreground/10 mt-1 max-h-72 space-y-2 overflow-y-auto border-l pl-3">
        {calls.map((call) => {
          const status = toolStatus(call, message.pending)
          const { label, Icon, className } = toolStatuses[status]
          return (
            <li key={call.id} className="min-w-0">
              <details>
                <summary className="text-foreground/55 focus-visible:outline-primary flex cursor-pointer list-none flex-wrap items-center gap-1.5 rounded py-1 focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                  <Icon aria-hidden="true" className={`size-3 shrink-0 ${className} ${['preparing', 'running'].includes(status) ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                  <code className="break-all">{call.name}</code>
                  <span className={className}>{label}</span>
                </summary>
                <div className="text-foreground/55 py-2">
                  <p className="mb-1">Аргументы</p>
                  <pre className="mb-2 font-mono break-words whitespace-pre-wrap">{JSON.stringify(call.arguments, null, 2)}</pre>
                  {!['preparing', 'running'].includes(status) && (
                    <>
                      <p className="mb-1">Результат</p>
                      <pre className="font-mono break-words whitespace-pre-wrap">{JSON.stringify(call.result, null, 2)}</pre>
                    </>
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

const ChatTranscript = forwardRef<ChatTranscriptHandle, ChatTranscriptProps>(({ chat, busy = false, afterMessages, onNearBottomChange, onAnswerClarification }, ref) => {
  const [activeMessage, setActiveMessage] = useState('')
  const [pdfSource, setPdfSource] = useState<{ chatId: string; citation: NonNullable<ChatMessage['citations']>[number] } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const previousChat = useRef(chat.id)
  const previousUserMessage = useRef<string | undefined>(undefined)
  const messages = chat.messages
  const pendingClarificationId = pendingClarificationMessageId(chat)
  const lastUserIndex = messages.reduce((last, message, index) => message.role === 'user' ? index : last, -1)
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.id
  const streamingMessage = messages.find((message) => message.role === 'assistant' && message.pending)
  const latestContent = messages.at(-1)?.content
  const latestTools = messages.at(-1)?.toolCalls

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
  }, [chat.id, messages.length, latestContent, latestTools, latestUserMessage, busy, onNearBottomChange])

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
      {pdfSource?.chatId === chat.id && <PdfSourceDialog citation={pdfSource.citation} onClose={() => setPdfSource(null)} />}
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
              {messages.map((message, index) => (
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
                    <span>{message.role === 'user' ? 'Вы' : message.kind === 'notice' && !message.clarification ? 'Статус обращения' : 'Ассистент'}</span>
                    <time dateTime={message.createdAt} className="text-ui-small">
                      {new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  {message.role === 'assistant' && Boolean(message.toolCalls?.length) && <ToolActivity message={message} />}
                  {message.role === 'assistant' ? (
                    !message.clarification && (
                      <>
                        <MarkdownMessage content={message.content} />
                        {Boolean(message.citations?.length) && (
                          <aside aria-label="Источники" className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            <p className="mb-2 font-medium">Источники</p>
                            <ul className="space-y-2">
                              {message.citations?.map((citation, citationIndex) => (
                                <li key={`${citation.path}:${citation.section}:${citationIndex}`} className="flex min-w-0 items-start gap-2 leading-5">
                                  <LuFileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                                  <button
                                    type="button"
                                    disabled={!pdfSourceUrl(citation.path)}
                                    onClick={() => setPdfSource({ chatId: chat.id, citation })}
                                    className="focus-visible:outline-primary min-w-0 rounded text-left break-words enabled:cursor-pointer enabled:hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
                                    aria-haspopup="dialog"
                                  >
                                    <span className={pdfSourceUrl(citation.path) ? 'underline decoration-current/30 underline-offset-4' : ''}>{citation.document.replace(/_/g, ' ').trim() || citation.path}</span>
                                    {citation.section.trim() && <span className="mt-0.5 block text-gray-500 dark:text-gray-400">{citation.section}</span>}
                                    {pdfSourceUrl(citation.path) && <span className="text-primary mt-0.5 block">Страница {citation.path.split('#page=')[1]}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </aside>
                        )}
                      </>
                    )
                  ) : (
                    <div className="text-ui-body bg-surface-2 rounded-2xl rounded-tr-md px-5 py-3 leading-7 break-words whitespace-pre-wrap">{message.content}</div>
                  )}
                  {message.role === 'assistant' && message.pending && !message.toolCalls?.some((call) => ['preparing', 'running', 'awaiting_user'].includes(toolStatus(call, true))) && (
                    <div role="status" className="text-foreground/50 text-ui-small mt-3 flex items-center gap-2">
                      <LuLoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                      {message.content ? 'Пишем ответ…' : 'Готовим ответ…'}
                    </div>
                  )}
                  {message.role === 'assistant' && message.clarification && (
                    <ClarificationCard
                      key={message.clarification.id}
                      request={message.clarification}
                      answered={index < lastUserIndex}
                      answer={messages.slice(index + 1).find((item) => item.role === 'user')?.content}
                      busy={busy}
                      closed={chat.status === 'closed'}
                      onAnswer={message.id === pendingClarificationId ? onAnswerClarification : undefined}
                    />
                  )}
                  {message.kind === 'handoff' && chat.handoff?.simulated && <p className="text-foreground/45 text-ui-small mt-2">Демонстрация: реальная заявка не отправлена, связь со специалистом не установлена.</p>}
                </article>
              ))}
            </div>
          )}
          {afterMessages}
          {busy && !streamingMessage && (
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
