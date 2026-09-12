import { createFileRoute } from '@tanstack/react-router'
import AdminAuditPanel from '@/components/admin/AdminAuditPanel'

export const Route = createFileRoute('/admin/audit')({
  component: AdminAuditPanel,
})
