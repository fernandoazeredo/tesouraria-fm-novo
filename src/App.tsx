import { useEffect, useState, type FormEvent } from 'react'
import {
  BarChart3,
  BookOpenCheck,
  Calculator,
  CalendarDays,
  Wallet,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Eye,
  EyeOff,
  FolderArchive,
  Handshake,
  LayoutDashboard,
  Landmark,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './lib/firebase'
import { effectiveView, modulePaths, type ModuleId, type PermissionDocument } from './lib/permissionCatalog'
import { PermissionsPanel } from './components/PermissionsPanel'
import { useAuth, PRIMARY_ADMIN_EMAIL, DIRECTOR_EMAIL, type UserRole } from './auth/AuthContext'
import { TreasuryPage } from './pages/SystemPages'
import { ReceivablesPageStorageV2 } from './pages/ReceivablesPageStorageV2'
import { ExpensesPageStorage } from './pages/ExpensesPageStorage'
import { ExpenseSettlementPanel } from './components/ExpenseSettlementPanel'
import { AccountsPageFernando } from './pages/AccountsPageFernando'
import { DocumentsPageStorage } from './pages/DocumentsPageStorage'
import { DashboardPageEnhanced } from './pages/DashboardPageEnhanced'
import { ApprovalsPageEnhanced } from './pages/ApprovalsPageEnhanced'
import { AccountingPageStorageV2 } from './pages/AccountingPageStorageV2'
import { BankReconciliationPage } from './pages/BankReconciliationPage'
import { FinancialCalendarPage } from './pages/FinancialCalendarPage'
import { CashFlowMonthlyPage } from './pages/CashFlowMonthlyPage'
import { DreGerencialPageV2 } from './pages/DreGerencialPageV2'
import { HowToPageEnhanced, TipsPageEnhanced } from './pages/HelpPagesEnhanced'
import { UsersPageKitFernando } from './pages/UsersPageKitFernando'
import { UtilitiesPage } from './pages/UtilitiesPage'
import { FiscalNotesPageV3 } from './pages/FiscalNotesPageV3'
import { AlvaraTransfersPageV3 } from './pages/AlvaraControlPagesV3'
import { AgentCommissionsPageV4 } from './pages/AgentCommissionsPageV4'
import { AuditPageEnhancedV2 } from './pages/AuditPageEnhancedV2'
import { SocietaryTransferSync, SocietaryTransfersPage, SocietaryTreasuryPanel } from './pages/SocietaryTransfersPage'
import { WorkflowStatusEnhancer } from './components/WorkflowStatusEnhancer'
import './system.css'
import './fixes.css'
import './review-fixes.css'
import './accounts-official.css'
import './enhancements.css'
import './account-selector.css'
import './admin-tools.css'
import './accounting-storage.css'
import './accounts-fernando.css'
import './storage-documents.css'

// Rotas financeiras críticas versionadas: Calendário Financeiro e Conciliação Bancária.
const companyData = {
  razaoSocial: 'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',
  cnpj: '04.344.462/0001-87',
  endereco: 'Rua México, 21 / 1102 – Centro – Rio de Janeiro – RJ',
}

type AccessRole = 'master' | 'diretor' | 'gerente' | 'tesouraria' | 'operador'
type MenuItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  tone?: 'expense' | 'revenue'
  roles?: AccessRole[]
}

const menu: MenuItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/despesas', label: 'Despesas', icon: ReceiptText, tone: 'expense', roles: ['master', 'diretor', 'gerente', 'tesouraria', 'operador'] },
  { to: '/alvaras', label: 'Recebimento de Alvarás', icon: FileText, tone: 'revenue', roles: ['master', 'diretor', 'gerente', 'tesouraria', 'operador'] },
  { to: '/repasse-alvaras', label: 'Repasse de Alvarás', icon: CircleDollarSign, tone: 'revenue', roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/repasse-societario', label: 'Repasse Societário', icon: Handshake, tone: 'revenue', roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/nota-fiscal', label: 'Nota Fiscal', icon: FileText, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/comissoes-agentes', label: 'Comissões de Agentes', icon: Users, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/tesouraria', label: 'Tesouraria — Recebimentos', icon: CircleDollarSign, tone: 'revenue', roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/aprovacoes', label: 'Aprovações', icon: FileCheck2, roles: ['master', 'diretor', 'gerente', 'tesouraria', 'operador'] },
  { to: '/dre-gerencial', label: 'DRE Gerencial', icon: BarChart3, roles: ['master', 'diretor', 'gerente'] },
  { to: '/plano-contas', label: 'Plano de Contas', icon: BookOpenCheck, roles: ['master'] },
  { to: '/contabilidade', label: 'Contabilidade', icon: Calculator, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/calendario-financeiro', label: 'Calendário Financeiro', icon: CalendarDays, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/fluxo-caixa', label: 'Fluxo de Caixa', icon: Wallet, roles: ['master', 'diretor'] },
  { to: '/conciliacao-bancaria', label: 'Conciliação Bancária', icon: Landmark, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/documentos', label: 'Arquivo de Documentos', icon: FolderArchive, roles: ['master', 'diretor', 'gerente', 'tesouraria', 'operador'] },
  { to: '/usuarios', label: 'Usuários', icon: Users, roles: ['master'] },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, roles: ['master'] },
  { to: '/utilitarios', label: 'Utilitários', icon: Wrench, roles: ['master'] },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, roles: ['master'] },
]

