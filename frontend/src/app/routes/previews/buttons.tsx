import ButtonPreviewPage from '@/components/pages/button-preview/ButtonPreviewPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/previews/buttons')({
  component: RouteComponent,
})

function RouteComponent() {
  return <ButtonPreviewPage />
}
