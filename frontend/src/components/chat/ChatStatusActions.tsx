import type { ReactNode } from 'react'
import { LuCheck, LuRotateCcw } from 'react-icons/lu'
import Button from '@/components/ui/Button'

export default function ChatStatusActions({ closed, busy, latestAction, onClose, onReopen }: { closed: boolean; busy: boolean; latestAction?: ReactNode; onClose: () => void; onReopen: () => void }) {
  if (closed)
    return (
      <>
        {latestAction && <div className="mb-2 flex justify-center">{latestAction}</div>}
        <div className="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-foreground/65 text-ui-body flex items-center gap-2">
            <LuCheck className="text-success size-4" />
            Обращение завершено
          </p>
          <Button variant="outline" size="sm" className="flex w-56 items-center justify-center gap-2" disabled={busy} onClick={onReopen}>
            <LuRotateCcw className="size-4 shrink-0" />
            Открыть обращение
          </Button>
        </div>
      </>
    )
  return (
    <div className="mb-2 grid min-h-8 grid-cols-[auto_1fr] items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
      {latestAction && <div className="col-start-1 sm:col-start-2 sm:row-start-1">{latestAction}</div>}
      <Button variant="ghost" size="sm" className="text-foreground/55 hover:text-foreground col-start-2 flex items-center gap-1.5 justify-self-end text-xs font-normal sm:col-start-3 sm:row-start-1" onClick={onClose}>
        <LuCheck aria-hidden="true" className="size-3.5" />
        Закрыть обращение
      </Button>
    </div>
  )
}
