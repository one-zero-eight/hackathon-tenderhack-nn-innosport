import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { LuX } from 'react-icons/lu'
import type { ReactNode } from 'react'
import Button from './Button'

export default function Drawer({ open, onClose, title, side = 'left', children }: { open: boolean; onClose: () => void; title: string; side?: 'left' | 'right'; children: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`fixed inset-0 flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
        <DialogPanel className="bg-background text-foreground flex h-dvh w-80 max-w-[90vw] flex-col shadow-xl">
          <div className="border-border flex shrink-0 items-center justify-between border-b p-4">
            <DialogTitle className="font-semibold">{title}</DialogTitle>
            <Button variant="ghost" className="p-2" aria-label="Закрыть панель" onClick={onClose}>
              <LuX className="size-5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
