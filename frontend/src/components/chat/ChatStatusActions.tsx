import { LuCheck, LuRotateCcw } from 'react-icons/lu'
import Button from '@/components/ui/Button'

export default function ChatStatusActions({ closed, busy, onClose, onReopen }: { closed: boolean; busy: boolean; onClose: () => void; onReopen: () => void }) {
  if (closed)
    return (
      <div className="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <p className="text-foreground/65 flex items-center gap-2 text-sm">
          <LuCheck className="text-success size-4" />
          Обращение завершено
        </p>
        <Button variant="outline" size="sm" className="flex items-center gap-2 whitespace-normal" disabled={busy} onClick={onReopen}>
          <LuRotateCcw className="size-4" />
          Открыть обращение
        </Button>
      </div>
    )
  return (
    <div className="mb-2 flex justify-end">
      <Button variant="ghost" size="sm" className="text-foreground/55 whitespace-normal" disabled={busy} onClick={onClose}>
        Закрыть обращение
      </Button>
    </div>
  )
}
