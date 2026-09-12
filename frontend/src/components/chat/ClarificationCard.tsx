import { useId, useState } from 'react'
import { LuCheck, LuListFilter } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { ClarificationRequest } from '@/features/chat/types'

export default function ClarificationCard({
  request,
  answered,
  busy,
  closed,
  onAnswer,
}: {
  request: ClarificationRequest
  answered: boolean
  busy: boolean
  closed: boolean
  onAnswer?: (request: ClarificationRequest, content: string) => Promise<boolean>
}) {
  const [selected, setSelected] = useState<number | 'other' | null>(null)
  const [other, setOther] = useState('')
  const id = useId()
  const content = selected === 'other' ? other.trim() : selected === null ? '' : request.options[selected]

  if (answered || closed || !onAnswer) {
    return (
      <section className="border-border bg-surface-2 text-ui-body mt-4 space-y-2 rounded-xl border px-4 py-3">
        <h3 className="text-foreground/50 text-ui-small font-medium">Уточнение</h3>
        <p className="leading-relaxed break-words whitespace-pre-wrap">{request.question}</p>
        <ul className="space-y-2">
          {[...request.options, 'Другое'].map((option) => (
            <li key={option} className="border-border rounded-xl border px-3 py-2 break-words">{option}</li>
          ))}
        </ul>
        <p className="text-foreground/60 text-ui-small flex items-center gap-2">
          {answered && <LuCheck className="text-success size-4" />}
          {answered ? 'Ответ получен' : closed ? 'Обращение закрыто. Откройте его, чтобы ответить на уточнение.' : 'Ответ ещё не получен'}
        </p>
      </section>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && content) void onAnswer(request, content)
      }}
      className="border-border bg-surface mt-4 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-border bg-surface-2/60 border-b px-5 py-4">
        <h3 className="text-ui-title flex items-center gap-2 font-semibold">
          <LuListFilter className="text-primary size-4" />
          Пожалуйста, уточните запрос
        </h3>
      </div>
      <fieldset disabled={busy} className="space-y-3 p-5">
        <legend className="sr-only">{request.question}</legend>
        <p className="text-ui-body leading-relaxed">{request.question}</p>
        <p className="text-foreground/45 text-ui-small">Выберите один вариант или напишите свой</p>
        <div className="space-y-2">
          {request.options.map((option, index) => (
            <label key={index} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selected === index ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'}`}>
              <input type="radio" name={id} value={option} checked={selected === index} onChange={() => setSelected(index)} className="accent-primary mt-0.5 size-4 shrink-0" />
              <span className="text-ui-body break-words">{option}</span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selected === 'other' ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'}`}>
            <input type="radio" name={id} checked={selected === 'other'} onChange={() => setSelected('other')} className="accent-primary size-4" />
            <span className="text-ui-body">Другое</span>
          </label>
        </div>
        {selected === 'other' && (
          <div className="space-y-2">
            <label htmlFor={`${id}-other`} className="text-ui-body">Ваш вариант</label>
            <Textarea id={`${id}-other`} value={other} onChange={(event) => setOther(event.target.value)} placeholder="Введите своё уточнение…" rows={3} maxLength={4000} required autoFocus />
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button type="submit" size="sm" disabled={busy || !content} className="whitespace-normal">{busy ? 'Отправляем…' : 'Отправить'}</Button>
        </div>
      </fieldset>
    </form>
  )
}
