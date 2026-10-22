import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import '../theme.css'

type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'mm-theme-mode'
const FM_ASSISTENTE_URL = 'https://cloud.activepieces.com/chats/Odqvny7ajdtEmRvsSJmRt'

function initialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeControls() {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme)
  const [authVisible, setAuthVisible] = useState(false)

  useEffect(() => {
    const syncAuthState = () => {
      const visible = Boolean(document.querySelector('.auth-page'))
      setAuthVisible(visible)
      const activeTheme: ThemeMode = visible ? 'light' : theme
      document.documentElement.dataset.theme = activeTheme
      document.documentElement.style.colorScheme = activeTheme
    }

    syncAuthState()
    const observer = new MutationObserver(syncAuthState)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [theme])

  useEffect(() => {
    if (authVisible) return
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(STORAGE_KEY, theme)
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
