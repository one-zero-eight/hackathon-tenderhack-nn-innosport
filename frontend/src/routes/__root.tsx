import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Страница не найдена</h1>
      <p className="text-foreground/65">Проверьте адрес или вернитесь в чат поддержки.</p>
      <Link to="/" className="text-primary focus-visible:outline-primary rounded underline underline-offset-4 focus-visible:outline-2">
        Вернуться в чат
      </Link>
    </main>
  ),
})