function accessRoleFromUserRole(role: UserRole | undefined): AccessRole {
  if (role === 'master') return 'master'
  if (role === 'diretor') return 'diretor'
  if (role === 'gerente') return 'gerente'
  if (role === 'tesouraria') return 'tesouraria'
  return 'operador'
}

function humanizeAuthError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha inválidos.'
  if (code.includes('email-already-in-use')) return 'Este e-mail já possui cadastro.'
  if (code.includes('weak-password')) return 'A senha deve possuir pelo menos 6 caracteres.'
  if (code.includes('popup-closed-by-user')) return 'A janela do Google foi fechada antes de concluir o acesso.'
  if (code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login do Google.'
  return 'Não foi possível concluir o acesso. Tente novamente.'
}

function GoogleMark() {
  return <svg className="google-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.04c0-.64-.06-1.25-.16-1.84H12v3.48h5.25a4.49 4.49 0 0 1-1.95 2.94v2.44h3.16c1.85-1.7 2.89-4.21 2.89-7.02Z"/><path fill="#34A853" d="M12 21.5c2.64 0 4.86-.87 6.48-2.37l-3.16-2.44c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.49-4.04H3.25v2.53A9.79 9.79 0 0 0 12 21.5Z"/><path fill="#FBBC05" d="M6.51 13.59a5.88 5.88 0 0 1 0-3.76V7.3H3.25a9.5 9.5 0 0 0 0 8.82l3.26-2.53Z"/><path fill="#EA4335" d="M12 5.79c1.44 0 2.73.5 3.75 1.47l2.81-2.81A9.43 9.43 0 0 0 3.25 7.3l3.26 2.53C7.29 7.51 9.45 5.79 12 5.79Z"/></svg>
}

function LoadingScreen() {
  return <div className="auth-page"><div className="loading-box" aria-live="polite"><LoaderCircle className="spin" size={28} /><span>Carregando o sistema...</span></div></div>
}

function LoginScreen() {
  const { signInEmail, registerEmail, signInGoogle } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') await registerEmail(name, email, password)
      else await signInEmail(email, password)
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function googleLogin() {
    setBusy(true)
    setError('')
    try {
      await signInGoogle()
    } catch (err) {
      setError(humanizeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page login-light-only">
      <div className="auth-layout login-shell">
        <section className="auth-brand-panel">
          <img src="/logo-fm.svg" alt="Flávio Marques Advogados Associados" />
          <div className="auth-brand-copy">
            <h1>Controle de<br />Despesas e Receitas</h1>
            <div className="auth-brand-accent" />
            <p>Gestão financeira, documental, aprovações e movimentação contábil em um único ambiente.</p>
          </div>
          <div className="auth-benefits" aria-label="Recursos principais">
            <div><span><BarChart3 size={20} /></span><p><strong>Controle Financeiro</strong><small>Acompanhe receitas, despesas e fluxo de caixa.</small></p></div>
            <div><span><FileText size={20} /></span><p><strong>Documentos</strong><small>Organize informações e arquivos com segurança.</small></p></div>
            <div><span><FileCheck2 size={20} /></span><p><strong>Aprovações</strong><small>Fluxos de aprovação claros e transparentes.</small></p></div>
            <div><span><ShieldCheck size={20} /></span><p><strong>Segurança</strong><small>Dados protegidos em um ambiente controlado.</small></p></div>
          </div>
        </section>
        <section className="auth-card">
          <div className="auth-access-icon"><ShieldCheck size={26} /></div>
          <span className="eyebrow">Acesso ao sistema</span>
          <h2>{mode === 'login' ? 'Bem-vindo de volta!' : 'Solicitar acesso'}</h2>
          <p className="auth-helper">{mode === 'login' ? 'Entre com seu e-mail corporativo ou sua conta Google para acessar sua conta.' : 'Todo novo cadastro fica Pendente até a liberação do Administrador Master.'}</p>
          <form onSubmit={submit} className="auth-form">
            {mode === 'register' && <label><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Seu nome" /></label>}
            <label><span>E-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="seu@email.com" /></label>
            <div className="auth-password-field">
              <label htmlFor="fm-login-password">Senha</label>
              <div className="auth-password-input">
                <input id="fm-login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" />
                <button className="auth-password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword} title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                  {showPassword ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
                </button>
              </div>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Mail size={18} />}{mode === 'login' ? 'Entrar com e-mail' : 'Criar acesso'}</button>
          </form>
          <div className="auth-divider"><span>ou</span></div>
          <button className="google-button" type="button" onClick={googleLogin} disabled={busy}><GoogleMark />Continuar com Google</button>
          <button className="text-button" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setShowPassword(false); setError('') }}>{mode === 'login' ? 'Primeiro acesso? Solicitar cadastro' : 'Já possui acesso? Voltar para o login'}</button>
        </section>
      </div>
    </div>
  )
}

function PendingScreen() {
  const { profile, logout } = useAuth()
  return <div className="auth-page"><section className="pending-card"><UserRoundCheck size={42} /><span className="eyebrow">Cadastro recebido</span><h1>Aguardando liberação</h1><p>Seu cadastro foi criado, mas ainda precisa ser ativado pelo Administrador Master.</p><strong>{profile?.email}</strong><button className="secondary-button" type="button" onClick={logout}><LogOut size={18} /> Sair</button></section></div>
}

