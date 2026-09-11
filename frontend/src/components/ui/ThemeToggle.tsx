import { useState } from 'react'

// Icons
import { LuSun } from 'react-icons/lu'
import { LuMoon } from 'react-icons/lu'

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean>(false)

  const handleThemeChange = () => {
    setIsDark(!isDark)
    document.documentElement.classList.toggle('dark')
  }

  return (
    <button onClick={handleThemeChange} className="bg-surface hover:bg-surface-2 cursor-pointer rounded-full p-2">
      {isDark ? <LuSun className="size-7" /> : <LuMoon className="size-7" />}
    </button>
  )
}
