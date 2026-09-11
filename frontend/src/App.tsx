import { useState } from 'react'

import ButtonPreviewPage from '@/components/pages/button-preview/ButtonPreviewPage'
import TablePreviewPage from '@/components/pages/table-preview/TablePreviewPage'
import ThemeToggle from '@/components/ui/ThemeToggle'

type View = 'home' | 'buttons' | 'table'

const navigation: Array<{ label: string; view: View }> = [
  { label: 'Main', view: 'home' },
  { label: 'Buttons', view: 'buttons' },
  { label: 'Table', view: 'table' },
]

export default function App() {
  const [view, setView] = useState<View>('home')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border p-3">
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
          {navigation.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`cursor-pointer rounded-md px-3 py-2 text-sm transition-colors ${
                view === item.view ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-2'
              }`}
              onClick={() => setView(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
      </header>

      <main>
        {view === 'home' && (
          <section className="flex flex-col gap-2 p-6 text-center">
            <h1 className="text-3xl font-semibold">InnoSport</h1>
            <p className="text-foreground/70">React, TypeScript, and Tailwind CSS are ready.</p>
          </section>
        )}
        {view === 'buttons' && <ButtonPreviewPage />}
        {view === 'table' && (
          <div className="p-4">
            <TablePreviewPage />
          </div>
        )}
      </main>
    </div>
  )
}
