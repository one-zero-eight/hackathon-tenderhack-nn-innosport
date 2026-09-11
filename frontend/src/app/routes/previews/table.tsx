import TablePreviewPage from '@/components/pages/table-preview/TablePreviewPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/previews/table')({
  component: Table,
})

function Table() {
  return (
    <div className="p-2">
      <TablePreviewPage />
    </div>
  )
}
