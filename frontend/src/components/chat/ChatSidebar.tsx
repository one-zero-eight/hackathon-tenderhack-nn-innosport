import { useId, useState } from 'react'
import { LuMessageSquare, LuPlus, LuSearch } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/input'
import type { Chat } from '@/features/chat/types'

function groupLabel(date: string) {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const value = new Date(date).toDateString()
  return value === today.toDateString() ? 'Сегодня' : value === yesterday.toDateString() ? 'Вчера' : 'Ранее'
}

export default function ChatSidebar({ chats, activeId, onSelect, onCreate }: { chats: Chat[]; activeId: string; onSelect: (id: string) => void; onCreate: () => void }) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  const filtered = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((chat) => chat.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
  return (
    <div className="bg-surface-2 flex h-full flex-col">
      <div className="space-y-6 px-4 pt-6 pb-4">
        <Button onClick={onCreate} variant="outline" className="bg-background flex w-full items-center justify-center gap-2 rounded-xl py-3">
          <LuPlus className="size-4" />
          Новое обращение
        </Button>
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Найти обращение
          </label>
          <LuSearch className="text-foreground/40 pointer-events-none absolute top-3 left-3 size-4" />
          <Input id={searchId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти обращение" className="border-transparent bg-transparent py-2.5 pl-9 text-sm" />
        </div>
      </div>
      <nav aria-label="Список обращений" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {['Сегодня', 'Вчера', 'Ранее'].map((group) => {
          const items = filtered.filter((chat) => groupLabel(chat.updatedAt) === group)
          return (
            items.length > 0 && (
              <section key={group}>
                <h2 className="text-foreground/45 mb-2 px-3 text-xs font-medium">{group}</h2>
                {items.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    aria-current={activeId === chat.id ? 'page' : undefined}
                    title={chat.title}
                    onClick={() => onSelect(chat.id)}
                    className={`focus-visible:ring-primary flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm outline-none focus-visible:ring-2 ${activeId === chat.id ? 'bg-background font-medium shadow-sm' : 'text-foreground/65 hover:bg-background/70'}`}
                  >
                    <LuMessageSquare className="text-foreground/40 size-4 shrink-0" />
                    <span className="truncate">{chat.title}</span>
                  </button>
                ))}
              </section>
            )
          )
        })}
        {!filtered.length && <p className="text-foreground/50 px-3 text-sm">Обращения не найдены</p>}
      </nav>
      <div className="border-border mx-4 border-t py-5">
        <p className="text-lg font-semibold tracking-tight">Техподдержка</p>
      </div>
    </div>
  )
}
