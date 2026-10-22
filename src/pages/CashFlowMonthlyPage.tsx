import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { db } from '../lib/firebase'
import './CashFlowMonthly.css'

type RecordRow = { id: string } & DocumentData
type Movement = { id: string; origin: string; description: string; date: string; value: number; direction: 'entrada' | 'saida'; stage: 'realizado' | 'previsto'; bank: 'itau' | 'outro' | 'indefinido'; observation?: string }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const bankOf = (raw: unknown): Movement['bank'] => raw === 'itau' || raw === 'itau-pj' ? 'itau' : raw === 'bb' || raw === 'bb-pf' || raw === 'cef' || raw === 'cef-pf' ? 'outro' : 'indefinido'
const dateOf = (raw: unknown) => { const value = typeof raw === 'string' ? raw.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' }
const numberOf = (raw: unknown) => { const value = Number(raw); return Number.isFinite(value) && value > 0 ? value : 0 }
const monthNow = () => { const date = new Date(); return String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0') }
const monthLabel = (value: string) => { const [y, m] = value.split('-').map(Number); return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))) : value }
function useRecords(name: string) {
  const [rows, setRows] = useState<RecordRow[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => onSnapshot(collection(db, name), snapshot => {
    setRows(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); setLoaded(true); setError('')
  }, err => { setError(err.message || 'Falha na consulta'); setLoaded(true) }), [name])
  return { rows, loaded, error }
}
function movements(receivables: RecordRow[], expenses: RecordRow[], alvaraTransfers: RecordRow[], agentCommissions: RecordRow[], societaryTransfers: RecordRow[]) {
  const output: Movement[] = []
  for (const item of receivables) {
    const status = String(item.status || '')
    const stage = ['recebido_tesouraria', 'encerrado'].includes(status) ? 'realizado' : 'previsto'
    if (stage === 'previsto' && ['cancelado', 'rejeitado', 'devolvido'].includes(status)) continue
    const date = stage === 'realizado' ? dateOf(item.receiptDate) : dateOf(item.dataPrevista)
    const value = numberOf(item.valorAlvara)
    if (value && date) output.push({ id: 'receita-' + item.id, origin: 'Recebimentos', description: String(item.processo || item.reclamante || item.descricao || 'Receita'), date, value, direction: 'entrada', stage, bank: bankOf(item.receivingBankAccountId), observation: stage === 'realizado' ? 'Data declarada no lançamento (não necessariamente data do crédito bancário)' : undefined })
  }
  for (const item of expenses) {
    const status = String(item.status || '')
    const stage = ['pago', 'arquivado'].includes(status) ? 'realizado' : 'previsto'
    if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria', 'agendado'].includes(status)) continue
    const date = dateOf(item.paymentDate)
    const value = numberOf(item.valorTotal)
    if (value && date) output.push({ id: 'despesa-' + item.id, origin: 'Despesas', description: String(item.fornecedor || item.nome || 'Despesa'), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: stage === 'previsto' ? 'Data informada no campo de movimentação financeira' : undefined })
  }
  const installmentRows = (items: RecordRow[], origin: string) => {
    for (const item of items) {
      const status = String(item.status || '')
      if (['cancelado', 'rejeitado', 'devolvido'].includes(status)) continue
      const installments = Array.isArray(item.installments) ? item.installments as DocumentData[] : []
      for (let index = 0; index < installments.length; index++) {
        const part = installments[index]
        const stage = part.paid === true || part.status === 'paga' ? 'realizado' : 'previsto'
        if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria', 'pago'].includes(status)) continue
        const date = dateOf(stage === 'realizado' ? part.paidDate : part.dueDate)
        const value = numberOf(part.value)
        if (value && date) output.push({ id: origin + item.id + '-' + index, origin, description: String(item.processo || item.sourceSnapshot?.processo || 'Parcela') + ' · parcela ' + (index + 1), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: 'Conta bancária não identificada quando ausente no registro' })
      }
    }
  }
  installmentRows(alvaraTransfers, 'Repasse de Alvarás')
  installmentRows(agentCommissions, 'Comissões de Agentes')
  for (const item of societaryTransfers) {
    const status = String(item.status || '')
    if (['cancelado', 'rejeitado', 'devolvido'].includes(status)) continue
    const stage = status === 'pago' ? 'realizado' : 'previsto'
    if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria'].includes(status)) continue
    const date = dateOf(stage === 'realizado' ? item.paymentDate : item.dueDate)
    const value = stage === 'realizado' ? numberOf(item.paidValue || item.transferValue) : Math.max(0, numberOf(item.transferValue) - numberOf(item.paidValue))
    if (value && date) output.push({ id: 'societario-' + item.id, origin: 'Repasse Societário', description: String(item.processo || item.beneficiary || 'Repasse societário'), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: 'Conta bancária não identificada quando ausente no registro' })
  }
  return output
}
const sum = (items: Movement[], stage: Movement['stage'], direction: Movement['direction']) => items.filter(item => item.stage === stage && item.direction === direction).reduce((total, item) => total + item.value, 0)
export function CashFlowMonthlyPage() {
  const [month, setMonth] = useState(monthNow)
  const [scope, setScope] = useState<'itau' | 'indefinido' | 'outro'>('itau')
  const sources = [useRecords('receivables'), useRecords('expenses'), useRecords('alvaraTransfers'), useRecords('agentCommissions'), useRecords('societaryTransfers')]
  const [receivables, expenses, alvaraTransfers, commissions, societary] = sources
  const rows = useMemo(() => movements(receivables.rows, expenses.rows, alvaraTransfers.rows, commissions.rows, societary.rows).filter(item => item.date.startsWith(month)).sort((a,b) => a.date.localeCompare(b.date)), [receivables.rows, expenses.rows, alvaraTransfers.rows, commissions.rows, societary.rows, month])
  const visible = rows.filter(item => item.bank === scope)
  const plannedIn = sum(visible, 'previsto', 'entrada')
  const plannedOut = sum(visible, 'previsto', 'saida')
  const actualIn = sum(visible, 'realizado', 'entrada')
  const actualOut = sum(visible, 'realizado', 'saida')
  const pending = rows.filter(item => item.bank === 'indefinido').length
  const loading = sources.some(item => !item.loaded)
  const error = sources.map(item => item.error).filter(Boolean).join(' · ')
  return <section className="cash-flow">
    <div className="page-heading"><div><span className="eyebrow">Tesouraria · consulta</span><h1>Fluxo de Caixa Mensal</h1><p>Previsto x Realizado · sem editar lançamentos</p></div></div>
    <div className="page-card cash-flow-disclaimer"><strong>Fase 1 — demonstrativo gerencial, não saldo bancário.</strong><p>Os valores seguem os registros existentes, não um extrato conciliado. Não há saldo inicial ou projeção de saldo final. Recebimentos realizados usam a data declarada no lançamento; a data efetiva do crédito pode ser diferente. Operações sem conta identificada ficam separadas para evitar atribuição indevida ao Itaú PJ.</p></div>
    <div className="page-card cash-flow-filters"><label>Mês de referência <input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label><label>Contas <select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="itau">Itaú PJ — identificados</option><option value="indefinido">Sem conta identificada</option><option value="outro">Outras contas (fora do escopo PJ)</option></select></label></div>
    {error && <div className="page-card" role="alert">Consulta incompleta: {error}. Não use totais até todas as fontes estarem disponíveis.</div>}
    {!loading && !error && <><div className="cash-flow-grid">
      <article className="page-card"><h2>Realizado · {monthLabel(month)}</h2><p>Entradas: <strong>{money.format(actualIn)}</strong></p><p>Saídas: <strong>{money.format(actualOut)}</strong></p><p>Resultado do mês: <strong>{money.format(actualIn - actualOut)}</strong></p></article>
      <article className="page-card"><h2>Previsto · {monthLabel(month)}</h2><p>Entradas: <strong>{money.format(plannedIn)}</strong></p><p>Saídas: <strong>{money.format(plannedOut)}</strong></p><p>Resultado previsto: <strong>{money.format(plannedIn - plannedOut)}</strong></p></article>
      <article className="page-card"><h2>Conciliação necessária</h2><p><strong>{pending}</strong> movimentações do mês sem conta identificada.</p><p>Valores não presumidos como Itaú PJ.</p></article>
    </div>
    <div className="page-card"><h2>Movimentações — {monthLabel(month)}</h2><div className="cash-flow-table-wrap"><table className="cash-flow-table"><thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th>Tipo</th><th>Etapa</th><th>Valor</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} title={item.observation || ''}><td>{item.date.split('-').reverse().join('/')}</td><td>{item.origin}</td><td>{item.description}</td><td>{item.direction === 'entrada' ? 'Entrada' : 'Saída'}</td><td>{item.stage === 'realizado' ? 'Realizado*' : 'Previsto'}</td><td className="cash-flow-number">{money.format(item.value)}</td></tr>)}</tbody></table>{visible.length === 0 && <p>Nenhum lançamento com data e conta bancária compatíveis com os filtros selecionados.</p>}</div></div></>}
    {loading && <p>Carregando movimentações...</p>}
    <p className="cash-flow-footnote">* Realizado significa status financeiro registrado no aplicativo; não substitui a conciliação com extrato. Registros sem data válida não entram no total. Repasses e comissões não são descontados novamente do valor bruto do recebimento: aparecem como saídas próprias.</p>
  </section>
}
