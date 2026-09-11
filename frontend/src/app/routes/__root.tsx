import ThemeToggle from '@/components/ui/themeToggle'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

const RootLayout = () => (
  <div>
    <div className="flex items-center justify-between gap-2 p-2">
      <div className="flex items-center gap-2">
        <Link to="/" className="[&.active]:font-bold">
          Main
        </Link>
        <Link to="/previews" className="[&.active]:font-bold">
          Preview Components
        </Link>
      </div>
      <ThemeToggle />
    </div>
    <hr />
    <Outlet />
  </div>
)

export const Route = createRootRoute({ component: RootLayout })
