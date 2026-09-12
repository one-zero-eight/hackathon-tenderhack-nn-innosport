import { $api } from '@/api'
import Button from '@/components/ui/Button'
import ChatTranscript from '@/components/chat/ChatTranscript'
import { chatFromDialogView, isDialogNotFound } from '@/features/chat/dialog-map'
import AdminDialogClassification from './AdminDialogClassification'
import AdminDialogSummary from './AdminDialogSummary'

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
        <>
          <AdminDialogSummary dialogId={dialogId} title={chat.title} updatedAt={chat.updatedAt} />
          <AdminDialogClassification dialogId={dialogId} updatedAt={chat.updatedAt} />
          {chat.messages.length > 0 ? <ChatTranscript chat={chat} /> : <p className="text-foreground/50 m-auto p-6 text-center">В обращении пока нет сообщений.</p>}
        </>
      ) : null}
    </section>
  )
}
