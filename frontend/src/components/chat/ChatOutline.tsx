import type { ChatMessage } from '@/features/chat/types'

export default function ChatOutline({ messages, activeId, onNavigate }: { messages: ChatMessage[]; activeId: string; onNavigate: (id: string) => void }) {
  const questions = messages.flatMap((message, index) => {
    if (message.role !== 'user') return []
    const response = messages.slice(index + 1).find((item) => item.role === 'assistant')
    return [{ message, response }]
  })

  if (!questions.length) return null

  return (
    <nav aria-label="Навигация по обращению" className="absolute top-5 right-4 z-20">
      <ol className="flex flex-col items-end">
        {questions.map(({ message, response }, index) => {
          const active = activeId === message.id
          return (
            <li key={message.id} className="group/item relative flex h-4 w-10 items-center justify-end">
              <div
                role="tooltip"
                className="border-border bg-surface-2 pointer-events-none invisible absolute top-1/2 right-full mr-3 w-80 max-w-[calc(100vw-5rem)] -translate-y-1/2 rounded-xl border px-4 py-3 text-left opacity-0 shadow-xl transition-[opacity,transform,visibility] duration-150 group-hover/item:visible group-hover/item:-translate-x-1 group-hover/item:opacity-100 group-focus-within/item:visible group-focus-within/item:-translate-x-1 group-focus-within/item:opacity-100"
              >
                <p className="truncate text-sm font-medium">{message.content}</p>
                {response && <p className="text-foreground/45 mt-1 line-clamp-2 text-xs leading-5">{response.content}</p>}
              </div>
              <button
                type="button"
                onClick={() => onNavigate(message.id)}
                aria-label={`Перейти к вопросу ${index + 1}: ${message.content}`}
                aria-current={active ? 'location' : undefined}
                className="focus-visible:ring-primary flex h-full w-full cursor-pointer items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                <span
                  className={`block h-0.5 rounded-full transition-[width,background-color] duration-150 ${
                    active ? 'bg-foreground w-7' : 'bg-foreground/35 w-3 group-hover/item:w-5 group-hover/item:bg-foreground/65 group-focus-within/item:w-5 group-focus-within/item:bg-foreground/65'
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
