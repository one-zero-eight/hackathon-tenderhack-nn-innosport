export default function AdminFeedbackPanel() {
  return (
    <aside aria-labelledby="admin-feedback-title" className="border-border bg-surface flex min-h-0 flex-col overflow-hidden rounded-2xl border">
      <header className="border-border border-b px-5 py-4">
        <h2 id="admin-feedback-title" className="text-ui-title font-semibold">
          Анализ обращения
        </h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <h3 className="text-ui-body font-medium">Что хотел пользователь (на основе фидбека)?</h3>
        <h3 className="border-border text-ui-body border-t pt-5 font-medium">Что ответил агент?</h3>
        <h3 className="border-border text-ui-body border-t pt-5 font-medium">Как можно улучшить ответ модели?</h3>
      </div>
    </aside>
  )
}