function Configuracoes() {
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Administração Master</span><h1>Configurações</h1><p>Dados institucionais utilizados pelo aplicativo.</p></div></div>
      <PermissionsPanel />
      <section className="page-card"><span className="eyebrow">Dados institucionais</span><h2>Configurações do Aplicativo</h2><p>Cadastro utilizado nos demonstrativos, relatórios e documentos gerados pelo sistema.</p><div className="settings-grid"><label><span>Razão Social</span><input value={companyData.razaoSocial} readOnly /></label><label><span>CNPJ</span><input value={companyData.cnpj} readOnly /></label><label className="settings-full-width"><span>Endereço</span><input value={companyData.endereco} readOnly /></label></div></section>
    </>
  )
}

function VersionUpdateNotice() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    const currentScript = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src || ''
    const currentPath = currentScript ? new URL(currentScript, window.location.origin).pathname : ''

    async function checkVersion() {
      try {
        const response = await fetch(`/index.html?version-check=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return
        const html = await response.text()
        const match = html.match(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)
        if (!match?.[1] || !currentPath) return
        const latestPath = new URL(match[1], window.location.origin).pathname
        if (!cancelled && latestPath !== currentPath) setAvailable(true)
      } catch {
        // Falha de rede não deve interromper o uso do sistema.
      }
    }

    void checkVersion()
    const timer = window.setInterval(() => void checkVersion(), 15000)
    const onVisibility = () => { if (document.visibilityState === 'visible') void checkVersion() }
    const onFocus = () => void checkVersion()
    const onOnline = () => void checkVersion()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  if (!available) return null
  return <div className="version-update-notice" role="status"><span><strong>Nova versão disponível.</strong> Atualize para usar a versão mais recente do sistema.</span><button type="button" onClick={() => window.location.reload()}>Atualizar agora</button></div>
}

function AppShell() {
  const { profile, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const accessRole = accessRoleFromUserRole(profile?.role)
  const canViewCashFlow = Boolean(profile?.email && [PRIMARY_ADMIN_EMAIL, DIRECTOR_EMAIL].includes(profile.email.trim().toLowerCase()))
  const canViewManagementReports = ['master', 'diretor', 'gerente'].includes(accessRole)
  const canViewAudit = Boolean(profile?.email && profile.email.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL && profile.role === 'master')
  const [permissionDoc, setPermissionDoc] = useState<PermissionDocument | null>(null)
  const [permissionsLoaded, setPermissionsLoaded] = useState(false)
  useEffect(() => {
    if (!profile?.uid) { setPermissionDoc(null); setPermissionsLoaded(false); return }
    setPermissionDoc(null); setPermissionsLoaded(false)
    return onSnapshot(doc(db, 'userPermissions', profile.uid), snapshot => {
      setPermissionDoc(snapshot.exists() ? snapshot.data() as PermissionDocument : null)
      setPermissionsLoaded(true)
    }, () => { setPermissionDoc(null); setPermissionsLoaded(true) })
  }, [profile?.uid])
  const pathToId = new Map(Object.entries(modulePaths).map(([id, path]) => [path, id as ModuleId]))
  const canOpen = (path: string) => {
    if (!permissionsLoaded || !profile) return false
    const id = pathToId.get(path)
    if (!id) return true
    return effectiveView(id, accessRole, profile.email || '', permissionDoc, PRIMARY_ADMIN_EMAIL, DIRECTOR_EMAIL)
  }
  const denied = <section className="page-card" role="alert"><h1>Acesso não autorizado</h1><p>Seu usuário não possui permissão para acessar este módulo.</p></section>
  const guarded = (path: string, content: React.ReactNode) => canOpen(path) ? content : denied
  const visibleMenu = menu.filter(item => canOpen(item.to))

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-lock', mobileMenuOpen)
    return () => document.body.classList.remove('mobile-menu-lock')
  }, [mobileMenuOpen])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <div className="app-shell">
      <VersionUpdateNotice />
      <WorkflowStatusEnhancer />
      <SocietaryTransferSync />
      <header className="mobile-app-header">
        <button type="button" className="mobile-menu-toggle" aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileMenuOpen} aria-controls="app-sidebar" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={23} /> : <Menu size={23} />}</button>
        <div className="mobile-header-brand"><img src="/logo-fm.svg" alt="Flávio Marques Advogados Associados" /><span>Controle de Despesas e Receitas</span></div>
      </header>
      <button type="button" className={`mobile-menu-backdrop${mobileMenuOpen ? ' is-open' : ''}`} aria-label="Fechar menu" onClick={closeMobileMenu} />
      <aside id="app-sidebar" className={`sidebar${mobileMenuOpen ? ' is-open' : ''}`}>
        <div className="mobile-sidebar-head"><strong>Menu do sistema</strong><button type="button" className="mobile-sidebar-close" aria-label="Fechar menu" onClick={closeMobileMenu}><X size={21} /></button></div>
        <div className="brand"><div className="brand-logo-only"><img src="/logo-fm.svg" alt="Flávio Marques Advogados Associados" /></div><div className="app-name">Controle de Despesas e Receitas</div></div>
        <nav>{visibleMenu.map(({ to, label, icon: Icon, tone }) => <NavLink key={to} to={to} end={to === '/'} onClick={closeMobileMenu} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}${tone ? ` ${tone}-nav` : ''}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
        <div className="sidebar-help"><NavLink to="/dicas" onClick={closeMobileMenu} className="tips-button"><Lightbulb size={18} /> DICAS</NavLink><NavLink to="/como-usar" onClick={closeMobileMenu} className="howto-link"><Scale size={18} /> Como Usar</NavLink><button type="button" className="fm-assistente-trigger" aria-label="Abrir robô para tirar dúvidas" title="Robô — Tire suas dúvidas" onClick={() => { closeMobileMenu();
        const width = 704
        const height = 623
        const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
        const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
        window.open(
          'https://cloud.activepieces.com/chats/Odqvny7ajdtEmRvsSJmRt',
          'fm-assistente',
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
      }}>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABECAYAAAAiL3M8AAAdMklEQVR42u2beZxdVZXvv3ufc+58a64klUplnghJSEiY5ylAaFECREVBbBnatlUUUdSnD/Wh0k0/sUWhG7QNiI0gIAQEmSLzlAEShkxkTlWl5lt3OtPe6/1xKxHf6/Y9haDdj/W551P33rM/9bnne9bae/3WXgfes/fsPXvP/nym/hJ/lIjof1lFfvMAWevguRYZ20z1zPkUpyjl2/8fAZ14Xffc2EmfUKmUDy1Xw+lBYEZbRVbQjtJaXFcHCVcNppKJnfmcu3ZMQ/KphQdknrtinur5LwtocLA6KY7tadVq9bT7V3We8s0ndLq3YLFiEAEcBdpBKRA02tFo18VNpMhmHBqyTldbY/I3B4/P/PiHZySeNvJfBFCpFBwcBPYzYVA903OcRkcLKSfmW79cb7/9VBayGRKeS9J10I4GASuCESESS4QLyQRYo1UsNKdtPLs9tbw5G1x114Uda//TAhKR1mIx/lJ5uPhJ19UZsRFaY7VWeK7DUKHI6T/qpJyewNhUQDahwEniqzRFlaQQCIVqSMkPCK1FShXG2l18aF5SLZzeprxEcrClLnXBCXPq7/9PByiKopPLVfmhxHZ6WC0iJrBeIoHjOKIUKAVewlMv/OZRWH8D46bn8NJpQpOiGGbZU2pgQ7GDVf6BPBdPZ/OuPt7XuovvLp1Ie2sD1UiISWpJpErppPPNljrnWqWU/KcAVA3ii/2q/X4UBGllqtZ1ALGIGDwv8Xs/J6ENie6nINqGNUWlpQSqKDAMYYFydx8rnhvFho5LuPDsQ3FdjyA0GBHiGGJxdTLXgOupn4yq159SSvl/0YBqcOSGoFJxPBUYR1vleS7JRAKxMa7ngdYjMUjNlbQHFrAxxBFxUEH8ISQYgHAA5dRhmw/AtwpjLdZK7RCIjVCuxiqZa1KiuW2gM/PxhQtV9BcJKIqiRWVf3euXqymPqsmlPRKeq/b09rFx8xY2bdpGT/8Qw2WfKIxRWpHwHOpyaRob8rS2NNWO1haamprJ19XhJVKIWOKgShjFGGOx1iJAGEQEQYh2PWLxcLPN2nXs1e2tyf/2FwdIRFqLpfj5ILCTXVu2+YzL2nWv8a//tpytnQV0th0324xK5IlioVT2KRWHqRYL+JUCfnmIOCiD9UnomPqsQ/uYRmZOHc/8OTOZfeAMJk7oIJ/LEseWYrFIHBvcRBJrIYyFwLgqma+39XXeB+pT6v6/GEBX3ra98cJjmq4bXZe+QMKS9XTIdT/6Kfc88jIfO//DtE2cy6s7StLTP8xQoaDKpRLlSlH8cpmoUlFR6BOGVeIglDgKqX0uqTAoE1TLSFwhk7BMHNvEMUfM49QTj2b+vNk0NDRS8X2iyBIbIYwVkqjTyYy3eWyje5hSauDPDuie33bPueaBrT/+3kenHDK9LWm1VPnclVfzxLph/sdVVxJKkidWb5fuPXuolAr45TKBXyEOQ+IoUCYOkdiKsRE2HjlsjLURYmNlrRGxMXEcEvhVAr+kkjpm4dzJXHzBOZyx+BQcx6MahMRGERiXbHOzTnrmqqaM+40/GyARUX27er50zQPdX3ns9f788ssPtI31ab757Wu5/pevsnjp3+A6Srq79qjC4IAUqwFhGGLKg2hTRWyMiEWsRazB2hgYeW8iRAwiBmvMyDiDjIwxxhD4vrJRidOOP5jvXPVFJkwYT7ka4kcanW7QmbzTNSrnzFVK9f0x1+W+U4A2PfvSZ3Jjx33ngS0xx85stC0NGZ55/nl++PMnmXzwWXR27pLSYB+lSkzLgtnq6EVzSNWleeanD7Pz0YfFdQwKGbn4GMEqRBBrRKxFRABBrFEiFhEriNS+FyGZ8ESSTfx6xStqy/bLuOXGa5g0ZSphHBOFvvWSdW0VY84G/vmPuS79TsC54dwT2ytrH/pqV8ky5DbYE2bmERvzg5vuQGXG42mhd/sm+rp3037ifGaftZBtr+9k9a9fZHD3LuK4rKKgROgXiYKSisMqcRgQhwEmDjEmwpoIE8dYY7DWihUIrUfVpgnFw4pCTEw6nZH1m3r47JVXUykVcTSIMYQhGKuW/LHX9o54UFAeXDqpPWp9pJqx8ycmmd0W8PqGjTyxcgsNYw6SYn8n5eF+AmPYsfJlWXPPgyoc7EWZULT4OMQYsVDzBqmlRCIKYeRVOzfyPQKxSjD5zCVq8tEH8cZjq9m+4jGccqdgAlL5vDy3arO6857lXPDR86iWDIFvsNh5L27a1XHotHE730UPEt2cqiypmziRF7YFVEplWusTrHj6JYq+RtmQ4tAe/OogcXWQnjUvEA50YTFYZREEY8yIZ9TmHmtixBissVhravONWEREYUWJGAQh8gPS9fV88OqLOO6KTxOnWhWA67q0jp8ldz3wBEG1glYWYmtvuPPVUVfcVnroWw9VjnzXPOi8A07saGjQc6JcO89sL5MwFdJuhmdeXIfjuER+QQXVgkTGqMDJYVon0TJ9JvnmPIWeQdW34XW8oW3iBEMoa0BkRECpkRVE9qbY8tZ0W0sk2x5eLpsff0o1zzqIxV++kPFHH8uOB2/HiUJyuRzdA/3s7uxk9NhJ9PUOcNuTXXZ32DrrpKk7bhORM5VS6/Y7oDGpoamjR+fq+4OcbNw5zKJJhsCvsHFLJ1pZifySiqJQVRPNNB++iLP+ZhFz5o4indT4geX5Z3dxxz/coaJNT+H6gzXNALXo2kdIanJW6Vq4aY2IVijBM4My+MqT6q7P7cRzEcdxlTGhhH4J103T3dPDuI5JbNjRw1bTwph02S6ZN2ZiX1/wYFFkcV6ptfsVUF4Ptze3dNBTSclgf4kJc1MMDhXoHRgESRKGVfFVWrUcfgqf/vsPMmlMkqimVanLaRYtGo+Vpdx2ZTeqe41SEoww2Tf51DApDUphvDQ21YpqbBMvnVLhcEExtJugazNh5KMkFrGGOApwEznK5SrKxmwdiMi0dXDS6K1MbPVsZMJ2s7XvOhE5Van/WKu9bUA5XWnI1uXZNKQwhSJtuTSFYolKxRdBESmlZMwUPvDZxYwZk+SJZ7pZ+dRWQHHI8VM47JBWDj9mPI/MOYienjdwxBeFKGRfaNX+Oi4m1URy2uEcc94iDj5iosplE3T1lHnyvjW8es+9OH2vowIfESGOfERyAijfr9IrWSaNznDGnEbS+TrklYckeurmYwvT3jcXWLXfANUlAuumsnQPBBCUaM2NwfcDTBQqq12JVZqOQxYwa34rd92+ngd/8Cvo3w4o1jwyC/utpRx55Cjap4+jZ0UKGQmvfcoeQDlYL0f2wGO5+JoLmTenEagJ/vbxWebMO5U7xjWz4trrFdHrQhwQRyEmrqpcJsVAocLy9S7FYDdzTk1ifJ9k9WHxk3scu/XJSX8I0Ntexdoada/EGXqHqhAUSLs1Ze1qwcahssbSOq6BNzcM8/D1d8KuF1DDW1DFLcj2l3jk7jXEgJtwR2pE1FasvUmjCKJdkcYpvP/zZzNvTiM9AyG/fbqbRx/rZOfOKp6CMz+ykLFHnYBx8wCYOETZkOb6HG/2VHizq0Kr6aElnyAa3EZlYBsrnnAoxX5qv85BEyYcsGmA6WZgaEgTFcWxEelUmsaMgz8UoU2R1+66hw0PP4HZvg7lD9cmIDTYPXS/9ALPPzWbXS+/BlGxdk7s71SQAqsSasy8eRx+7HhefbPEsmsep+eVtWBCMh1TWPq5RRx5bBtzTz6YzkfvA9VDFEYql3JoaqjjgfWDMJRg9sQqnnZQxTfo2tjDtkodB2HL+xXQ3M8++dr6HY88n+rqOopoSKKgSkPDWKaMylIq9jMYlsXfskqJ8lDYfQkfaBQWf/Pz/Pji7RCHtUKZ0ntzxRFGCkTTPLaJcgC3fudBep78DSocFGxMZXCLuvOfhKkHfoTWjgZIZkFp4jhm3JgmkokEL28tQSXBga0OcRjjVDayZUugSjoZ59Ps3K+A1HQVlNb85u/GZc39DV7QPjw0aOtz05kxYypD3XsY6Be0NaKUo0QpQWm1L7LFoOwAEgbM/cSlWFxevXM5lPeAjQAH6lpJpBNsfuxxrl3/Jn1vvALFLsRESqFQcZXyG6vYuOF0lFIQVRUiGGuYN2sKFT9mY2cAcZXJLaOJ/TJS2MLWbkdl8l5P20y99R0HtHLlSm/hwoX7lsbc/FNfvvumZafMbnbuHC4MH0hUtccvOpVXX3iO0VlNTylGaRElSolStQsHUBbEgE4xsLufj3/vEuYtWsC6FesoDgzTOKaJOScdxCsPPMeam24k2PYKihis3ZsqoUwIhW089ZP7wUaoSg8illQqwRELZrGta4DdfWVyOmJUfhxxqR9/sJNBP8v4CXqNc+qv+t8xqbF1q6QKg6UbD5o2bXVp04vnv/Xckos/9saEUemzHQmfiYr9+vCD5zDn2JNo8GLVlHUVYhCJRYkVJBbE1GrONkKZCrt++xDLvngruXyKcz+/mE9cfR4nfvQ4try8jVfvfwRlq6i4BFEFTADGBxMgsY+q9LL1V7ew9d6focIhrDHMmTmBmVMnsX5bH36xzOh0laQWpNxHuVAklUwya3J6ubVvM5MWkURpqHRUVIneNIlCa9JNXIrWWLHXyYY7Hlczlu7eO/a2n3x9w8+Ka8/uW79rlQnD9k9f8jE7NFzh6adewM17argaSxCbvSJCBF1by+MqutTJjl//nBuffZps+wTcZIJSTy9mzzaodqOiCthIkBHNoURq/0cUNkBTRMSilaA8lw+fdRLGWjbu7IewRGvaARNDtR+iWC+cmuhceNIB17xtqVEuVK/J1eUu6yt1bh/qLn6tmkz4qXQqFVXCpigYmg3s/r05KT93T/D68q84w33LTJRV//3yS+XWKZO58+5fY21BJVwRPzLERqh5lRIwiI2VMiH4A5R7Xtt7e1A2BhOCGNmbPCqQ32XZNXWPEhytlCiHU49bwHGHL2BwqMyWzgLEVVoyOeIgwq+UVUcuTfMRE7+v5n2j520BkjvucAbLQyeLDUkmkxNUPHD8fY889uBrb+44a+OmLdQHndOA3+wdv3vlyszYdleptnm3VNfcPsORwlf6ylV10Vkn2hOOnM+d969gxVMvqj09A8TGYqyIMRZTU+u1jS3l1LbiGdlN3JtR78us9xVAak4oguNoXM9TFs2cWZP54qfOp1yJGC7HdA9WBO2Qz6S11UlF++EMDWTuajrrou/zoZvenppXS5eabWtfXuWk62e/tPplfnH3/Qc+9PyGX6TyTWc1NI0hLO1eDFwP0L9nz5H5VPImW9mig9duPi81+8NfDdbdVWw0lW8WS7u9jmzGfuHjH+CjSxbxzKrXeOK5VazfuF31DxYIwhhr7QgHMxJAIFbk96vDAkpQSqOVUlprtOMI2lFeIsmJR8/ns399Lo5yKVQthThDiYxy28Zo29iM2zplQ6U+d3PTcYder5QK/uRyR39/pSPpqc9XS6WNXqn7W5/51j8c++wbvZPKVX/h8YfObntm9evxUL9xOkY1HbxtzbNHTZh3xAuFnt4bvHR2FmEOZWWxiKxJzF7y3Wj9/S8niv41vl+ZO1go0SAJ+74j57D4mAX0Fkps2LqLV9dvYfPWHezu6qV/cJhKNSCKYowVtTcnUkoBSpRSCq3RWpNMJmhqrFezZ07kfScfzUEHzKBcCRmsKsqqHtPcpkdN7owT+RmbSmNy/zjziPE/b1Oq/LaL9oW+oZvqmusv8oeGicvFy0cd9lHT1FR/nWjXTmiy9vSTjmHi+DZ9xMFzdDA81HPDsjuWXXnFZ7+QyWaR/jdVLt54Tmrex+/aF6p9z9cF3T2f8EvlTwbVeFoxcCiGmlgnrbgplJvACPhhxFCxRN9ggcFCkf7BIsOlIhU/JIpiUIpkIkEum6a1pZm20a20jR5FXa6OMBJKvsEnhe824LZ06HS927VzT9+FG+yoZ390gir9KSnNv+tB/lCvxsYEQcDPfv7LK5rymYviav/O0088tONrX/hbJk+eiIkioiC0y+9dM+ruFWuv8N1l9uwTDtJTm8xLzQdmf/N7d6Hl8GHge9L79M2ma/fp7kD5fG3tUcN+WF/2QyLlEYuDFUXKTdIxeiwT2hMo7aAcB6UdrNSm572HEUVkFBWjGCpoIhKETlZJrlmlW/JksvaZ9gb9N0tmjn71Hd+b37nqybklXz106/0r2n724Bo8wqF/vvbKxHFHLUiFoSGKQgAcrXj26Wf40j89QKlSwRt4TS+eVX/mP979+PL/IGXIAe5voXT8pgfHLLtv01e39RQuashnHM9zJV9Xj5dM43hJcBKg3ZqSVxorGotClIPVHjEJYp3WxstivCySykECqWvw1jZkzI0HT+xcNl6Nr75dpfDvelDHgmPX3v2Dbx//i7uW31LwvcO++KnzGo4/aqEMD5fkrVUIG1sWLpjP6Ye/zq2/uE+PzdrXzp/kPP6P/zuYrnXHm/6df3f39d875HsPdWWdcbN2XP++1Lbb7nn4xDelTrtipWf3Turq6sg7VZoaGmlsaKS+oYlcvolkpg43mUGn61BeBnGTZJo6xM00bMfJDCQyyd25Om91Sz2PHzKJFyYp1+cdsj+4cXjk/CPHnvpXpz/zyUs/MRGUHUk+9gECSCUTgGXti8/pdLTpngXv/8KSt3iMY3ve+IYudX3x4ed2eR++9lnyupdffmUxPVu3cd4Pnha8hFi/gG893PxootIejImRoApRFTBoG+Akc+ixJ6CH1kHDJDrOv5YTF7bcN5ber3/9lDHr2E/2B5f5Z9c82/nAHTc+W65UJkYCruuglGZvmqKVomoNoR8we2oH9Sr8vfpu3Lvpuy7+F7oqOf7219pWgxLLv3YUszuauL3TUsjPIjX0GqphJma4Eycqk2loA+0QBAFhqR/xh7GSxabGQGE3qCZoOoGNr/WjNB+49OD0CU/vkO8d1cG3/1DpdL8AAlClzu/7fmpJVedTbippXcep1c8RlFIYE2MCn+LuVbJt7S1LZeiXt6iGc7ZIedeZFHo/b1VG7t0SS5ev+NxpjRx56MEMhjnmzh9D3QQYFoFMC4kJx1LX1MzAjvXYygDoEriNNYkRFMFESL4dMlPxXOGMjm4+dFDW5jKZ+kKJq57rpA64fG+69K4Baph/2otdz9799TCIvz3sp7VyXBytamUaEbQxFDo3cNs/L5OLD+k/gL7SD0XkHLv10S+ayNHVVNYue7qHpuHVfOqDp1DxRiGJFDOaEnz5Qw5fvW80NijSNn02+bo6+k0WO9yHqg5BtR+p9kN+AuSn4WXSnDwjyScWTWTWxFFE1qV3sNfeetPtqtQw5ZNPrh6c0dGcaszlnLtbmrwblFKV/Q4IoO3IJf/wwo1fml/OTf2wkxtlreNhjWF4sI81r7zCvU+/zmQdMm3hRItqO41t91+x+v77pv39rzZw+ImnseXVJEtmKsZOmEbBZHDcBNZxuOyvJjNtUgsrtivlusjqXZZMYxNFJ4mkG8G042RSTGrJsWi6x9IFeeZOqMdYqPgRVT/k5h/fyO0PvSJfv+ITqQPb9BlxVCEZuEcGrzx8mgz9aKlq+NvB/Q4INPUDz+RuuuUhdrjtpPM5SqHQORTh2zTHja/nytOGqJ9xDr4eg1ve+qk1hfb06kK/PHPb4wSk+OClHyJWSZxkGpRGKY1ozdmHj+Wsw7R09ZXY0hewfTBFXznGitCc0Uxtdpne6tGY9YisEAQx2Jhs2uORx1dwx1ObOGrRqXz6w0dLMmklnXaIh4dI8tjJz/+w9+9BX1wr7+9XQDDj9I/VX578IT99spNtzKCuZTQLJw1wzIRdHDfXIznuIoZyx6MktAnqWs6/YInYUVPki1ffyOh8kYOmjCI04KYS7K04O4kUVqdAoL0pR3tjmmP2bmlYg0URWyE2lmosKBFcz8FaQ6lU5ef3rWD0vNO55Jz51OUzVMO4VoPz0sTJsdK565WPX/ahL//bdbdf/fh+BmSppqb2Tz/py1x90CMEfi+idpDKNULuTArJwxnQzVCtkkq4xDZp3UrAOacs5NafN9Pklci6CcpGk0Shda3ubDc/TjS8Gp1uwLp1iM4iTh6bbMbWT8Bq5y37hyJKo/a2wqx9bRNrdweMO2wMC6c1E0R79/ItYsGkF8icmb9yXnxo4+WIrOBPbAn+f/Yg14ufGwrHnVWouxivWYHSRCpJhIMJQ5QtoRWIiXCsy+qVLzPtgANZOLODylAPw2GKKGFxja2FWFDBPv8NUm1diG5H2QwSGfAD9NAwkT4JOfoq7EgPkIgQhgaxQhAaHn9qJX0VzbhKDw1ZjyCMRuBYxApFJjNx4aEc88azRzdecGXHlbBjvwLyVHivDfyvV8rpbOwkxSgHIfhdyQbBURCFiqSGB55cwykkySdTOLl6NVhFkslaN5hSCu0l0dMvJN56O7o4DM4QEEAcooaHkfwQJo4xgFjBWquMtSgRtuzqp7NrN0QBSVvExDG+MXuTU8QKIUDduXbx0v6644crJ195Kz/Zr4DUlDM2FlffeVvO1Zd2l2Mxjoco9Xu9OwpwtaIYR7y8aSfTJk6kWo10IpW3Jd/gxIY4NmitQSu8wz6Onb2EsNgPwTD4Q0hQxKoE8ajZGGv29UCbEc/oGyxTLJVpacpDZRvlwW6GCmU8z8V1NFopBMHGhmqUJ6j7HM6o1Anwg/0LCCDXKFeVi4MnJUx2aiGIrVV6RF3/bh/d1Zr1b+6ku3cIE1mdzDRvaWppfrRSjS7JWrFxFOO4DqBrjZvKw+RGI9lRiFBT7SK15s3IYPc2iovgBzG7uvtpaciQy2Qg6GPX9q1s2rqb1qYGBvoH6NrTg+c6jGppoi6XxUs1kPRaGvf7KgagJi3tDtf89CNRWLwvCtOjBwJljdL7JlJrBYur7njwt+qo6e3UN4zq6Zg59YK//s7Psl/ONl2ypK2VKIxwPAerNcZYROw+CLX3e7vm7Uho1bwnNpYdnf3k0h5BEDK+YzxJ289Ql+KW2+9h3JgxPLJyIwdOHsVRcyfT17eHPb0FlWsc68888KB/fVcAASTmX/hisPIni60dvskjeXB/RVGJBEEj2uWFl19mPD3VDxy3+AnVfsCX3n/uEWtnHPelifes7CweO29SvtV1rXIctKP2aeV9k+vIZLzXY94aXr39BVxd2w0L/ICGxhbmTOtg5ap13Lu8i8zkI/jWZR/h/DMOwXM0w8NFdu7upS/IOAfMnlV41wABJBf+9Wp59frjUl3x+W4Un1O0ui02ek8x9m63u1e/fsW5R/bPuejy10VqCdr641M7Jj/dv+7lN3uOPKE+S1VpHFf/ru9w5HkwecthhVprnhWGixWMMWgFG7Z288RLm5k6NsfChUczHHqqu6S58pL3y9JT5hOEEYFYjBUa6rKScxo93/cvAB79s3Xay6t3JNTspeEfGnPA8Z/7zCEHTfn+ZecssDqZwUt47K2dWGv39W/WwrXmObExVKoBvh/gOg6vv7mL7y7fQdfOfg6bGDJ/QpPSo2dEWVswi4+bl2puzEsm5TLSX6SiIKZ3qNptM6MvO+7Qcb941zzo/6D8f4EDkHETy17ZuP2jnd0TD2lqFpyEZ7WuVQbeCqUWWhZjLJGxFEsVPNele08PP3hoG129kaCN3jZg1QHTWhg//sD/me5fc0glsCflglg5ShGFPiaO11erwS8LAwM3/9U5C7a/qyH2p9iqR68pZGZ97MzOnTuuynrqXJ3KNeF4WMCI/O6xphEvMlaoBiFYqJbL3P7bzWzuDNGmgrJ+edA2rFtfqfvpv35s1r987apnP9LT3efaqNqddPVaMfL0noHtqy644ILy2775/BnsvmXLxqtUwwmR6GME5wAjtBmROiukrBVHVK3b169WI9fR5Q1vbhu87sGduyLjvK6tv9JV0cpw3ehN8I39/oT4X8Rj4TfffHPemGRO62Q2jkmIWO04blypRL4xw6Ubb7ynuHnzQwHv2Xv2nr1n79l79p69Z++c/S/qJSokeIrtxQAAAABJRU5ErkJggg==" alt="" aria-hidden="true" /><span>Robô — Tire suas dúvidas</span>
      </button></div>
        <div className="sidebar-user"><div><strong>{profile?.displayName || 'Usuário'}</strong><span>{profile?.email}</span></div><button type="button" onClick={() => { closeMobileMenu(); void logout() }} title="Sair"><LogOut size={17} /></button></div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={guarded('/', <DashboardPageEnhanced />)} />
          <Route path="/despesas" element={guarded('/despesas', <><ExpensesPageStorage /><ExpenseSettlementPanel /></>)} />
          <Route path="/alvaras" element={guarded('/alvaras', <ReceivablesPageStorageV2 />)} />
          <Route path="/repasse-alvaras" element={guarded('/repasse-alvaras', <AlvaraTransfersPageV3 />)} />
          <Route path="/repasse-societario" element={guarded('/repasse-societario', <SocietaryTransfersPage />)} />
          <Route path="/nota-fiscal" element={guarded('/nota-fiscal', <FiscalNotesPageV3 />)} />
          <Route path="/comissoes-agentes" element={guarded('/comissoes-agentes', <AgentCommissionsPageV4 />)} />
          <Route path="/tesouraria" element={guarded('/tesouraria', <><TreasuryPage /><SocietaryTreasuryPanel /></>)} />
          <Route path="/aprovacoes" element={guarded('/aprovacoes', <ApprovalsPageEnhanced />)} />
          <Route path="/dre-gerencial" element={canViewManagementReports ? <DreGerencialPageV2 /> : <section className="page-card" role="alert"><h1>Acesso não autorizado</h1><p>Seu perfil não tem permissão para consultar a DRE Gerencial.</p></section>} />
          <Route path="/plano-contas" element={guarded('/plano-contas', <AccountsPageFernando />)} />
          <Route path="/contabilidade" element={guarded('/contabilidade', <AccountingPageStorageV2 />)} />
          <Route path="/calendario-financeiro" element={guarded('/calendario-financeiro', <FinancialCalendarPage />)} />
          <Route path="/fluxo-caixa" element={guarded('/fluxo-caixa', canViewCashFlow ? <CashFlowMonthlyPage /> : <section className="page-card" role="alert"><h1>Acesso não autorizado</h1><p>Seu perfil não tem permissão para consultar o Fluxo de Caixa.</p></section>)} />
          <Route path="/conciliacao-bancaria" element={guarded('/conciliacao-bancaria', <BankReconciliationPage />)} />
          <Route path="/documentos" element={guarded('/documentos', <DocumentsPageStorage />)} />
          <Route path="/usuarios" element={guarded('/usuarios', <UsersPageKitFernando />)} />
          <Route path="/auditoria" element={guarded('/auditoria', canViewAudit ? <AuditPageEnhancedV2 /> : <section className="page-card" role="alert"><h1>Acesso não autorizado</h1><p>A Auditoria é exclusiva do Administrador Master.</p></section>)} />
          <Route path="/utilitarios" element={guarded('/utilitarios', <UtilitiesPage />)} />
          <Route path="/configuracoes" element={guarded('/configuracoes', <Configuracoes />)} />
          <Route path="/dicas" element={<TipsPageEnhanced />} />
          <Route path="/como-usar" element={<HowToPageEnhanced />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const { user, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <LoginScreen />
  if (!profile || profile.status !== 'active') return <PendingScreen />
  return <AppShell />
}
