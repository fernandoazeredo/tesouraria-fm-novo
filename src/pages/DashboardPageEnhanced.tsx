import { useEffect, useState } from 'react'
import { BadgeDollarSign, ReceiptText } from 'lucide-react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../lib/firebase'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
type AnyRecord = { id: string } & DocumentData

function useLiveCollection(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }), [name])
  return records
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function isAlvara(item: AnyRecord) {
  const type = normalize(item.tipoRecebimento)
  if (type === 'outras_receitas' || type === 'acordo_trabalhista') return false
  return normalize(item.origem).includes('alvara')
}

export function DashboardPageEnhanced() {
  const expenses = useLiveCollection('expenses')
  const receivables = useLiveCollection('receivables')
  const approved = expenses.filter((item) => ['aprovado', 'pago', 'arquivado'].includes(String(item.status)))
  const rejected = expenses.filter((item) => item.status === 'rejeitado')
  const effectiveReceivables = receivables.filter((item) => ['recebido_tesouraria', 'encerrado'].includes(String(item.status)) && isAlvara(item))
  const expenseTotal = approved.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const rejectedTotal = rejected.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = effectiveReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const balance = revenueTotal - expenseTotal
  const pending = expenses.filter((item) => item.status === 'enviado_aprovacao' || item.status === 'em_analise').length

  return <>
    <div className="page-heading"><div><span className="eyebrow">Visão gerencial</span><h1>Dashboard Financeira</h1><p>Retrato consolidado das receitas e das despesas efetivamente aprovadas.</p></div><div className="quick-actions"><Link className="expense-button button-link" to="/despesas?novo=1"><ReceiptText size={18} /> + Despesa</Link><Link className="revenue-button button-link" to="/alvaras?escolherReceita=1"><BadgeDollarSign size={18} /> + Receita</Link></div></div>
    <div className="metrics-grid">
      <Link to="/alvaras" className="metric metric-link revenue-metric" title="Abrir Recebimento de Alvarás"><span>Receitas</span><strong>{money.format(revenueTotal)}</strong><small>Alvarás recebidos · abrir Receitas</small></Link>
      <Link to="/despesas" className="metric metric-link expense-metric" title="Abrir Despesas"><span>Despesas</span><strong>{money.format(expenseTotal)}</strong><small>Aprovadas, pagas e arquivadas · abrir Despesas</small></Link>
      <article className={`metric balance-metric ${balance < 0 ? 'negative' : ''}`}><span>Saldo / Resultado</span><strong>{money.format(balance)}</strong><small>Alvarás recebidos menos despesas efetivas</small></article>
      <Link to="/aprovacoes" className="metric metric-link approval-metric-link" title="Abrir Aprovações"><span>Aguardando Aprovação</span><strong>{pending}</strong><small>Fluxo da Diretoria · abrir Aprovações</small></Link>
    </div>
    <div className="dashboard-grid">
      <section className="page-card"><div className="card-title-row"><h2>Movimento financeiro</h2><span className="mini-legend"><i className="legend-revenue" /> Receitas <i className="legend-expense" /> Despesas efetivas</span></div><div className="summary-bars"><div><span>Receitas</span><strong>{money.format(revenueTotal)}</strong><b className="bar revenue-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? 100 : 4)}%` }} /></div><div><span>Despesas efetivas</span><strong>{money.format(expenseTotal)}</strong><b className="bar expense-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? (expenseTotal / revenueTotal) * 100 : expenseTotal > 0 ? 100 : 4)}%` }} /></div></div></section>
      <Link to="/aprovacoes" className="page-card dashboard-panel-link" title="Abrir Fluxo de Aprovação"><div className="card-title-row"><h2>Fluxo de aprovação</h2><small>Abrir Aprovações</small></div><div className="status-row"><span>Rascunhos</span><strong>{expenses.filter((item) => item.status === 'rascunho').length}</strong></div><div className="status-row"><span>Em análise</span><strong>{pending}</strong></div><div className="status-row"><span>Aprovados</span><strong>{approved.length}</strong></div><div className="status-row"><span>Devolvidos</span><strong>{expenses.filter((item) => item.status === 'devolvido').length}</strong></div><div className="status-row rejected-row rejected-with-value"><span>Rejeitados</span><strong>{rejected.length} · {money.format(rejectedTotal)}</strong></div></Link>
    </div>
  </>
}
