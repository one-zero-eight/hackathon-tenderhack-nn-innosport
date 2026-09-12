import { useId, useState, type ReactNode } from 'react'
import { LuChartNoAxesCombined, LuRefreshCw } from 'react-icons/lu'
import { $api } from '@/api'
import type { SchemaAnalyticsBucket, SchemaAnalyticsDay } from '@/api/types'
import Button from '@/components/ui/Button'

const number = new Intl.NumberFormat('ru-RU')
const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const percent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—')

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="border-border bg-surface min-w-0 rounded-2xl border p-5">
      <h3 id={id} className="text-ui-title font-semibold">
        {title}
      </h3>
      <p className="text-foreground/55 mt-1 text-sm">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Bars({ items, total, color = 'bg-primary' }: { items: SchemaAnalyticsBucket[]; total: number; color?: string }) {
  const max = Math.max(1, ...items.map((item) => item.count))
  if (!items.length) return <p className="text-foreground/50 py-6 text-sm">Пока нет данных для графика.</p>
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1.5 flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 wrap-break-word">{item.label}</span>
            <span className="shrink-0 tabular-nums">
              {number.format(item.count)} <span className="text-foreground/45">· {percent(item.count, total)}</span>
            </span>
          </div>
          <div aria-hidden="true" className="bg-surface-2 h-2.5 overflow-hidden rounded-full">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function DailyChart({ items }: { items: SchemaAnalyticsDay[] }) {
  const max = Math.max(1, ...items.map((item) => item.total))
  const stride = Math.max(1, Math.ceil(items.length / 8))
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-sky-500" />
          Без передачи специалисту
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-violet-500" />
          Передано специалисту
        </span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div style={{ minWidth: Math.max(400, items.length * 12) }}>
          <div className="relative h-48">
            {[0, 0.5, 1].map((fraction) => (
              <div key={fraction} aria-hidden="true" className="border-border pointer-events-none absolute right-0 left-0 border-t border-dashed" style={{ bottom: `${fraction * 100}%` }}>
                <span className="text-foreground/40 bg-surface absolute -top-2 left-0 pr-2 text-xs tabular-nums">{Math.round(max * fraction)}</span>
              </div>
            ))}
            <div className="relative ml-9 flex h-full items-end gap-1">
              {items.map((item) => (
                <div
                  key={item.date}
                  tabIndex={0}
                  aria-label={`${date.format(new Date(item.date))}: закрыто ${item.total}, передано специалисту ${item.escalated}`}
                  title={`${date.format(new Date(item.date))}: закрыто ${item.total}, передано специалисту ${item.escalated}`}
                  className="focus-visible:ring-primary group flex h-full min-w-0 flex-1 items-end rounded-t-sm outline-none focus-visible:ring-2"
                >
                  <div aria-hidden="true" className="flex w-full flex-col overflow-hidden rounded-t-sm group-hover:opacity-75" style={{ height: `${(item.total / max) * 100}%` }}>
                    <div className="bg-violet-500" style={{ height: `${item.total ? (item.escalated / item.total) * 100 : 0}%` }} />
                    <div className="flex-1 bg-sky-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden="true" className="text-foreground/45 mt-2 ml-9 flex gap-1 text-[10px]">
            {items.map((item, index) => (
              <span key={item.date} className="min-w-0 flex-1 whitespace-nowrap">
                {index % stride === 0 ? date.format(new Date(item.date)) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="text-foreground/60 mt-4 text-sm">
        <summary className="focus-visible:ring-primary w-fit cursor-pointer rounded outline-none focus-visible:ring-2">Данные по дням</summary>
        <ul className="mt-3 grid max-h-48 gap-x-6 gap-y-2 overflow-y-auto sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.date}>
              <time dateTime={item.date}>{date.format(new Date(item.date))}</time>: {item.total}, специалисту: {item.escalated}
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

export default function AdminAnalyticsPanel() {
  const [days, setDays] = useState(30)
  const query = $api.useQuery('get', '/dialogs/analytics', { params: { query: { days } } }, { refetchInterval: 30_000 })
  const data = query.data
  const escalated = data?.daily.reduce((sum, day) => sum + day.escalated, 0) ?? 0

  return (
    <section aria-labelledby="analytics-title" className="min-h-0 flex-1 overflow-y-auto pb-4">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="analytics-title" className="flex items-center gap-2 text-xl font-semibold">
            <LuChartNoAxesCombined aria-hidden="true" className="text-primary size-5" />
            Аналитика обращений
          </h2>
          <p className="text-foreground/55 mt-1 text-sm">Закрытые обращения за выбранный период. Дата закрытия и дни — в UTC.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-foreground/65 flex items-center gap-2 text-sm">
            Период
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="border-border bg-surface text-foreground focus-visible:ring-primary rounded-lg border px-3 py-2 outline-none focus-visible:ring-2">
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
              <option value={365}>Год</option>
            </select>
          </label>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Обновить аналитику" title="Обновить аналитику">
            <LuRefreshCw aria-hidden="true" className={`size-4 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          </Button>
        </div>
      </header>
      {query.isPending && (
        <p role="status" className="text-foreground/60 p-5">
          Загружаем аналитику…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="border-error/25 bg-error/5 mb-4 rounded-xl border p-4 text-sm">
          <p className="text-error">Не удалось обновить аналитику. {data ? 'Ниже показаны последние загруженные данные.' : 'Попробуйте ещё раз.'}</p>
          <Button variant="outline" size="sm" className="mt-3" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {data && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Закрыто обращений', value: number.format(data.total_closed), hint: `${number.format(data.analyzed)} с готовыми итогами` },
              { label: 'Передано специалисту', value: percent(escalated, data.total_closed), hint: `${number.format(escalated)} из ${number.format(data.total_closed)} закрытых` },
              { label: 'Ответ полностью помог', value: percent(data.complete_ratings, data.rated), hint: `${number.format(data.complete_ratings)} из ${number.format(data.rated)} оценённых` },
              { label: 'Остались вопросы', value: percent(data.with_remaining_questions, data.summarized), hint: `${number.format(data.with_remaining_questions)} из ${number.format(data.summarized)} с саммари · по оценке модели` },
            ].map((metric) => (
              <div key={metric.label} className="border-border bg-surface rounded-2xl border p-5">
                <p className="text-foreground/60 text-sm">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{metric.value}</p>
                <p className="text-foreground/45 mt-2 text-xs">{metric.hint}</p>
              </div>
            ))}
          </div>
          {data.pending > 0 && (
            <p role="status" className="border-primary/20 bg-primary/5 text-foreground/70 rounded-xl border px-4 py-3 text-sm">
              Для {number.format(data.pending)} обращений итоги ещё готовятся. Графики тем и оставшихся вопросов учитывают только готовые результаты. При недоступности модели обработка повторится автоматически.
            </p>
          )}
          {data.total_closed === 0 ? (
            <div className="border-border bg-surface rounded-2xl border p-10 text-center">
              <h3 className="font-semibold">За этот период нет закрытых обращений</h3>
              <p className="text-foreground/55 mt-2 text-sm">Графики появятся после закрытия обращений или выбора другого периода.</p>
            </div>
          ) : (
            <>
              <ChartCard title="Динамика закрытий" description="Количество закрытых обращений по дням и доля передач специалистам.">
                <DailyChart items={data.daily} />
              </ChartCard>
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <ChartCard title="Популярные темы" description={`Топ-10. Тема определена у ${number.format(data.classified)} из ${number.format(data.total_closed)} закрытых обращений. Проценты — от всех закрытых.`}>
                  <Bars items={data.topics} total={data.total_closed} />
                </ChartCard>
                <ChartCard title="Популярные подтемы" description="Топ-10 конкретных вопросов: какие инструкции стоит улучшить в первую очередь. Проценты — от всех закрытых.">
                  <Bars items={data.subtopics} total={data.total_closed} color="bg-violet-500" />
                </ChartCard>
                <ChartCard title="Чем завершились обращения" description="Закрытие и передача специалисту не означают, что вопрос решён.">
                  <Bars items={data.outcomes} total={data.total_closed} color="bg-amber-500" />
                </ChartCard>
                <ChartCard
                  title="Оценки пользователей"
                  description={`Оценено ${number.format(data.rated)} из ${number.format(data.total_closed)} закрытых обращений (${percent(data.rated, data.total_closed)}). Проценты — только от оценённых.`}
                >
                  <Bars items={data.ratings} total={data.rated} color="bg-teal-500" />
                </ChartCard>
              </div>
            </>
          )}
          <p className="text-foreground/40 text-xs">
            Обновлено: <time dateTime={data.generated_at}>{new Date(data.generated_at).toLocaleString('ru-RU')}</time>. Автообновление каждые 30 секунд. Для старых обращений без даты закрытия используется дата последнего изменения.
          </p>
        </div>
      )}
    </section>
  )
}
