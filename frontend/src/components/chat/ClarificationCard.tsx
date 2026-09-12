import { useId, useRef, useState } from 'react'
import { LuArrowRight, LuCheck, LuLoaderCircle, LuMessageCircle, LuPencil } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { ClarificationRequest } from '@/features/chat/types'

interface ClarificationCardProps {
  request: ClarificationRequest
  answered: boolean
  answer?: string
  busy: boolean
  closed: boolean
  onAnswer?: (request: ClarificationRequest, content: string) => Promise<boolean>
}

export default function ClarificationCard({ request, answered, answer, busy, closed, onAnswer }: ClarificationCardProps) {
  const id = useId()
  const [selection, setSelection] = useState<number | 'other' | null>(null)
  const [customAnswer, setCustomAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)
  const submitLock = useRef(false)
  const locked = busy || submitting
  const content = selection === 'other' ? customAnswer.trim() : selection === null ? '' : request.options[selection]
  const questionId = `${id}-question`

  async function submit() {
    if (locked || submitLock.current || !content || !onAnswer) return
    submitLock.current = true
    setSubmitting(true)
    setError(false)
    try {
      setError(!await onAnswer(request, content))
    } catch {
      setError(true)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  if (answered || closed || !onAnswer) {
    const customAnswered = answered && !!answer && !request.options.includes(answer)

    return (
      <section aria-labelledby={questionId} className={`mt-3 rounded-2xl border p-4 sm:p-5 ${answered ? 'border-success/20 bg-success/5' : 'border-border bg-surface-2'}`}>
        {answered && (
          <div className="text-success text-ui-small mb-2 flex items-center gap-2 font-medium">
            <LuCheck aria-hidden="true" className="size-4 shrink-0" />
            Ответ получен
          </div>
        )}
        <h3 id={questionId} className="text-ui-body font-medium leading-relaxed break-words">{request.question}</h3>
        <ul className="mt-4 space-y-2">
          {[...request.options, 'Свой вариант'].map((option, index) => {
            const other = index === request.options.length
            const selected = answered && (other ? customAnswered : option === answer)
            return (
              <li key={index} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 ${selected ? 'border-success/40 bg-success/10' : 'border-border'}`}>
                <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-success bg-success text-white' : 'border-foreground/25'}`}>
                  {selected && <LuCheck className="size-3.5" />}
                </span>
                <div className="text-ui-body min-w-0 flex-1 leading-relaxed break-words">
                  <span className={selected ? 'font-medium' : undefined}>{option}</span>
                  {selected && <span className="sr-only"> — выбранный ответ</span>}
                  {other && customAnswered && <p className="mt-1 whitespace-pre-wrap">{answer}</p>}
                </div>
                {other && <LuPencil aria-hidden="true" className="text-foreground/45 size-4 shrink-0" />}
              </li>
            )
          })}
        </ul>
        {!answered && (
          <p className="text-foreground/60 text-ui-small mt-2">
            {closed ? 'Обращение закрыто. Откройте его, чтобы ответить.' : 'Это уточнение больше недоступно для ответа.'}
          </p>
        )}
      </section>
    )
  }

  return (
    <form
      aria-labelledby={questionId}
      aria-busy={locked}
      onSubmit={(event) => { event.preventDefault(); void submit() }}
      className="border-primary/20 bg-surface mt-3 rounded-2xl border p-4 shadow-sm sm:p-5"
    >
      <div className="text-primary text-ui-small mb-3 flex items-center gap-2 font-medium">
        <LuMessageCircle aria-hidden="true" className="size-4" />
        Уточним одну деталь
      </div>
      <h3 id={questionId} className="text-ui-body font-semibold leading-relaxed break-words">{request.question}</h3>

      <fieldset disabled={locked} aria-labelledby={questionId} className="mt-4 min-w-0 space-y-2 disabled:opacity-60">
        {[...request.options, 'Свой вариант'].map((option, index) => {
          const value = index === request.options.length ? 'other' : index
          const selected = selection === value
          return (
            <label key={index} className={`relative flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-surface ${locked ? 'cursor-wait' : 'cursor-pointer'} ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-surface-2'}`}>
              <input
                type="radio"
                name={id}
                value={value}
                checked={selected}
                onChange={() => { setSelection(value); setError(false) }}
                className="sr-only"
              />
              <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/25'}`}>
                {selected && <LuCheck className="size-3.5" />}
              </span>
              <span className="text-ui-body min-w-0 flex-1 leading-relaxed break-words">{option}</span>
              {value === 'other' && <LuPencil aria-hidden="true" className="text-foreground/45 size-4 shrink-0" />}
            </label>
          )
        })}
        {selection === 'other' && (
          <div className="pt-2">
            <label htmlFor={`${id}-custom`} className="text-ui-small mb-2 block font-medium">Ваш ответ</label>
            <Textarea
              id={`${id}-custom`}
              value={customAnswer}
              onChange={(event) => { setCustomAnswer(event.target.value); setError(false) }}
              placeholder="Опишите, что вы имеете в виду…"
              rows={3}
              maxLength={4000}
              required
              autoFocus
              className="w-full resize-y"
            />
          </div>
        )}
      </fieldset>

      {error && <p role="alert" className="text-error text-ui-small mt-3">Не удалось отправить. Ваш ответ сохранён — попробуйте ещё раз.</p>}
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={locked || !content} className="flex min-h-11 w-full items-center justify-center gap-2 sm:w-auto">
          {locked ? <LuLoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <LuArrowRight aria-hidden="true" className="size-4" />}
          {locked ? 'Отправляем…' : 'Продолжить'}
        </Button>
      </div>
    </form>
  )
}
