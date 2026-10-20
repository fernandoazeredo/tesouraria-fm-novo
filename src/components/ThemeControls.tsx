import { useEffect, useState } from 'react'
import { Moon, Sun, X, Bot } from 'lucide-react'
import '../theme.css'

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
  const [authVisible, setAuthVisible] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const assistantUrl = import.meta.env.VITE_FM_ASSISTENTE_PUBLIC_URL as string | undefined

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
      <button className="fm-assistente-trigger" type="button" aria-label="Abrir FM Assistente" title="FM Assistente" onClick={() => setAssistantOpen(true)}><Bot size={24} aria-hidden="true" /><span className="fm-assistente-trigger-label">FM Assistente</span></button>
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
    {assistantOpen && <div className="fm-assistente-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssistantOpen(false) }}><section className="fm-assistente-dialog" role="dialog" aria-modal="true" aria-label="FM Assistente"><header><strong>FM Assistente — Tesouraria FM Novo</strong><button type="button" aria-label="Fechar FM Assistente" onClick={() => setAssistantOpen(false)}><X size={20}/></button></header>{assistantUrl?.startsWith('https://') ? <iframe title="FM Assistente" src={assistantUrl} referrerPolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" /> : <div className="fm-assistente-pendente"><Bot size={44}/><h2>FM Assistente em homologação</h2><p>A integração segura aguarda o endereço público de atendimento do Activepieces. Nenhum acesso financeiro foi habilitado.</p><a href="/dicas" onClick={() => setAssistantOpen(false)}>Consultar DICAS</a></div>}</section></div>}
    </div>
  )
}
