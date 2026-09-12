import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { LuArrowUp, LuLoaderCircle, LuSearch } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import type { ChatTransport } from '@/features/chat/types'

export default function ChatComposer({
  draft,
  onDraft,
  onSend,
  busy,
  autocomplete,
}: {
  draft: string
  onDraft: (value: string) => void
  onSend: (text: string) => Promise<boolean>
  busy: boolean
  autocomplete: ChatTransport['autocomplete']
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const suggestionsId = useId()
  const [result, setResult] = useState<string[]>([])
  const [focused, setFocused] = useState(false)
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const query = draft.trim()
  const enabled = focused && !busy && query.length >= 2 && query.length <= 300 && dismissedDraft !== draft
  // Keep the list mounted during debounce and loading instead of flashing on every keystroke.
  const suggestions = enabled ? result : []

  useEffect(() => {
    if (!enabled || !autocomplete) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void autocomplete(query, controller.signal).then(
        (items) => {
          if (!controller.signal.aborted) {
            setResult(items)
            setActiveIndex(-1)
          }
        },
        () => {
          // Autocomplete is optional: a failed request must not block sending a message.
          if (!controller.signal.aborted) setResult([])
        },
      )
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [autocomplete, enabled, query])

  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 180)}px`
    }
  }, [draft])

  const selectSuggestion = (text: string) => {
    onDraft(text)
    setDismissedDraft(text)
    setResult([])
    setActiveIndex(-1)
    ref.current?.focus()
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && draft.trim()) void onSend(draft)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
          setActiveIndex(-1)
        }
      }}
      className="border-border bg-surface focus-within:border-primary/50 focus-within:ring-primary/10 rounded-2xl border p-2 shadow-sm focus-within:ring-2"
    >
      {suggestions.length > 0 && (
        <div className="border-border mb-1 border-b px-1 pb-2">
          <p id={`${suggestionsId}-label`} className="text-foreground/50 text-ui-small px-2 py-1">
            Похожие запросы
          </p>
          <ul id={suggestionsId} role="listbox" aria-labelledby={`${suggestionsId}-label`} className="max-h-52 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`${suggestionsId}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`text-ui-small flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 ${activeIndex === index ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-primary/5'}`}
              >
                <LuSearch aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Textarea
        ref={ref}
        aria-label="Ваш вопрос"
        aria-autocomplete="list"
        aria-controls={suggestions.length ? suggestionsId : undefined}
        aria-activedescendant={suggestions.length && activeIndex >= 0 && activeIndex < suggestions.length ? `${suggestionsId}-${activeIndex}` : undefined}
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const value = event.target.value
          onDraft(value)
          if (value.trim().length < 2 || value.trim().length > 300) setResult([])
          setDismissedDraft(null)
          setActiveIndex(-1)
        }}
        placeholder="Напишите ваш вопрос…"
        rows={2}
        maxLength={10000}
        className="text-ui-body min-h-16 border-0 bg-transparent px-3 py-2 focus-visible:ring-0"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (suggestions.length && !event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            const next = event.key === 'ArrowDown' ? (activeIndex + 1) % suggestions.length : activeIndex < 0 ? suggestions.length - 1 : (activeIndex - 1 + suggestions.length) % suggestions.length
            setActiveIndex(next)
            document.getElementById(`${suggestionsId}-${next}`)?.scrollIntoView({ block: 'nearest' })
            return
          }
          if (event.key === 'Escape' && suggestions.length) {
            event.preventDefault()
            setDismissedDraft(draft)
            setActiveIndex(-1)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const selected = suggestions[activeIndex]
            if (selected) selectSuggestion(selected)
            else if (!busy && draft.trim()) void onSend(draft)
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-foreground/40 text-ui-small">{suggestions.length ? '↑ ↓ — выбрать · Enter — подставить · Esc — скрыть' : 'Enter — отправить · Shift + Enter — новая строка'}</span>
        <Button type="submit" aria-label="Отправить сообщение" disabled={busy || !draft.trim()} className="grid size-9 shrink-0 place-items-center rounded-xl p-0">
          {busy ? <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <LuArrowUp className="size-5" />}
        </Button>
      </div>
    </form>
  )
}
