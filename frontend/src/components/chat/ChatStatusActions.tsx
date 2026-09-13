import type { ReactNode } from 'react'
import { LuCheck, LuRotateCcw } from 'react-icons/lu'
import Button from '@/components/ui/Button'

export default function ChatStatusActions({
  closed,
  busy,
  latestAction,
  extra,
  onClose,
  onNewChat,
}: {
  closed: boolean
  busy: boolean
  latestAction?: ReactNode
  extra?: ReactNode
  onClose: () => void
  onNewChat: () => void
}) {
  if (closed)
    return (
      <>
        {latestAction && <div className="mb-2 flex justify-center">{latestAction}</div>}
        <div className="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-foreground/65 text-ui-body flex items-center gap-2">
            <LuCheck className="text-success size-4" />
            Обращение завершено
          </p>
          <Button variant="outline" size="sm" className="flex w-56 items-center justify-center gap-2" disabled={busy} onClick={onNewChat}>
            <LuRotateCcw className="size-4 shrink-0" />
            Новое обращение
          </Button>
        </div>
      </>
    )
  return (
    <div className="mb-2 flex min-h-8 items-center gap-2">
      {latestAction && <div className="min-w-0">{latestAction}</div>}
      <div className="ml-auto flex flex-nowrap items-center justify-end gap-1">
        <Button variant="ghost" size="sm" className="text-foreground/55 hover:text-foreground flex items-center gap-1.5 text-xs font-normal" disabled={busy} onClick={onClose}>
          <LuCheck aria-hidden="true" className="size-3.5" />
          Закрыть обращение
        </Button>
        {extra}
      </div>
    </div>
  )
}
