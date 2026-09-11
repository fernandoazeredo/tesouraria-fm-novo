import { useEffect, useState, type FormEvent } from 'react'
import {
  BarChart3,
  BookOpenCheck,
  Calculator,
  CircleDollarSign,
  FileCheck2,
  FileText,
  FolderArchive,
  Handshake,
  LayoutDashboard,
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
import { useAuth, type UserRole } from './auth/AuthContext'
import { TreasuryPage } from './pages/SystemPages'
import { ReceivablesPageStorageV2 } from './pages/ReceivablesPageStorageV2'
import { ExpensesPageStorage } from './pages/ExpensesPageStorage'
import { AccountsPageFernando } from './pages/AccountsPageFernando'
import { DocumentsPageStorage } from './pages/DocumentsPageStorage'
import { DashboardPageEnhanced } from './pages/DashboardPageEnhanced'
import { ApprovalsPageEnhanced } from './pages/ApprovalsPageEnhanced'
import { AccountingPageStorageV2 } from './pages/AccountingPageStorageV2'
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
  { to: '/dre-gerencial', label: 'DRE Gerencial', icon: BarChart3, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/plano-contas', label: 'Plano de Contas', icon: BookOpenCheck, roles: ['master'] },
  { to: '/contabilidade', label: 'Contabilidade', icon: Calculator, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
  { to: '/documentos', label: 'Arquivo de Documentos', icon: FolderArchive, roles: ['master', 'diretor', 'gerente', 'tesouraria', 'operador'] },
  { to: '/usuarios', label: 'Usuários', icon: Users, roles: ['master'] },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, roles: ['master', 'diretor', 'gerente', 'tesouraria'] },
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
            <label><span>Senha</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Mail size={18} />}{mode === 'login' ? 'Entrar com e-mail' : 'Criar acesso'}</button>
          </form>
          <div className="auth-divider"><span>ou</span></div>
          <button className="google-button" type="button" onClick={googleLogin} disabled={busy}><GoogleMark />Continuar com Google</button>
          <button className="text-button" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Primeiro acesso? Solicitar cadastro' : 'Já possui acesso? Voltar para o login'}</button>
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
      <section className="page-card"><span className="eyebrow">Dados institucionais</span><h2>Configurações do Aplicativo</h2><p>Cadastro utilizado nos demonstrativos, relatórios e documentos gerados pelo sistema.</p><div className="settings-grid"><label><span>Razão Social</span><input value={companyData.razaoSocial} readOnly /></label><label><span>CNPJ</span><input value={companyData.cnpj} readOnly /></label><label className="settings-full-width"><span>Endereço</span><input value={companyData.endereco} readOnly /></label></div></section>
    </>
  )
}

function AppShell() {
  const { profile, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const accessRole = accessRoleFromUserRole(profile?.role)
  const visibleMenu = menu.filter((item) => !item.roles || item.roles.includes(accessRole))

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-lock', mobileMenuOpen)
    return () => document.body.classList.remove('mobile-menu-lock')
  }, [mobileMenuOpen])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <div className="app-shell">
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
        <div className="sidebar-help"><NavLink to="/dicas" onClick={closeMobileMenu} className="tips-button"><Lightbulb size={18} /> DICAS</NavLink><NavLink to="/como-usar" onClick={closeMobileMenu} className="howto-link"><Scale size={18} /> Como Usar</NavLink></div>
        <div className="sidebar-user"><div><strong>{profile?.displayName || 'Usuário'}</strong><span>{profile?.email}</span></div><button type="button" onClick={() => { closeMobileMenu(); void logout() }} title="Sair"><LogOut size={17} /></button></div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPageEnhanced />} />
          <Route path="/despesas" element={<ExpensesPageStorage />} />
          <Route path="/alvaras" element={<ReceivablesPageStorageV2 />} />
          <Route path="/repasse-alvaras" element={<AlvaraTransfersPageV3 />} />
          <Route path="/repasse-societario" element={<SocietaryTransfersPage />} />
          <Route path="/nota-fiscal" element={<FiscalNotesPageV3 />} />
          <Route path="/comissoes-agentes" element={<AgentCommissionsPageV4 />} />
          <Route path="/tesouraria" element={<><TreasuryPage /><SocietaryTreasuryPanel /></>} />
          <Route path="/aprovacoes" element={<ApprovalsPageEnhanced />} />
          <Route path="/dre-gerencial" element={<DreGerencialPageV2 />} />
          <Route path="/plano-contas" element={<AccountsPageFernando />} />
          <Route path="/contabilidade" element={<AccountingPageStorageV2 />} />
          <Route path="/documentos" element={<DocumentsPageStorage />} />
          <Route path="/usuarios" element={<UsersPageKitFernando />} />
          <Route path="/auditoria" element={<AuditPageEnhancedV2 />} />
          <Route path="/utilitarios" element={<UtilitiesPage />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
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
