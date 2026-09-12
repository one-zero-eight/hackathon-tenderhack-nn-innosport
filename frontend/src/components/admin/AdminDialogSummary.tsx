import { useId } from 'react'
import { $api } from '@/api'
import Button from '@/components/ui/Button'

interface AdminDialogSummaryProps {
  dialogId: string
  title: string
  updatedAt: string
}

export default function AdminDialogSummary({ dialogId, title, updatedAt }: AdminDialogSummaryProps) {
  const id = useId()
  const summary = $api.useMutation('get', '/dialogs/{dialog_id}/summary', { retry: false })
  const result = summary.data
  const stale = result && (result.dialog_updated_at === null || Date.parse(result.dialog_updated_at) < Date.parse(updatedAt))
  const visible = summary.isPending || summary.isError || Boolean(result)

  function loadSummary() {
    if (summary.isPending) return
    summary.mutate({ params: { path: { dialog_id: dialogId } } })
  }

  return (
    <div className="border-border flex max-h-[45%] shrink-0 flex-col border-b">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-ui-title min-w-0 flex-1 truncate font-semibold" title={title}>{title}</h2>
        <Button variant="outline" size="sm" disabled={summary.isPending} aria-controls={visible ? id : undefined} onClick={loadSummary}>
          {summary.isPending ? 'Загружаем саммари…' : summary.isError ? 'Повторить' : result ? 'Обновить саммари' : 'Показать саммари'}
        </Button>
      </header>
      {visible && (
        <section id={id} aria-label="Саммари обращения" aria-busy={summary.isPending} className="min-h-0 overflow-y-auto px-5 pb-4">
          {summary.isPending ? (
            <p role="status" className="text-foreground/60 text-ui-body">Формируем саммари обращения…</p>
          ) : summary.isError ? (
            <p role="alert" className="text-error text-ui-body">Не удалось загрузить саммари. Нажмите «Повторить».</p>
          ) : stale ? (
            <p role="status" className="text-foreground/60 text-ui-body">Обращение изменилось. Нажмите «Обновить саммари», чтобы получить актуальный результат.</p>
          ) : result ? (
            <div className="bg-surface-2 space-y-4 rounded-xl p-4">
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
      )}
    </div>
  )
}
