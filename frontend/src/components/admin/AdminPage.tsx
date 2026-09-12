import { useState } from 'react'
import { LuCheck, LuClock3, LuMessageSquare } from 'react-icons/lu'
import { $api } from '@/api'
import Button from '@/components/ui/Button'
import ChatTranscript from '@/components/chat/ChatTranscript'
import { chatFromDialogView } from '@/features/chat/dialog-map'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export default function AdminPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listQuery = $api.useQuery('get', '/dialogs', { params: { query: { limit: 500 } } })
  const dialogs = listQuery.data ?? []
  const selectedDialog = dialogs.find((dialog) => dialog.id === selectedId) ?? dialogs[0]
  const dialogQuery = $api.useQuery(
    'get',
    '/dialogs/{dialog_id}',
    { params: { path: { dialog_id: selectedDialog?.id ?? '' } } },
    { enabled: Boolean(selectedDialog) },
  )
  const chat = selectedDialog && dialogQuery.data?.id === selectedDialog.id ? chatFromDialogView(dialogQuery.data) : null

  return (
    <main className="bg-background text-foreground min-h-dvh p-4">
      <h1 className="sr-only">Админ-панель обращений</h1>
      <div className="mx-auto grid max-w-[1600px] gap-4 xl:h-[calc(100dvh-2rem)] xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-labelledby="admin-appeals-title" className="border-border bg-surface flex min-h-0 flex-col overflow-hidden rounded-2xl border">
          <header className="border-border border-b px-4 py-4">
            <h2 id="admin-appeals-title" className="text-ui-title font-semibold">
              Список обращений
            </h2>
          </header>
          <nav aria-label="Обращения пользователей" className="max-h-80 min-h-0 overflow-y-auto p-2 xl:max-h-none xl:flex-1">
            {listQuery.isPending && <p role="status" className="text-foreground/50 p-3">Загружаем обращения…</p>}
            {listQuery.isError && (
              <div role="alert" className="space-y-3 p-3">
                <p className="text-error">Не удалось загрузить обращения.</p>
                <Button variant="outline" size="sm" disabled={listQuery.isFetching} onClick={() => void listQuery.refetch()}>Повторить</Button>
              </div>
            )}
            {listQuery.isSuccess && dialogs.length === 0 && <p className="text-foreground/50 p-3">Обращений пока нет.</p>}
            <ul className="space-y-1">
              {dialogs.map((dialog) => {
                const active = dialog.id === selectedDialog?.id
                return (
                  <li key={dialog.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(dialog.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`focus-visible:ring-primary w-full cursor-pointer rounded-xl border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 ${active ? 'border-primary/25 bg-primary/5' : 'border-transparent hover:border-border hover:bg-surface-2'}`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <LuMessageSquare className="text-foreground/40 size-4 shrink-0" />
                        <span className="truncate" title={dialog.title}>{dialog.title}</span>
                      </span>
                      <span className="text-foreground/65 text-ui-small mt-1 block truncate">{dialog.preview}</span>
                      <span className="text-foreground/45 text-ui-small mt-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1">
                          {dialog.closed ? <LuCheck className="size-3.5" /> : <LuClock3 className="size-3.5" />}
                          {dialog.closed ? 'Завершено' : 'Открыто'}
                        </span>
                        <time dateTime={dialog.updated_at}>{dateFormatter.format(new Date(dialog.updated_at))}</time>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {dialogs.length === 500 && <p className="text-foreground/50 text-ui-small p-3">Показаны последние 500 обращений.</p>}
          </nav>
        </aside>

        <section aria-label="История обращения" className="border-border bg-surface relative flex h-[70dvh] min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-2xl border xl:h-auto xl:min-h-0">
          {!selectedDialog ? (
            <p className="text-foreground/50 m-auto p-6 text-center">Выберите обращение для просмотра истории.</p>
          ) : dialogQuery.isPending ? (
            <p role="status" className="text-foreground/50 m-auto p-6 text-center">Загружаем историю…</p>
          ) : dialogQuery.isError ? (
            <div role="alert" className="m-auto space-y-3 p-6 text-center">
              <p className="text-error">Не удалось загрузить историю обращения.</p>
              <Button variant="outline" size="sm" disabled={dialogQuery.isFetching} onClick={() => void dialogQuery.refetch()}>Повторить</Button>
            </div>
          ) : chat && chat.messages.length > 0 ? (
            <ChatTranscript key={chat.id} chat={chat} />
          ) : (
            <p className="text-foreground/50 m-auto p-6 text-center">В обращении пока нет сообщений.</p>
          )}
        </section>

      </div>
    </main>
  )
}
