import { useId, useState } from 'react'
import { LuMessageSquare, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
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

export default function ChatSidebar({
  chats,
  activeId,
  loading = false,
  error = null,
  onSelect,
  onCreate,
  onDelete,
  onDeleteAll,
  busy = false,
}: {
  chats: Chat[]
  activeId: string
  loading?: boolean
  error?: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onDeleteAll: () => void
  busy?: boolean
}) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  const filtered = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((chat) => chat.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
  const canDeleteAll = chats.length > 1 || chats.some((chat) => chat.messages.length > 0)
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
          <Input id={searchId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти обращение" className="border-transparent bg-transparent py-2.5 pl-9" />
        </div>
      </div>
      <nav aria-label="Список обращений" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {['Сегодня', 'Вчера', 'Ранее'].map((group) => {
          const items = filtered.filter((chat) => groupLabel(chat.updatedAt) === group)
          return (
            items.length > 0 && (
              <section key={group}>
                <h2 className="text-foreground/45 text-ui-small mb-2 px-3 font-medium">{group}</h2>
                {items.map((chat) => (
                  <div
                    key={chat.id}
                    className={`flex w-full items-center rounded-xl ${activeId === chat.id ? 'bg-background font-medium shadow-sm' : 'text-foreground/65 hover:bg-background/70'}`}
                  >
                    <button
                      type="button"
                      aria-current={activeId === chat.id ? 'page' : undefined}
                      title={chat.title}
                      onClick={() => onSelect(chat.id)}
                      className="focus-visible:ring-primary text-ui-body flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left outline-none focus-visible:ring-2"
                    >
                      <LuMessageSquare className="text-foreground/40 size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{chat.title}</span>
                        {chat.status === 'closed' ? (
                          <span className="text-foreground/45 text-ui-small mt-1 block">Завершено</span>
                        ) : chat.preview ? (
                          <span className="text-foreground/45 text-ui-small mt-1 block truncate">{chat.preview}</span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить обращение «${chat.title}»`}
                      disabled={busy}
                      onClick={() => onDelete(chat.id)}
                      className="text-foreground/40 hover:text-error focus-visible:ring-primary mr-1 shrink-0 rounded-lg p-2 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <LuTrash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </section>
            )
          )
        })}
        {loading && !filtered.length && <p className="text-foreground/50 text-ui-body px-3">Загружаем обращения…</p>}
        {error && <p className="text-error text-ui-body px-3">{error}</p>}
        {!loading && !filtered.length && <p className="text-foreground/50 text-ui-body px-3">Обращения не найдены</p>}
      </nav>
      <div className="border-border mx-4 space-y-4 border-t py-5">
        <Button variant="ghost" color="error" size="sm" className="flex w-full items-center justify-center gap-2" disabled={busy || !canDeleteAll} onClick={onDeleteAll}>
          <LuTrash2 className="size-4" />
          Удалить все обращения
        </Button>
        <p className="text-ui-title font-semibold tracking-tight">Техподдержка</p>
      </div>
    </div>
  )
}
