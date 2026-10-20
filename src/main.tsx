import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { AgreementHelpAdditions } from './components/AgreementHelpAdditions'
import { CpfCnpjValidationEnhancer } from './components/CpfCnpjValidationEnhancer'
import { DreAccountSearchEnhancer } from './components/DreAccountSearchEnhancer'
import { DreRegimeViewEnhancer } from './components/DreRegimeViewEnhancer'
import { DynamicAgreementInstallmentsEnhancer } from './components/DynamicAgreementInstallmentsEnhancer'
import { ExpenseFormSemanticsEnhancer } from './components/ExpenseFormSemanticsEnhancer'
import { ExpenseFiltersPanel } from './components/ExpenseFiltersPanel'
import { ExpenseSettlementPanel } from './components/ExpenseSettlementPanel'
import { InstitutionalDisplaySync } from './components/InstitutionalDisplaySync'
import { InstitutionalSettingsEditor } from './components/InstitutionalSettingsEditor'
import { LaborAgreementReceivableLauncher } from './components/LaborAgreementReceivable'
import { NavigationCopyEnhancer } from './components/NavigationCopyEnhancer'
import { OtherRevenueReceivable } from './components/OtherRevenueReceivable'
import { RevenueTypeChooser } from './components/RevenueTypeChooser'
import { SocietaryRouteAccessGuard } from './components/SocietaryRouteAccessGuard'
import { ThemeControls } from './components/ThemeControls'
import './societary-transfer-error-guard'
import './styles.css'
import './button-label-fix.css'
import './workflow-additions.css'
import './responsive-shell.css'
import './alvara-controls.css'
import './financial-controls-v3.css'
import './theme-final.css'
import './fm-assistente-launcher.css'
import './theme-contrast-fixes.css'
import './login-compact.css'
import './cpf-cnpj-validation.css'
import './dre-regime-view.css'
import './dre-account-search.css'
import './labor-agreement.css'
import './other-revenue.css'
import './brand-mm.css'
import './agreement-installments-actions.css'
import './login-footer-kill.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeControls />
        <SocietaryRouteAccessGuard />
        <CpfCnpjValidationEnhancer />
        <ExpenseFormSemanticsEnhancer />
        <DreAccountSearchEnhancer />
        <DreRegimeViewEnhancer />
        <DynamicAgreementInstallmentsEnhancer />
        <InstitutionalDisplaySync />
        <InstitutionalSettingsEditor />
        <LaborAgreementReceivableLauncher />
        <OtherRevenueReceivable />
        <RevenueTypeChooser />
        <AgreementHelpAdditions />
        <App />
        <NavigationCopyEnhancer />
        <ExpenseFiltersPanel />
        <ExpenseSettlementPanel />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
