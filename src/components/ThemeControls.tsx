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
      <button type="button" className="fm-assistente-trigger" aria-label="Abrir FM Assistente" title="FM Assistente" onClick={() => {
        const width = 704
        const height = 623
        const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
        const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
        window.open(
          FM_ASSISTENTE_URL,
          'fm-assistente',
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
      }}>
        <img src="data:image/png;base64,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" alt="" aria-hidden="true" />
      </button>
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
