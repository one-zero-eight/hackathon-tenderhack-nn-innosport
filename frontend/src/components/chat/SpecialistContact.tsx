import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react'
import { LuHeadset } from 'react-icons/lu'
import Button from '@/components/ui/Button'

export default function SpecialistContact() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="border-primary/15 bg-primary/5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <div className="text-foreground/65 flex items-center gap-2 text-sm">
          <LuHeadset className="text-primary size-4" />
          Нужна дополнительная помощь?
        </div>
        <Button variant="outline" size="sm" className="whitespace-normal" onClick={() => setOpen(true)}>
          Связаться
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="border-border bg-background text-foreground w-full max-w-md rounded-2xl border p-6 shadow-xl">
            <LuHeadset className="text-primary mb-4 size-8" />
            <DialogTitle className="text-lg font-semibold">Связаться со специалистом</DialogTitle>
            <Description className="text-foreground/65 mt-3 text-sm leading-relaxed">
              Связь со специалистом пока недоступна. Заявка не отправлена. После подключения сервиса здесь можно будет передать обращение специалисту.
            </Description>
            <Button className="mt-6" onClick={() => setOpen(false)}>
              Вернуться к обращению
            </Button>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
