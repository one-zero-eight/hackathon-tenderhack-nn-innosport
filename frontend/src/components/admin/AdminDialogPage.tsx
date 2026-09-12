import { $api } from '@/api'
import Button from '@/components/ui/Button'
import ChatTranscript from '@/components/chat/ChatTranscript'
import { chatFromDialogView, isDialogNotFound } from '@/features/chat/dialog-map'
import AdminDialogClassification from './AdminDialogClassification'
import AdminDialogSummary from './AdminDialogSummary'
import type { FeedbackRating } from '@/features/chat/types'

const feedbackLabels: Record<FeedbackRating, string> = {
  complete: 'Полный ответ',
  partial: 'Неполный ответ',
  irrelevant: 'Ответ не по теме',
}

interface AdminDialogPageProps {
  dialogId: string
}

export default function AdminDialogPage({ dialogId }: AdminDialogPageProps) {
  const dialogQuery = $api.useQuery('get', '/dialogs/{dialog_id}', { params: { path: { dialog_id: dialogId } } }, { retry: false })
  const dialogView = dialogQuery.data?.id === dialogId ? dialogQuery.data : null
  const chat = dialogView ? chatFromDialogView(dialogView) : null
  const notFound = dialogQuery.isError && isDialogNotFound(dialogQuery.error)

  return (
    <section key={dialogId} aria-label="История обращения" className="border-border bg-surface relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
      {dialogQuery.isPending ? (
        <p role="status" className="text-foreground/50 m-auto p-6 text-center">
          Загружаем историю…
        </p>
      ) : dialogQuery.isError ? (
        <div role="alert" className="m-auto space-y-3 p-6 text-center">
          <p className="text-error">{notFound ? 'Обращение не найдено.' : 'Не удалось загрузить историю обращения.'}</p>
          {notFound ? (
            <p className="text-foreground/50">Проверьте ссылку или выберите другое обращение в списке.</p>
          ) : (
            <Button variant="outline" size="sm" disabled={dialogQuery.isFetching} onClick={() => void dialogQuery.refetch()}>
              Повторить
            </Button>
          )}
        </div>
      ) : chat ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1">
          <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
            <header className="border-border shrink-0 border-b px-5 py-4">
              <h2 className="text-ui-title truncate font-semibold" title={chat.title}>{chat.title}</h2>
            </header>
            {chat.messages.length > 0 ? <ChatTranscript chat={chat} /> : <p className="text-foreground/50 m-auto p-6 text-center">В обращении пока нет сообщений.</p>}
          </div>
          <aside aria-label="Информация об обращении" className="border-border min-h-0 min-w-0 overflow-y-auto overscroll-contain border-t lg:border-t-0 lg:border-l">
            <div className="border-border border-b px-5 py-4">
              <dl className="text-ui-small space-y-2">
                <dt className="text-foreground/50">Статус</dt>
                <dd>
                  <span className={`inline-flex rounded-full px-2.5 py-1 font-medium ${chat.status === 'closed' ? 'bg-surface-2 text-foreground/70' : 'bg-primary/10 text-primary'}`}>
                    {chat.status === 'closed' ? 'Завершено' : 'Открыто'}
                  </span>
                  {chat.handoff && <p className="text-foreground/60 mt-2">Передано специалисту{chat.handoff.line ? ` · ${chat.handoff.line}` : ''}</p>}
                </dd>
              </dl>
            </div>
            <AdminDialogClassification dialogId={dialogId} updatedAt={chat.updatedAt} />
            <section aria-label="Оценка пользователя" className="border-border border-b px-5 py-4">
              <h3 className="text-foreground/50 text-ui-small">Оценка пользователя</h3>
              <p className="text-ui-small mt-2 font-medium">{chat.feedback ? feedbackLabels[chat.feedback.rating] : 'Пока нет оценки'}</p>
              {chat.feedback?.comment && <p className="text-foreground/70 text-ui-small mt-2 wrap-break-word whitespace-pre-wrap">{chat.feedback.comment}</p>}
            </section>
            <AdminDialogSummary dialogId={dialogId} updatedAt={chat.updatedAt} />
          </aside>
        </div>
      ) : null}
    </section>
  )
}
