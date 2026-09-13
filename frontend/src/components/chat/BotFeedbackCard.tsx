import { useId, useState } from 'react'
import { LuCheck, LuMessageSquareHeart, LuStar } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { Chat, FeedbackRating } from '@/features/chat/types'

const COMMENT_MAX = 2000

const STAR_COUNTS = [1, 2, 3, 4, 5] as const
type StarCount = (typeof STAR_COUNTS)[number]

const BADGES: Record<StarCount, string[]> = {
  1: ['Медленный ответ', 'Ответ не по теме', 'Бот не сработал', 'Непонятный ответ', 'Не помог решить вопрос'],
  2: ['Медленный ответ', 'Ответ почти не помог', 'Путаница в шагах', 'Мало деталей'],
  3: ['Медленный ответ', 'Ответил не полностью', 'Не хватило примера', 'Пришлось уточнять'],
  4: ['Полезный ответ', 'Почти всё понятно', 'Можно чуть быстрее', 'Небольшая неточность'],
  5: ['Всё отлично', 'Быстрый ответ', 'Полный и точный ответ', 'Понятные шаги'],
}

const ratingLabels: Record<FeedbackRating, string> = {
  complete: 'Ответил полностью',
  partial: 'Неполный ответ',
  irrelevant: 'Ответ не по теме',
}

function ratingFromStars(stars: StarCount): FeedbackRating {
  if (stars <= 2) return 'irrelevant'
  if (stars === 3) return 'partial'
  return 'complete'
}

function formatFeedbackComment(stars: StarCount, badges: string[], note: string): string {
  const head = `${stars} из 5`
  const structured = badges.length > 0 ? `${head}. ${badges.join('. ')}.` : `${head}.`
  const extra = note.trim()
  const comment = extra ? `${structured} ${extra}` : structured
  return comment.slice(0, COMMENT_MAX)
}

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
  onSubmit: (rating: FeedbackRating, comment: string) => Promise<boolean>
  onDismiss: () => void
}) {
  const [stars, setStars] = useState<StarCount | null>(null)
  const [hovered, setHovered] = useState<StarCount | null>(null)
  const [badges, setBadges] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState(false)
  const id = useId()
  if (feedback)
    return (
      <section aria-label="Оценка работы бота" className="border-border bg-surface-2 mt-6 space-y-2 rounded-2xl border p-5">
        <p className="text-ui-body flex items-center gap-2 font-medium">
          <LuCheck className="text-success size-4" />
          Спасибо за обратную связь!
        </p>
        <p className="text-foreground/60 text-ui-body">Ваша оценка: {feedback.comment || ratingLabels[feedback.rating]}</p>
      </section>
    )

  const options = stars === null ? [] : BADGES[stars]

  const toggleBadge = (label: string) => {
    setBadges((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]))
    setError(false)
  }

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
        onSubmit={async (event) => {
          event.preventDefault()
          if (stars === null || busy) return
          setError(false)
          setError(!(await onSubmit(ratingFromStars(stars), formatFeedbackComment(stars, badges, note))))
        }}
      >
        <fieldset disabled={busy} className="min-w-0">
          <legend className="text-ui-body mb-3 w-full text-center font-medium">Оцените ответ</legend>
          <div
            role="radiogroup"
            aria-label="Оценка от 1 до 5 звёзд"
            className="flex justify-center gap-1 sm:gap-2"
            onPointerLeave={() => setHovered(null)}
          >
            {STAR_COUNTS.map((value) => {
              const preview = hovered ?? stars
              const lit = preview !== null && value <= preview
              const chosen = stars !== null && value <= stars
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={stars === value}
                  aria-label={`${value} из 5`}
                  onPointerEnter={() => setHovered(value)}
                  onClick={() => {
                    setStars(value)
                    setBadges([])
                    setError(false)
                  }}
                  className={`focus-visible:ring-primary cursor-pointer rounded-xl p-2 touch-manipulation transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none ${
                    lit ? 'text-amber-500' : 'text-foreground/25'
                  } hover:scale-110 active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100`}
                >
                  <LuStar className={`size-9 transition-[fill,color] duration-150 motion-reduce:transition-none sm:size-10 ${lit || chosen ? 'fill-current' : ''}`} />
                </button>
              )
            })}
          </div>
          {stars !== null && (
            <div className="mt-6">
              <p id={`${id}-badges`} className="text-ui-body text-center font-medium">
                Что совпало с вашей оценкой?
              </p>
              <div role="group" aria-labelledby={`${id}-badges`} className="mt-5 mb-6 flex flex-wrap justify-center gap-2">
                {options.map((label) => {
                  const active = badges.includes(label)
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleBadge(label)}
                      className={`text-ui-small focus-visible:ring-primary cursor-pointer rounded-full border px-3 py-1.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none ${
                        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/70 hover:bg-surface-2'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <div>
                <label htmlFor={`${id}-note`} className="text-ui-body mb-2 block text-center font-medium">
                  Комментарий
                </label>
                <Textarea
                  id={`${id}-note`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={COMMENT_MAX}
                  placeholder="Если хотите, добавьте подробности…"
                  aria-describedby={`${id}-note-hint`}
                />
                <p id={`${id}-note-hint`} className="text-foreground/40 text-ui-small mt-1 text-center">
                  Необязательно. Текст отправится после оценки и выбранных причин.
                </p>
              </div>
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
            <Button type="submit" size="sm" disabled={stars === null || busy} aria-busy={busy}>
              {busy ? 'Сохраняем оценку…' : 'Отправить оценку'}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
