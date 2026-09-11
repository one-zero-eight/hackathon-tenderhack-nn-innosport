import type { ChatMessage } from '@/features/chat/types'

export default function ChatOutline({ messages, activeId, onNavigate }: { messages: ChatMessage[]; activeId: string; onNavigate: (id: string) => void }) {
  const questions = messages.filter((message) => message.role === 'user')
  return (
    <nav aria-label="Навигация по диалогу" className="h-full overflow-y-auto px-5 py-7">
      <h2 className="text-foreground/60 mb-1 text-xs font-semibold tracking-wider uppercase">По диалогу</h2>
      <p className="text-foreground/35 mb-7 text-xs">Ваши вопросы и уточнения</p>
      {!questions.length && <p className="text-foreground/40 text-sm leading-relaxed">Здесь появятся ваши вопросы</p>}
      <ol className="space-y-1">
        {questions.map((message, index) => (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => onNavigate(message.id)}
              aria-current={activeId === message.id ? 'location' : undefined}
              title={message.content}
              className={`focus-visible:ring-primary flex w-full cursor-pointer gap-3 border-l-2 px-3 py-3 text-left text-xs leading-relaxed transition-colors outline-none focus-visible:ring-2 ${activeId === message.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-foreground/45 hover:border-primary/40 hover:text-foreground'}`}
            >
              <span className="shrink-0 tabular-nums opacity-50">{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0">
                <span className="line-clamp-2 break-words">{message.content}</span>
                {message.clarificationId && <span className="mt-1 block text-[10px] opacity-60">Уточнение</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
