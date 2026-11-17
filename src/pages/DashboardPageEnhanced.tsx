import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, ReceiptText } from 'lucide-react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../lib/firebase'
import { isEffectiveAlvaraReceivable } from '../lib/receivableClassification'
import { movements } from '../lib/cashFlowMovements'
import { PERIOD_LABELS, chartMonths, dueSoon, expenseDate, forecast30, inRange, monthlySeries, pendingTransfers, periodRange, revenueDate, topAccounts, type Period } from '../lib/dashboardMetrics'
import './DashboardPageEnhanced.css'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
type AnyRecord = { id: string } & DocumentData

function useLiveCollection(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, () => setRecords([])), [name])
  return records
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function readPeriod(): Period {
  try { const v = localStorage.getItem('dashboard-period'); if (v === 'mes' || v === 'trimestre' || v === 'semestre' || v === 'ano' || v === 'tudo') return v } catch { /* sem armazenamento */ }
  return 'ano'
}

export function DashboardPageEnhanced() {
  const expenses = useLiveCollection('expenses')
  const receivables = useLiveCollection('receivables')
  const agentCommissions = useLiveCollection('agentCommissions')
  const alvaraTransfers = useLiveCollection('alvaraTransfers')
  const societaryTransfers = useLiveCollection('societaryTransfers')
  const classifications = useLiveCollection('managerialClassifications')
  const [period, setPeriodState] = useState<Period>(readPeriod)
  const setPeriod = (value: Period) => { setPeriodState(value); try { localStorage.setItem('dashboard-period', value) } catch { /* sem armazenamento */ } }

  const range = periodRange(period)
  const approvedAll = expenses.filter((item) => ['aprovado', 'pago', 'arquivado'].includes(String(item.status)))
  const effectiveAll = receivables.filter(isEffectiveAlvaraReceivable)
  const approved = approvedAll.filter((item) => inRange(expenseDate(item), range))
  const effectiveReceivables = effectiveAll.filter((item) => inRange(revenueDate(item), range))
  const rejected = expenses.filter((item) => item.status === 'rejeitado')
  const expenseTotal = approved.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const rejectedTotal = rejected.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = effectiveReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const balance = revenueTotal - expenseTotal
  const pendingExpenses = expenses.filter((item) => item.status === 'enviado_aprovacao' || item.status === 'em_analise').length
  const pendingCommissions = agentCommissions.filter((item) => item.status === 'aguardando_aprovacao').length
  const pendingAlvaraTransfers = alvaraTransfers.filter((item) => item.status === 'aguardando_aprovacao').length
  const pendingSocietaryTransfers = societaryTransfers.filter((item) => item.status === 'aguardando_aprovacao').length
  const pending = pendingExpenses + pendingCommissions + pendingAlvaraTransfers + pendingSocietaryTransfers

  const allMovements = useMemo(() => movements(receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers), [receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers])
  const due = dueSoon(allMovements)
  const forecast = forecast30(allMovements)
  const transfers = pendingTransfers(allMovements)
  const series = monthlySeries(effectiveAll, approvedAll, chartMonths(period))
  const seriesMax = Math.max(1, ...series.map((row) => Math.max(row.receitas, row.despesas)))
  const classificationMap = useMemo(() => new Map(classifications.map((item) => [item.id, item])), [classifications])
  const accounts = topAccounts(approved, classificationMap)
  const accountsMax = Math.max(1, ...accounts.map((row) => row.value))
  const periodHint = period === 'tudo' ? 'todo o histórico' : `${PERIOD_LABELS[period].toLowerCase()} atual`

  return <>
    <div className="page-heading"><div><span className="eyebrow">Visão gerencial</span><h1>Dashboard Financeira</h1><p>Retrato consolidado das receitas e das despesas efetivamente aprovadas.</p></div><div className="quick-actions"><Link className="expense-button button-link" to="/despesas?novo=1"><ReceiptText size={18} /> + Despesa</Link><Link className="revenue-button button-link" to="/alvaras?escolherReceita=1"><BadgeDollarSign size={18} /> + Receita</Link></div></div>

    <div className="dash-period" role="group" aria-label="Período">
      <span>Período:</span>
      {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => <button key={key} type="button" className={period === key ? 'active' : ''} aria-pressed={period === key} onClick={() => setPeriod(key)}>{PERIOD_LABELS[key]}</button>)}
      <small>O período ({periodHint}) vale para Receitas, Despesas, Saldo, o gráfico e as contas. “A pagar 7 dias”, “Previsão 30 dias” e “Repasses pendentes” não mudam com o período: mostram o que vence de hoje em diante.</small>
    </div>

    <div className="metrics-grid">
      <Link to="/alvaras" className="metric metric-link revenue-metric" title="Abrir Recebimento de Alvarás"><span>Receitas</span><strong>{money.format(revenueTotal)}</strong><small>Alvarás recebidos · abrir Receitas</small></Link>
      <Link to="/despesas" className="metric metric-link expense-metric" title="Abrir Despesas"><span>Despesas</span><strong>{money.format(expenseTotal)}</strong><small>Aprovadas, pagas e arquivadas · abrir Despesas</small></Link>
      <article className={`metric balance-metric ${balance < 0 ? 'negative' : ''}`}><span>Saldo / Resultado</span><strong>{money.format(balance)}</strong><small>Alvarás recebidos menos despesas efetivas</small></article>
      <Link to="/aprovacoes" className="metric metric-link approval-metric-link" title="Abrir Aprovações"><span>Aguardando Aprovação</span><strong>{pending}</strong><small>Fluxo da Diretoria · abrir Aprovações</small></Link>
    </div>

    <div className="dash-cards-3">
      <Link to="/fluxo-caixa" className="metric metric-link dash-due" title="Abrir Fluxo de Caixa"><span>A pagar nos próximos 7 dias</span><strong>{money.format(due.nextValue)}</strong><small>{due.nextCount} {due.nextCount === 1 ? 'pagamento' : 'pagamentos'}</small>{due.lateCount > 0 ? <em className="dash-late">Atrasados: {money.format(due.lateValue)} · {due.lateCount}</em> : <em className="dash-ok">Nenhum atrasado</em>}</Link>
      <Link to="/fluxo-caixa" className="metric metric-link dash-forecast" title="Abrir Fluxo de Caixa"><span>Previsão de caixa · 30 dias</span><strong className={forecast.resultado < 0 ? 'negative-text' : ''}>{money.format(forecast.resultado)}</strong><small><b className="in">Entradas {money.format(forecast.entradas)}</b> · <b className="out">Saídas {money.format(forecast.saidas)}</b></small><em>Previsto, não é saldo bancário</em></Link>
      <Link to="/repasse-alvaras" className="metric metric-link dash-transfers" title="Repasses aprovados a pagar"><span>Repasses pendentes</span><strong>{money.format(transfers.total)}</strong><small className="dash-transfer-list">{transfers.rows.map((row) => <span key={row.origin}>{row.origin === 'Comissões de Agentes' ? 'Comissões' : row.origin}: {money.format(row.value)}{row.count ? ` (${row.count})` : ''}</span>)}</small></Link>
    </div>

    <div className="dashboard-grid">
      <section className="page-card">
        <div className="card-title-row"><h2>Receitas × Despesas por mês</h2><span className="mini-legend"><i className="legend-revenue" /> Receitas <i className="legend-expense" /> Despesas efetivas</span></div>
        <div className="dash-chart" role="img" aria-label="Gráfico mensal de receitas e despesas">
          {series.map((row) => {
            const [y, m] = row.month.split('-')
            return <div className="dash-chart-col" key={row.month} title={`${MONTHS[Number(m) - 1]}/${y} · Receitas ${money.format(row.receitas)} · Despesas ${money.format(row.despesas)}`}>
              <div className="dash-chart-bars">
                <b className="revenue-bar" style={{ height: `${row.receitas ? Math.max(2, (row.receitas / seriesMax) * 100) : 0}%` }} />
                <b className="expense-bar" style={{ height: `${row.despesas ? Math.max(2, (row.despesas / seriesMax) * 100) : 0}%` }} />
              </div>
              <span>{MONTHS[Number(m) - 1]}{Number(m) === 1 || row === series[0] ? `/${y.slice(2)}` : ''}</span>
            </div>
          })}
        </div>
        <p className="dash-chart-scale">Maior valor no período: {seriesMax > 1 ? money.format(seriesMax) : 'R$ 0,00'}</p>
      </section>
      <Link to="/aprovacoes" className="page-card dashboard-panel-link" title="Abrir Fluxo de Aprovação"><div className="card-title-row"><h2>Fluxo de aprovação</h2><small>Abrir Aprovações</small></div><div className="status-row"><span>Rascunhos</span><strong>{expenses.filter((item) => item.status === 'rascunho').length}</strong></div><div className="status-row"><span>Em análise</span><strong>{pending}</strong></div><div className="status-row"><span>Aprovados</span><strong>{approvedAll.length}</strong></div><div className="status-row"><span>Devolvidos</span><strong>{expenses.filter((item) => item.status === 'devolvido').length}</strong></div><div className="status-row rejected-row rejected-with-value"><span>Rejeitados</span><strong>{rejected.length} · {money.format(rejectedTotal)}</strong></div></Link>
    </div>

    <div className="dashboard-grid dash-second-row">
      <section className="page-card">
        <div className="card-title-row"><h2>Despesas por conta · 5 maiores</h2><small>Plano de Contas</small></div>
        {accounts.length === 0 ? <p className="dash-empty">Nenhuma despesa efetiva no período.</p> : <div className="dash-accounts">
          {accounts.map((row) => <div key={row.code || 'sem'} className="dash-account-row">
            <span><strong>{row.code || '—'}</strong> {row.name}</span>
            <strong>{money.format(row.value)}</strong>
            <b className="expense-bar" style={{ width: `${Math.max(3, (row.value / accountsMax) * 100)}%` }} />
          </div>)}
        </div>}
      </section>
      <section className="page-card"><div className="card-title-row"><h2>Movimento financeiro</h2><span className="mini-legend"><i className="legend-revenue" /> Receitas <i className="legend-expense" /> Despesas</span></div><div className="summary-bars"><div><span>Receitas</span><strong>{money.format(revenueTotal)}</strong><b className="bar revenue-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? 100 : 4)}%` }} /></div><div><span>Despesas efetivas</span><strong>{money.format(expenseTotal)}</strong><b className="bar expense-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? (expenseTotal / revenueTotal) * 100 : expenseTotal > 0 ? 100 : 4)}%` }} /></div></div></section>
    </div>
  </>
}
