import { useState } from 'react'
import { LuMoon, LuSun } from 'react-icons/lu'
import Button from './Button'

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  return (
    <Button
      variant="ghost"
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => {
        document.documentElement.classList.toggle('dark', !isDark)
        setIsDark(!isDark)
      }}
      className="text-foreground rounded-full p-2"
    >
      {isDark ? <LuSun className="size-5" /> : <LuMoon className="size-5" />}
    </Button>
  )
}
