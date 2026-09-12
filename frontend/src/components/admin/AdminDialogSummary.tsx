import { useId } from 'react'
import { LuRefreshCw } from 'react-icons/lu'
import { $api } from '@/api'

interface AdminDialogSummaryProps {
  dialogId: string
  updatedAt: string
}

export default function AdminDialogSummary({ dialogId, updatedAt }: AdminDialogSummaryProps) {
  const id = useId()
  const summary = $api.useQuery(
    'get',
    '/dialogs/{dialog_id}/summary',
    { params: { path: { dialog_id: dialogId } } },
    { retry: false, refetchOnWindowFocus: false, refetchOnMount: 'always' },
  )
  const result = summary.data
  const stale = result && (result.dialog_updated_at === null || Date.parse(result.dialog_updated_at) < Date.parse(updatedAt))
  const buttonLabel = summary.isFetching ? 'Загружаем саммари…' : summary.isError ? 'Повторить' : 'Обновить саммари'

  return (
    <div className="px-5 py-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-ui-body font-semibold">Саммари</h3>
        <button
          type="button"
          disabled={summary.isFetching}
          aria-label={buttonLabel}
          title={buttonLabel}
          aria-controls={id}
          onClick={() => void summary.refetch()}
          className="text-foreground/45 hover:text-foreground hover:bg-surface-2 focus-visible:ring-primary flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-50"
        >
          <LuRefreshCw aria-hidden="true" className={`size-4 ${summary.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        </button>
      </header>
      <section id={id} aria-label="Саммари обращения" aria-busy={summary.isFetching} className="mt-4">
        {summary.isFetching ? (
          <p role="status" className="text-foreground/60 text-ui-body">Формируем саммари обращения…</p>
        ) : summary.isError ? (
          <p role="alert" className="text-error text-ui-body">Не удалось загрузить саммари. Нажмите «Повторить».</p>
        ) : stale ? (
          <p role="status" className="text-foreground/60 text-ui-body">Обращение изменилось. Нажмите «Обновить саммари», чтобы получить актуальный результат.</p>
        ) : result ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-ui-body font-semibold">Что хотел пользователь</h3>
              <p className="text-foreground/80 text-ui-body mt-1 wrap-break-word whitespace-pre-wrap">{result.user_request}</p>
            </div>
            <div>
              <h3 className="text-ui-body font-semibold">Что осталось ответить</h3>
              {result.remaining_questions.length > 0 ? (
                <ul className="text-foreground/80 text-ui-body mt-1 list-disc space-y-1 pl-5">
                  {result.remaining_questions.map((question, index) => <li key={index} className="wrap-break-word whitespace-pre-wrap">{question}</li>)}
                </ul>
              ) : (
                <p className="text-foreground/60 text-ui-body mt-1">Неотвеченных вопросов не выявлено.</p>
              )}
            </div>
            <p className="text-foreground/45 text-ui-small">Сформировано: <time dateTime={result.generated_at}>{new Date(result.generated_at).toLocaleString('ru-RU')}</time></p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
