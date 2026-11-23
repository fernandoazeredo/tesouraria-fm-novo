import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import '../theme.css'
import { useAuth } from '../auth/AuthContext'

type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'mm-theme-mode'

function initialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeControls() {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme)
  const { user, profile, loading } = useAuth()
  // Telas de carregamento, login e cadastro pendente (as mesmas de App) ficam sempre no modo claro.
  const authVisible = loading || !user || !profile || profile.status !== 'active'

  useEffect(() => {
    const activeTheme: ThemeMode = authVisible ? 'light' : theme
    document.documentElement.dataset.theme = activeTheme
    document.documentElement.style.colorScheme = activeTheme
    if (!authVisible) window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme, authVisible])

  if (authVisible) return null

  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const label = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'

  return (
    <div className="fm-header-controls">
      
      <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      <span>{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}</span>
    </button>
    </div>
  )
}
