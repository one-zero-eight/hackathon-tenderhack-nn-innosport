import { LuHeadset, LuLoaderCircle } from 'react-icons/lu'
import Button from '@/components/ui/Button'

export default function SpecialistContact({ busy, onContact }: { busy: boolean; onContact: () => Promise<boolean> }) {
  return (
    <div className="border-primary/15 bg-primary/5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      <div className="text-foreground/65 flex items-center gap-2 text-sm">
        <LuHeadset className="text-primary size-4" />
        Нужна дополнительная помощь?
      </div>
      <Button variant="outline" size="sm" className="flex items-center gap-2 whitespace-normal" disabled={busy} onClick={() => void onContact()}>
        {busy && <LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
        {busy ? 'Отправляем…' : 'Связаться'}
      </Button>
      <p className="text-foreground/45 w-full text-xs">Деморежим: реальная заявка специалисту не отправляется.</p>
    </div>
  )
}
