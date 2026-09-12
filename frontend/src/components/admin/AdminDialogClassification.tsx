import { $api } from '@/api'
import Button from '@/components/ui/Button'

interface AdminDialogClassificationProps {
  dialogId: string
  updatedAt: string
}

export default function AdminDialogClassification({ dialogId, updatedAt }: AdminDialogClassificationProps) {
  const classification = $api.useQuery(
    'get',
    '/dialogs/{dialog_id}/classification',
    { params: { path: { dialog_id: dialogId } } },
    { retry: false, refetchOnWindowFocus: false, refetchOnMount: 'always' },
  )
  const result = classification.data
  const stale = result && (result.dialog_updated_at === null || Date.parse(result.dialog_updated_at) < Date.parse(updatedAt))
  const error = classification.error
  const errorMessage = error && 'detail' in error && typeof error.detail === 'string'
    ? error.detail
    : 'Не удалось определить тему обращения.'

  return (
    <section aria-label="Классификация обращения" aria-busy={classification.isFetching} className="border-border border-b px-5 py-4">
      {classification.isFetching ? (
        <p role="status" className="text-foreground/60 text-ui-small">Определяем тему и подтему…</p>
      ) : classification.isError || stale ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role={classification.isError ? 'alert' : 'status'} className="text-foreground/60 text-ui-small">
            {classification.isError ? errorMessage : 'Обращение изменилось. Обновите классификацию.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void classification.refetch()}>
            {classification.isError ? 'Повторить' : 'Обновить'}
          </Button>
        </div>
      ) : result ? (
        <div className="space-y-3">
          <dl className="text-ui-small space-y-4">
            <div className="min-w-0 space-y-2">
              <dt className="text-foreground/50">Тема</dt>
              <dd className="wrap-break-word font-medium">{result.topic ?? 'Не определена'}</dd>
            </div>
            <div className="min-w-0 space-y-2">
              <dt className="text-foreground/50">Подтема</dt>
              <dd className="wrap-break-word font-medium">{result.subtopic ?? 'Не определена'}</dd>
            </div>
          </dl>
          <p className="text-foreground/60 text-ui-small wrap-break-word">{result.reason}</p>
        </div>
      ) : null}
    </section>
  )
}
