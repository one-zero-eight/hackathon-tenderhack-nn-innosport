import { useLayoutEffect, useRef } from 'react'
import { LuArrowUp, LuLoaderCircle } from 'react-icons/lu'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'

export default function ChatComposer({ draft, onDraft, onSend, busy }: { draft: string; onDraft: (value: string) => void; onSend: (text: string) => Promise<boolean>; busy: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 180)}px`
    }
  }, [draft])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && draft.trim()) void onSend(draft)
      }}
      className="border-border bg-surface focus-within:border-primary/50 focus-within:ring-primary/10 rounded-2xl border p-2 shadow-sm focus-within:ring-2"
    >
      <Textarea
        ref={ref}
        aria-label="Ваш вопрос"
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder="Напишите ваш вопрос…"
        rows={2}
        maxLength={10000}
        className="text-ui-body min-h-16 border-0 bg-transparent px-3 py-2 focus-visible:ring-0"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!busy && draft.trim()) void onSend(draft)
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-foreground/40 text-ui-small">Enter — отправить · Shift + Enter — новая строка</span>
        <Button type="submit" aria-label="Отправить сообщение" disabled={busy || !draft.trim()} className="grid size-9 shrink-0 place-items-center rounded-xl p-0">
          {busy ? <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <LuArrowUp className="size-5" />}
        </Button>
      </div>
    </form>
  )
}
