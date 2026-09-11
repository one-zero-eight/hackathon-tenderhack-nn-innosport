import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="flex flex-col gap-2 p-4 text-center">
      <h2 className="text-2xl font-semibold">Welcome to front-end template</h2>
      <span>
        Check out
        <a href="https://github.com/PoweredDeveloper/frontend-template" target="_blank" className="ml-2 underline">
          GitHub page
        </a>
      </span>
    </div>
  )
}
