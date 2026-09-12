import { useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/api'
import type { SchemaAuditDialog } from '@/api/types'
import Button from '@/components/ui/Button'
import MarkdownMessage from '@/components/chat/MarkdownMessage'

const intervalDays: Record<string, number> = { day: 1, 'three-days': 3, week: 7, month: 30 }

function auditError(error: unknown): string {
  if (typeof error === 'string') return 'Сервер отклонил данные выборки: проверьте наличие переписки и сократите количество обращений.'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'detail' in error && typeof error.detail === 'string') return error.detail
  return 'Не удалось провести аудит. Проверьте доступность сервера и повторите попытку.'
}

export default function AdminAuditPanel() {
  const id = useId()
  const queryClient = useQueryClient()
  const audit = $api.useMutation('post', '/admin/audits', { retry: false })
  const email = $api.useMutation('post', '/admin/audits/email', { retry: false })
  const sendingEmail = useRef(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [selection, setSelection] = useState<'interval' | 'count'>('interval')
  const [interval, setInterval] = useState('day')
  const [count, setCount] = useState('30')
  const running = useRef(false)
  const [loadingDialogs, setLoadingDialogs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sampleLabel, setSampleLabel] = useState('')
  const busy = loadingDialogs || audit.isPending
  const validCount = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 100
  const result = audit.data
  const fieldClassName = 'border-border bg-background text-ui-body focus-visible:ring-primary w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2'

  async function sendEmail() {
    if (sendingEmail.current) return
    sendingEmail.current = true
    setEmailError(null)
    email.reset()
    try {
      await email.mutateAsync({})
    } catch (failure) {
      setEmailError(auditError(failure))
    } finally {
      sendingEmail.current = false
    }
  }

  async function runAudit() {
    if (running.current || (selection === 'count' && !validCount)) return
    running.current = true
    setError(null)
    audit.reset()
    setLoadingDialogs(true)
    try {
      const listOptions = $api.queryOptions('get', '/dialogs', { params: { query: { limit: 500 } } }, { staleTime: 0 })
      const dialogs = await queryClient.fetchQuery(listOptions)
      const rated = dialogs.filter((dialog) => dialog.feedback).sort((left, right) => Date.parse(right.feedback!.submitted_at) - Date.parse(left.feedback!.submitted_at))
      const cutoff = Date.now() - intervalDays[interval] * 24 * 60 * 60 * 1000
      const selected = selection === 'count'
        ? rated.slice(0, Number(count))
        : rated.filter((dialog) => Date.parse(dialog.feedback!.submitted_at) >= cutoff)
      if (selected.length === 0) throw new Error('В выбранной выборке нет обращений с оценками пользователей.')
      if (selected.length > 100) throw new Error('В выборке больше 100 оценённых обращений. Сократите интервал или выберите количество.')
      const sample: SchemaAuditDialog[] = []
      for (let offset = 0; offset < selected.length; offset += 5) {
        const batch = await Promise.all(selected.slice(offset, offset + 5).map(async (dialog) => {
          const viewOptions = $api.queryOptions('get', '/dialogs/{dialog_id}', { params: { path: { dialog_id: dialog.id } } }, { staleTime: 0 })
          const view = await queryClient.fetchQuery(viewOptions)
          if (!view.feedback) throw new Error('Оценка обращения изменилась. Запустите аудит повторно.')
          return {
            id: view.id,
            feedback: { rating: view.feedback.rating, comment: view.feedback.comment },
            messages: (view.messages ?? []).flatMap((message) => {
              if (message.role !== 'user' && message.role !== 'assistant') return []
              return [{ role: message.role, content: message.content }]
            }),
          } satisfies SchemaAuditDialog
        }))
        sample.push(...batch)
      }
      setSampleLabel(selection === 'count' ? `Последние оценённые обращения: ${sample.length} из запрошенных ${count}` : `Оценки за последние ${intervalDays[interval]} дн.`)
      await audit.mutateAsync({ body: { dialogs: sample } })
    } catch (failure) {
      setError(auditError(failure))
    } finally {
      running.current = false
      setLoadingDialogs(false)
    }
  }

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-1">
      <section aria-label="Результат аудита" aria-busy={busy} className="border-border bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
        {busy ? (
          <p role="status" className="text-foreground/60 text-ui-body m-auto p-6 text-center">{audit.isPending ? 'LLM анализирует переписку и причины оценок. Это может занять несколько минут…' : 'Загружаем обращения с оценками…'}</p>
        ) : error ? (
          <p role="alert" className="text-error text-ui-body m-auto p-6 text-center">{error}</p>
        ) : result ? (
          <>
            <header className="border-border shrink-0 space-y-2 border-b px-5 py-4">
              <h2 className="text-ui-title font-semibold">Результат аудита</h2>
              <p className="text-foreground/60 text-ui-small">{sampleLabel} · Проанализировано: {result.dialog_ids.length}</p>
              <p className="text-foreground/60 text-ui-small">Полный ответ: {result.ratings.complete} · Частичный: {result.ratings.partial} · Нерелевантный: {result.ratings.irrelevant}</p>
              <p className="text-foreground/45 text-ui-small">Сформирован: <time dateTime={result.generated_at}>{new Date(result.generated_at).toLocaleString('ru-RU')}</time></p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
              <div className="mx-auto max-w-3xl">
                <MarkdownMessage content={result.analysis} />
                <details className="text-foreground/60 text-ui-small mt-6">
                  <summary className="cursor-pointer">ID обращений в выборке</summary>
                  <ul className="mt-2 space-y-1">{result.dialog_ids.map((dialogId) => <li key={dialogId}>{dialogId}</li>)}</ul>
                </details>
              </div>
            </div>
          </>
        ) : (
          <p className="text-foreground/50 text-ui-body m-auto p-6 text-center">Выберите фильтры обращений и проведите аудит</p>
        )}
      </section>

      <aside aria-labelledby={`${id}-filters`} className="border-border bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
        <header className="border-border shrink-0 border-b px-5 py-4">
          <h2 id={`${id}-filters`} className="text-ui-title font-semibold">Фильтры обращений</h2>
        </header>
        <fieldset disabled={busy} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <p className="text-foreground/60 text-ui-small">Аудит учитывает только сохранённые на сервере оценки среди последних 500 обращений. Старые оценки, оставшиеся в браузере, не включаются. Максимум — 100 обращений за запуск.</p>
          <div className="space-y-2">
            <label htmlFor={`${id}-selection`} className="text-ui-body block font-medium">Выборка по</label>
            <select id={`${id}-selection`} value={selection} onChange={(event) => setSelection(event.target.value === 'count' ? 'count' : 'interval')} className={fieldClassName}>
              <option value="interval">Временному интервалу</option>
              <option value="count">Количеству обращений</option>
            </select>
          </div>
          {selection === 'interval' ? (
            <div className="space-y-2">
              <label htmlFor={`${id}-interval`} className="text-ui-body block font-medium">Интервал по дате оценки</label>
              <select id={`${id}-interval`} value={interval} onChange={(event) => setInterval(event.target.value)} className={fieldClassName}>
                <option value="day">День</option>
                <option value="three-days">3 дня</option>
                <option value="week">Неделя</option>
                <option value="month">30 дней</option>
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor={`${id}-count`} className="text-ui-body block font-medium">Количество обращений</label>
              <input id={`${id}-count`} type="number" min={1} max={100} step={1} required value={count} onChange={(event) => setCount(event.target.value)} aria-invalid={!validCount} className={fieldClassName} />
              {!validCount && <p className="text-error text-ui-small">Введите целое число от 1 до 100.</p>}
            </div>
          )}
          <p className="text-foreground/50 text-ui-small">LLM получит переписку, оценки и комментарии. Выводы модели требуют проверки и относятся только к выбранным обращениям.</p>
        </fieldset>
        <footer className="border-border shrink-0 space-y-3 border-t p-5">
          <Button variant="primary" className="w-full" disabled={busy || email.isPending || (selection === 'count' && !validCount)} onClick={() => void runAudit()}>{busy ? 'Аудит выполняется…' : 'Провести аудит'}</Button>
          <Button variant="outline" className="w-full" disabled={busy || email.isPending} onClick={() => void sendEmail()}>{email.isPending ? 'Формируем и отправляем…' : 'Отправить сейчас на почту'}</Button>
          <p className="text-foreground/50 text-ui-small">На почту из настроек сервера отправится новый аудит оценок за последние 24 часа, независимо от фильтров выше.</p>
          {email.isPending && <p role="status" className="text-foreground/60 text-ui-small">Готовим суточный отчёт. Это может занять несколько минут…</p>}
          {emailError && <p role="alert" className="text-error text-ui-small">{emailError}</p>}
          {email.isSuccess && <p role="status" className="text-foreground/70 text-ui-small">Отчёт передан почтовому серверу. Обращений: {email.data.dialog_count}. Время: {new Date(email.data.sent_at).toLocaleString('ru-RU')}.</p>}
        </footer>
      </aside>
    </div>
  )
}
