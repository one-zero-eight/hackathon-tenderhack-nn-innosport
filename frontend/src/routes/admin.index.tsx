import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({
  component: () => (
    <section aria-label="Выбор обращения" className="border-border bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border">
      <p className="text-foreground/50 m-auto p-6 text-center">Выберите обращение для просмотра истории или перейдите на вкладку «Аудит».</p>
    </section>
  ),
})
