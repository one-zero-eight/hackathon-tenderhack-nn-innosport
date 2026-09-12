import { useRef, useState } from 'react'
import { LuCheck, LuLoaderCircle, LuMessageCircle } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import type { SuggestedRephrase } from '@/features/chat/types'

interface SuggestedRephraseActionProps {
  suggestion: SuggestedRephrase
  answered: boolean
  busy: boolean
  closed: boolean
  onAccept?: (suggestion: SuggestedRephrase) => Promise<boolean>
}

export default function SuggestedRephraseAction({ suggestion, answered, busy, closed, onAccept }: SuggestedRephraseActionProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)
  const submitLock = useRef(false)
  const locked = busy || submitting
  const headingId = `rephrase-${suggestion.id}`

  async function accept() {
    if (locked || submitLock.current || !onAccept) return
    submitLock.current = true
    setSubmitting(true)
    setError(false)
    try {
      setError(!(await onAccept(suggestion)))
    } catch {
      setError(true)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  if (answered || closed || !onAccept) {
    return (
      <section aria-labelledby={headingId} className={`mt-3 rounded-2xl border p-4 sm:p-5 ${answered ? 'border-success/20 bg-success/5' : 'border-border bg-surface-2'}`}>
        {answered && (
          <div className="text-success text-ui-small mb-2 flex items-center gap-2 font-medium">
            <LuCheck aria-hidden="true" className="size-4 shrink-0" />
            Перефразированный вопрос отправлен
          </div>
        )}
        <h3 id={headingId} className="text-ui-body leading-relaxed font-medium">
          Вы имели в виду?
        </h3>
        <p className="text-ui-body border-border mt-3 rounded-xl border px-4 py-3 leading-relaxed break-words whitespace-pre-wrap">{suggestion.content}</p>
        {!answered && <p className="text-foreground/60 text-ui-small mt-2">{closed ? 'Обращение закрыто. Откройте его, чтобы продолжить.' : 'Это предложение больше недоступно.'}</p>}
      </section>
    )
  }

  return (
    <section aria-labelledby={headingId} aria-busy={locked} className="border-primary/20 bg-surface mt-3 rounded-2xl border p-4 shadow-sm sm:p-5">
      <div className="text-primary text-ui-small mb-3 flex items-center gap-2 font-medium">
        <LuMessageCircle aria-hidden="true" className="size-4" />
        Вы имели в виду?
      </div>
      <h3 id={headingId} className="sr-only">
        Вы имели в виду?
      </h3>
      <Button type="button" disabled={locked} onClick={() => void accept()} className="flex min-h-11 w-full items-center justify-start gap-2 text-left whitespace-normal">
        {locked ? <LuLoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{suggestion.content}</span>
      </Button>
      {error && (
        <p role="alert" className="text-error text-ui-small mt-3">
          Не удалось отправить. Попробуйте ещё раз.
        </p>
      )}
    </section>
  )
}
