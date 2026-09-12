import { useId, useState } from 'react'
import type { ChatMessage } from '@/features/chat/types'

export default function ChatOutline({ messages, activeId, onNavigate }: { messages: ChatMessage[]; activeId: string; onNavigate: (id: string) => void }) {
  const [preview, setPreview] = useState<{ id: string; top: number; right: number } | null>(null)
  const tooltipId = useId()
  const questions = messages.flatMap((message, index) => {
    if (message.role !== 'user') return []
    const response = messages.slice(index + 1).find((item) => item.role === 'assistant')
    return [{ message, response }]
  })
  const visibleQuestion = questions.find(({ message }) => message.id === preview?.id)

  function showPreview(id: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    // Reserve the tooltip's maximum height plus a 16px viewport margin.
    setPreview({
      id,
      top: Math.max(16, Math.min(rect.top + rect.height / 2 - 64, window.innerHeight - 144)),
      right: window.innerWidth - rect.left + 12,
    })
  }

  if (!questions.length) return null

  return (
    <nav
      aria-label="Навигация по обращению"
      className="absolute top-24 right-4 z-20"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setPreview(null)
      }}
    >
      <ol className="flex max-h-[calc(100dvh-12rem)] flex-col items-end overflow-y-auto" onScroll={() => setPreview(null)}>
        {questions.map(({ message }, index) => {
          const active = activeId === message.id
          return (
            <li key={message.id} className="group/item flex h-4 w-10 shrink-0 items-center justify-end">
              <button
                type="button"
                onMouseEnter={(event) => showPreview(message.id, event.currentTarget)}
                onMouseLeave={() => setPreview(null)}
                onFocus={(event) => showPreview(message.id, event.currentTarget)}
                onBlur={() => setPreview(null)}
                onClick={() => {
                  setPreview(null)
                  onNavigate(message.id)
                }}
                aria-label={`Перейти к вопросу ${index + 1}: ${message.content}`}
                aria-describedby={visibleQuestion?.message.id === message.id ? tooltipId : undefined}
                aria-current={active ? 'location' : undefined}
                className="focus-visible:ring-primary flex h-full w-full cursor-pointer items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
              >
                <span
                  className={`block h-0.5 rounded-full transition-[width,background-color] duration-150 ${
                    active ? 'bg-foreground w-7' : 'bg-foreground/35 group-hover/item:bg-foreground/65 group-focus-within/item:bg-foreground/65 w-3 group-focus-within/item:w-5 group-hover/item:w-5'
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ol>
      {visibleQuestion && preview && (
        <div
          id={tooltipId}
          role="tooltip"
          style={{ top: preview.top, right: preview.right }}
          className="border-border bg-surface-2 pointer-events-none fixed max-h-[min(8rem,calc(100dvh-2rem))] w-80 max-w-[calc(100vw-6rem)] overflow-hidden rounded-xl border px-4 py-3 text-left shadow-xl"
        >
          <p className="text-ui-body truncate font-medium">{visibleQuestion.message.content}</p>
          {visibleQuestion.response && <p className="text-foreground/45 text-ui-small mt-1 line-clamp-2">{visibleQuestion.response.content}</p>}
        </div>
      )}
    </nav>
  )
}
