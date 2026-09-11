import { useId, useState } from 'react'
import { LuCheck, LuListFilter } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { ClarificationAnswer, ClarificationRequest } from '@/features/chat/types'

export default function ClarificationCard({
  request,
  answered,
  busy,
  closed = false,
  onAnswer,
}: {
  request: ClarificationRequest
  answered: boolean
  busy: boolean
  closed?: boolean
  onAnswer: (request: ClarificationRequest, answer: ClarificationAnswer) => Promise<boolean>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [otherSelected, setOtherSelected] = useState(false)
  const [other, setOther] = useState('')
  const id = useId()
  if (answered || closed)
    return (
      <section className="border-border bg-surface-2 text-ui-body mt-4 space-y-2 rounded-xl border px-4 py-3">
        <h3 className="text-foreground/50 text-ui-small font-medium">Уточнение</h3>
        <p className="leading-relaxed break-words whitespace-pre-wrap">{request.question}</p>
        <p className="text-foreground/60 text-ui-small flex items-center gap-2">
          {answered && <LuCheck className="text-success size-4" />}
          {answered ? 'Ответ получен' : 'Обращение закрыто. Откройте его, чтобы ответить на уточнение.'}
        </p>
      </section>
    )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && (selected.length > 0 || (otherSelected && other.trim()))) void onAnswer(request, { optionIds: selected, other: otherSelected ? other.trim() : '' })
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
        <p className="text-foreground/45 text-ui-small">{request.multiple ? 'Можно выбрать несколько вариантов' : 'Выберите один вариант или напишите свой'}</p>
        <div className="space-y-2">
          {request.options.map((option) => (
            <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selected.includes(option.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'}`}>
              <input
                type={request.multiple ? 'checkbox' : 'radio'}
                name={id}
                value={option.id}
                checked={selected.includes(option.id)}
                onChange={() => {
                  if (request.multiple) setSelected((values) => (values.includes(option.id) ? values.filter((value) => value !== option.id) : [...values, option.id]))
                  else {
                    setSelected([option.id])
                    setOtherSelected(false)
                  }
                }}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span className="text-ui-body">
                {option.label}
                {option.description && <span className="text-foreground/50 text-ui-small mt-1 block">{option.description}</span>}
              </span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${otherSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'}`}>
            <input
              type={request.multiple ? 'checkbox' : 'radio'}
              name={id}
              checked={otherSelected}
              onChange={() => {
                setOtherSelected(!otherSelected)
                if (!request.multiple) setSelected([])
              }}
              className="accent-primary size-4"
            />
            <span className="text-ui-body">Другое</span>
          </label>
        </div>
        {otherSelected && (
          <div className="space-y-2">
            <label htmlFor={`${id}-other`} className="text-ui-body">
              Ваш вариант
            </label>
            <Textarea id={`${id}-other`} value={other} onChange={(event) => setOther(event.target.value)} placeholder="Введите своё уточнение…" rows={3} maxLength={4000} required autoFocus />
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button type="submit" size="sm" disabled={busy || (otherSelected && !other.trim()) || (!selected.length && !otherSelected)} className="whitespace-normal">
            {busy ? 'Отправляем…' : 'Отправить'}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
