import { createFileRoute } from '@tanstack/react-router'
import AdminDialogPage from '@/components/admin/AdminDialogPage'

export const Route = createFileRoute('/admin/tickets/$dialogId')({
  component: function AdminTicketRoute() {
    const { dialogId } = Route.useParams()
    return <AdminDialogPage key={dialogId} dialogId={dialogId} />
  },
})
