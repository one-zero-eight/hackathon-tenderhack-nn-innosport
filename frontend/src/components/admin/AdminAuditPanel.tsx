import { useId, useState } from 'react'
import Button from '@/components/ui/Button'
import MarkdownMessage from '@/components/chat/MarkdownMessage'

export default function AdminAuditPanel({ result }: { result?: string }) {
  const id = useId()
  const [selection, setSelection] = useState<'interval' | 'count'>('interval')
  const [interval, setInterval] = useState('day')
  const [count, setCount] = useState('30')
  const fieldClassName = 'border-border bg-background text-ui-body focus-visible:ring-primary w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2'

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-1">
      <section aria-label="Результат аудита" className="border-border bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
        {result ? (
          <>
            <header className="border-border shrink-0 border-b px-5 py-4">
              <h2 className="text-ui-title font-semibold">Результат аудита</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
              <div className="mx-auto max-w-3xl">
                <MarkdownMessage content={result} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-foreground/50 text-ui-body m-auto p-6 text-center">Выберите Фильтры обращений и проведите аудит</p>
        )}
      </section>

      <aside aria-labelledby={`${id}-filters`} className="border-border bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
        <header className="border-border shrink-0 border-b px-5 py-4">
          <h2 id={`${id}-filters`} className="text-ui-title font-semibold">Фильтры обращений</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="space-y-2">
            <label htmlFor={`${id}-selection`} className="text-ui-body block font-medium">Выборка по</label>
            <select id={`${id}-selection`} value={selection} onChange={(event) => setSelection(event.target.value === 'count' ? 'count' : 'interval')} className={fieldClassName}>
              <option value="interval">Временному интервалу</option>
              <option value="count">Количеству обращений</option>
            </select>
          </div>
          {selection === 'interval' ? (
            <div className="space-y-2">
              <label htmlFor={`${id}-interval`} className="text-ui-body block font-medium">Интервал</label>
              <select id={`${id}-interval`} value={interval} onChange={(event) => setInterval(event.target.value)} className={fieldClassName}>
                <option value="day">День</option>
                <option value="three-days">3 дня</option>
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor={`${id}-count`} className="text-ui-body block font-medium">Количество обращений</label>
              <input id={`${id}-count`} type="number" min={1} step={1} required value={count} onChange={(event) => setCount(event.target.value)} className={fieldClassName} />
            </div>
          )}
        </div>
        <footer className="border-border shrink-0 border-t p-5">
          <Button variant="primary" className="w-full" disabled>Провести аудит</Button>
        </footer>
      </aside>
    </div>
  )
}
