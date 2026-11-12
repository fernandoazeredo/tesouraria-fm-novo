import { Landmark } from 'lucide-react'
import { bankAccountLabel, getBankAccount, useBankAccounts, type BankAccount } from '../data/bankAccounts'
import { useInstitutionalSettings } from '../hooks/useInstitutionalSettings'
import '../financial-movement.css'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

type FinancialMovementCardProps = {
  mode: 'receipt' | 'payment'
  bankAccountId: BankAccount['id']
  onBankAccountChange: (id: BankAccount['id']) => void
  movementDate: string
  onMovementDateChange: (value: string) => void
  amount: number
  paymentMethod?: string
  onPaymentMethodChange?: (value: string) => void
}

export function FinancialMovementCard({
  mode,
  bankAccountId,
  onBankAccountChange,
  movementDate,
  onMovementDateChange,
  amount,
  paymentMethod = '',
  onPaymentMethodChange,
}: FinancialMovementCardProps) {
  const institutional = useInstitutionalSettings()
  const active = useBankAccounts()
  const selected = getBankAccount(bankAccountId)
  const options = active.some((account) => account.id === selected.id) ? active : [selected, ...active]
  const holder = selected.holderType === 'PJ' && !selected.holder ? institutional.razaoSocial : selected.holder
  const isReceipt = mode === 'receipt'

  return <section className={`financial-movement-card ${isReceipt ? 'is-receipt' : 'is-payment'}`}>
    <div className="financial-movement-heading">
      <Landmark size={20} />
      <div>
        <span>Movimentação financeira</span>
        <strong>{isReceipt ? 'Recebimento' : 'Pagamento'}</strong>
      </div>
    </div>

    <div className="financial-movement-grid">
      <label className="financial-bank-select">
        <span>{isReceipt ? 'Conta de recebimento' : 'Conta de pagamento'}</span>
        <select value={selected.id} onChange={(event) => onBankAccountChange(event.target.value as BankAccount['id'])}>
          {options.map((account) => <option key={account.id} value={account.id}>{bankAccountLabel(account)}</option>)}
        </select>
      </label>

      <div className="financial-bank-details">
        <span>Titular</span>
        <strong>{holder}</strong>
        <small>{selected.holderType} · {selected.bank} · Ag. {selected.agency} · C/C {selected.account}</small>
      </div>

      <label>
        <span>{isReceipt ? 'Data do crédito' : 'Data do pagamento'}</span>
        <input type="date" value={movementDate} onChange={(event) => onMovementDateChange(event.target.value)} />
      </label>

      {!isReceipt && <label>
        <span>Forma de pagamento</span>
        <select value={paymentMethod} onChange={(event) => onPaymentMethodChange?.(event.target.value)}>
          <option value="">A definir na execução</option>
          <option value="PIX">PIX</option>
          <option value="TED">TED</option>
          <option value="Boleto">Boleto</option>
          <option value="Débito">Débito</option>
          <option value="Outro">Outro</option>
        </select>
      </label>}

      <div className="financial-movement-amount">
        <span>{isReceipt ? 'Valor creditado' : 'Valor da despesa'}</span>
        <strong>{money.format(Number(amount) || 0)}</strong>
        <small>{isReceipt ? 'Preenchido automaticamente pelo demonstrativo.' : 'O banco pode ser ajustado na execução do pagamento.'}</small>
      </div>
    </div>
  </section>
}
