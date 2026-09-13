import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { LuExternalLink, LuX } from 'react-icons/lu'
import type { SchemaCitation } from '@/api/types'
import Button from '@/components/ui/Button'

import { pdfSourceUrl } from '@/features/chat/sources'

export default function PdfSourceDialog({ citation, onClose }: { citation: SchemaCitation; onClose: () => void }) {
  const url = pdfSourceUrl(citation.path)
  if (!url) return null
  const title = citation.document.replace(/_/g, ' ').replace(/\.pdf$/i, '')
  const page = citation.path.split('#page=')[1]
  const details = [citation.section.trim(), page ? `Страница ${page}` : ''].filter(Boolean).join(' · ')

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-2 sm:p-6">
        <DialogPanel className="bg-background text-foreground flex h-full max-h-[960px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl shadow-xl">
          <div className="border-border flex shrink-0 items-start gap-3 border-b p-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-ui-body font-semibold wrap-break-word">{title}</DialogTitle>
              {details && <p className="text-foreground/55 mt-1 text-xs wrap-break-word">{details}</p>}
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Открыть PDF в новой вкладке" title="Открыть PDF в новой вкладке" className="hover:bg-surface-2 focus-visible:outline-primary rounded-lg p-2 focus-visible:outline-2">
              <LuExternalLink aria-hidden="true" className="size-5" />
            </a>
            <Button variant="ghost" className="p-2" aria-label="Закрыть документ" onClick={onClose}>
              <LuX aria-hidden="true" className="size-5" />
            </Button>
          </div>
          <iframe key={url} src={url} title={page ? `${title}, страница ${page}` : title} className="min-h-0 w-full flex-1 border-0 bg-white" />
        </DialogPanel>
      </div>
    </Dialog>
  )
}
