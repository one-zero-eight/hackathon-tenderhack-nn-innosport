import { useState } from 'react'
import { LuCheck, LuClock3, LuMessageSquare } from 'react-icons/lu'
import ChatTranscript from '@/components/chat/ChatTranscript'
import { adminAppeals } from '@/features/admin/fixtures'
import AdminFeedbackPanel from './AdminFeedbackPanel'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export default function AdminPage() {
  const [selectedId, setSelectedId] = useState(adminAppeals[0].chat.id)
  const selectedAppeal = adminAppeals.find((appeal) => appeal.chat.id === selectedId) ?? adminAppeals[0]

  return (
    <main className="bg-background text-foreground min-h-dvh p-4">
      <h1 className="sr-only">Админ-панель обращений</h1>
      <div className="mx-auto grid max-w-[1600px] gap-4 xl:h-[calc(100dvh-2rem)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <aside aria-labelledby="admin-appeals-title" className="border-border bg-surface flex min-h-0 flex-col overflow-hidden rounded-2xl border">
          <header className="border-border border-b px-4 py-4">
            <h2 id="admin-appeals-title" className="text-ui-title font-semibold">
              Список обращений
            </h2>
          </header>
          <nav aria-label="Обращения пользователей" className="max-h-80 min-h-0 overflow-y-auto p-2 xl:max-h-none xl:flex-1">
            <ul className="space-y-1">
              {adminAppeals.map((appeal) => {
                const active = appeal.chat.id === selectedAppeal.chat.id
                return (
                  <li key={appeal.chat.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(appeal.chat.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`focus-visible:ring-primary w-full cursor-pointer rounded-xl border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 ${active ? 'border-primary/25 bg-primary/5' : 'border-transparent hover:border-border hover:bg-surface-2'}`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <LuMessageSquare className="text-foreground/40 size-4 shrink-0" />
                        <span className="truncate">{appeal.userId}</span>
                      </span>
                      <span className="text-foreground/65 text-ui-small mt-1 block truncate">{appeal.chat.title}</span>
                      <span className="text-foreground/45 text-ui-small mt-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1">
                          {appeal.chat.status === 'closed' ? <LuCheck className="size-3.5" /> : <LuClock3 className="size-3.5" />}
                          {appeal.chat.status === 'closed' ? 'Завершено' : 'Открыто'}
                        </span>
                        <time dateTime={appeal.chat.updatedAt}>{dateFormatter.format(new Date(appeal.chat.updatedAt))}</time>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        </aside>

        <section aria-label="История обращения" className="border-border bg-surface relative flex h-[70dvh] min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-2xl border xl:h-auto xl:min-h-0">
          <ChatTranscript key={selectedAppeal.chat.id} chat={selectedAppeal.chat} />
        </section>

        <AdminFeedbackPanel appeal={selectedAppeal} />
      </div>
    </main>
  )
}
