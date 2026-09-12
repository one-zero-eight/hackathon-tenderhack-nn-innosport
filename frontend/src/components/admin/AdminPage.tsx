import { Link, Outlet, useMatch } from '@tanstack/react-router'
import { LuCheck, LuClock3, LuMessageSquare } from 'react-icons/lu'
import { $api } from '@/api'
import Button from '@/components/ui/Button'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export default function AdminPage() {
  const auditActive = Boolean(useMatch({ from: '/admin/audit', shouldThrow: false }))
  const analyticsActive = Boolean(useMatch({ from: '/admin/analytics', shouldThrow: false }))
  const ticketsActive = !auditActive && !analyticsActive
  const listQuery = $api.useQuery('get', '/dialogs', { params: { query: { limit: 500 } } }, { enabled: ticketsActive })
  const dialogs = listQuery.data ?? []

  return (
    <main className="bg-background text-foreground h-dvh overflow-hidden p-4">
      <h1 className="sr-only">Админ-панель обращений</h1>
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
        <header className="border-border flex shrink-0 flex-wrap items-center justify-between gap-x-6 border-b">
          <nav aria-label="Разделы админки" className="flex gap-6">
            <Link
              to="/admin"
              activeOptions={{ exact: true }}
              aria-current={ticketsActive ? 'page' : undefined}
              className={`focus-visible:ring-primary -mb-px border-b-2 px-1 py-3 text-sm font-medium outline-none focus-visible:ring-2 ${ticketsActive ? 'border-primary text-primary' : 'text-foreground/60 hover:text-foreground border-transparent'}`}
            >
              Обращения
            </Link>
            <Link
              to="/admin/audit"
              activeProps={{ className: 'border-primary text-primary' }}
              inactiveProps={{ className: 'border-transparent text-foreground/60 hover:text-foreground' }}
              className="focus-visible:ring-primary -mb-px border-b-2 px-1 py-3 text-sm font-medium outline-none focus-visible:ring-2"
            >
              Аудит
            </Link>
            <Link
              to="/admin/analytics"
              activeProps={{ className: 'border-primary text-primary' }}
              inactiveProps={{ className: 'border-transparent text-foreground/60 hover:text-foreground' }}
              className="focus-visible:ring-primary -mb-px border-b-2 px-1 py-3 text-sm font-medium outline-none focus-visible:ring-2"
            >
              Аналитика
            </Link>
          </nav>
          <Link to="/" className="text-foreground/60 hover:text-foreground focus-visible:ring-primary text-ui-small rounded py-3 outline-none focus-visible:ring-2">
            На главную
          </Link>
        </header>
        <div className={!ticketsActive ? 'flex min-h-0 flex-1 flex-col' : 'grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] gap-4 md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1'}>
          {ticketsActive && (
            <aside aria-labelledby="admin-appeals-title" className="border-border bg-surface flex min-h-0 flex-col overflow-hidden rounded-2xl border">
              <header className="border-border shrink-0 border-b px-4 py-4">
                <h2 id="admin-appeals-title" className="text-ui-title font-semibold">
                  Список обращений
                </h2>
              </header>
              <nav aria-label="Обращения пользователей" className="min-h-0 flex-1 overflow-y-auto p-2">
                {listQuery.isPending && (
                  <p role="status" className="text-foreground/50 p-3">
                    Загружаем обращения…
                  </p>
                )}
                {listQuery.isError && (
                  <div role="alert" className="space-y-3 p-3">
                    <p className="text-error">Не удалось загрузить обращения.</p>
                    <Button variant="outline" size="sm" disabled={listQuery.isFetching} onClick={() => void listQuery.refetch()}>
                      Повторить
                    </Button>
                  </div>
                )}
                {listQuery.isSuccess && dialogs.length === 0 && <p className="text-foreground/50 p-3">Обращений пока нет.</p>}
                <ul className="space-y-1">
                  {dialogs.map((dialog) => (
                    <li key={dialog.id}>
                      <Link
                        to="/admin/tickets/$dialogId"
                        params={{ dialogId: dialog.id }}
                        activeOptions={{ exact: true }}
                        activeProps={{ className: 'border-primary/25 bg-primary/5' }}
                        inactiveProps={{ className: 'border-transparent hover:border-border hover:bg-surface-2' }}
                        className="focus-visible:ring-primary block w-full cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <LuMessageSquare className="text-foreground/40 size-4 shrink-0" />
                          <span className="truncate" title={dialog.title}>
                            {dialog.title}
                          </span>
                        </span>
                        <span className="text-foreground/65 text-ui-small mt-1 block truncate">{dialog.preview}</span>
                        <span className="text-foreground/45 text-ui-small mt-2 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1">
                            {dialog.closed ? <LuCheck className="size-3.5" /> : <LuClock3 className="size-3.5" />}
                            {dialog.closed ? 'Завершено' : 'Открыто'}
                          </span>
                          <time dateTime={dialog.updated_at}>{dateFormatter.format(new Date(dialog.updated_at))}</time>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {dialogs.length === 500 && <p className="text-foreground/50 text-ui-small p-3">Показаны последние 500 обращений.</p>}
              </nav>
            </aside>
          )}

          <Outlet />
        </div>
      </div>
    </main>
  )
}
