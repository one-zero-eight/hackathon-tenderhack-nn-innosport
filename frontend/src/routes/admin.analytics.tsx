import { createFileRoute } from '@tanstack/react-router'
import AdminAnalyticsPanel from '@/components/admin/AdminAnalyticsPanel'

export const Route = createFileRoute('/admin/analytics')({
  component: AdminAnalyticsPanel,
})
