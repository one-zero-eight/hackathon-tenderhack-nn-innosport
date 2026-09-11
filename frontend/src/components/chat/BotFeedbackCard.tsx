import { useId, useState } from 'react'
import { LuCheck, LuMessageSquareHeart } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { Chat } from '@/features/chat/types'

type Rating = 'complete' | 'partial' | 'irrelevant'
const ratings: { value: Rating; label: string }[] = [
  { value: 'complete', label: 'Ответил полностью' },
  { value: 'partial', label: 'Неполный ответ' },
  { value: 'irrelevant', label: 'Ответ нерелевантен' },
]

export default function BotFeedbackCard({
  feedback,
  waitingForSpecialist,
  busy,
  onSubmit,
  onDismiss,
}: {
  feedback: Chat['feedback']
  waitingForSpecialist: boolean
  busy: boolean
  onSubmit: (rating: Rating, comment: string) => boolean
  onDismiss: () => void
}) {
  const [rating, setRating] = useState<Rating | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(false)
  const id = useId()
  if (feedback)
    return (
      <section aria-label="Оценка работы бота" className="border-border bg-surface-2 mt-6 space-y-2 rounded-2xl border p-5">
        <p className="text-ui-body flex items-center gap-2 font-medium">
          <LuCheck className="text-success size-4" />
          Спасибо за обратную связь!
        </p>
        <p className="text-foreground/60 text-ui-body">Ваша оценка: {ratings.find((item) => item.value === feedback.rating)?.label}</p>
        {feedback.comment && <p className="text-foreground/50 text-ui-body break-words whitespace-pre-wrap">{feedback.comment}</p>}
      </section>
    )
  return (
    <section aria-labelledby={`${id}-title`} className="border-border bg-surface mt-6 rounded-2xl border p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <LuMessageSquareHeart className="text-primary mt-1 size-5 shrink-0" />
        <div>
          <h3 id={`${id}-title`} className="text-ui-title font-semibold">
            {waitingForSpecialist ? 'Пока вы ожидаете ответа специалиста, пожалуйста, оцените работу нашего бота' : 'Пожалуйста, оцените работу нашего бота'}
          </h3>
          <p className="text-foreground/50 text-ui-body mt-1">Это помогает нам сделать наш сервис лучше</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (rating && !busy) setError(!onSubmit(rating, rating === 'complete' ? '' : comment.trim()))
        }}
      >
        <fieldset disabled={busy}>
          <legend className="text-ui-body mb-3 font-medium">Оцените ответ</legend>
          <div className="flex flex-wrap gap-2">
            {ratings.map((item) => (
              <label
                key={item.value}
                className={`has-focus-visible:ring-primary text-ui-body flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 has-focus-visible:ring-2 ${rating === item.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-surface-2'}`}
              >
                <input
                  type="radio"
                  name={`${id}-rating`}
                  value={item.value}
                  checked={rating === item.value}
                  onChange={() => {
                    setRating(item.value)
                    setError(false)
                    if (item.value === 'complete') setComment('')
                  }}
                  className="accent-primary size-4"
                />
                {item.label}
              </label>
            ))}
          </div>
          {rating && rating !== 'complete' && (
            <div className="mt-4 space-y-2">
              <label htmlFor={`${id}-reason`} className="text-ui-body block font-medium">
                Почему ответ не подошёл?
              </label>
              <Textarea id={`${id}-reason`} value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={4000} placeholder="Расскажите, чего не хватило или что было не так…" aria-describedby={`${id}-optional`} />
              <p id={`${id}-optional`} className="text-foreground/40 text-ui-small">
                Необязательно
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-error text-ui-body mt-3">
              Не удалось сохранить оценку. Попробуйте ещё раз.
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
              Не сейчас
            </Button>
            <Button type="submit" size="sm" disabled={!rating || busy}>
              Отправить оценку
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
