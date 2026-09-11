import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/previews/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="flex flex-col gap-2 p-4 text-center">
      Preview some components
      <Link to="/previews/buttons" className="underline">
        Buttons
      </Link>
      <Link to="/previews/table" className="underline">
        Table
      </Link>
    </div>
  )
}
