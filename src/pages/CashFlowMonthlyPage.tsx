import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { FileDown } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { downloadCashFlowPdf } from '../lib/cashFlowPdf'
import { db } from '../lib/firebase'
import './CashFlowMonthly.css'

import { movements, validatePlan, type Movement, type RecordRow } from '../lib/cashFlowMovements'
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
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
const sum = (items: Movement[], stage: Movement['stage'], direction: Movement['direction']) => items.filter(item => item.stage === stage && item.direction === direction).reduce((total, item) => total + item.value, 0)
export function CashFlowMonthlyPage() {
  const { profile } = useAuth()
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [month, setMonth] = useState(monthNow)
  const [scope, setScope] = useState<'itau' | 'indefinido' | 'outro'>('itau')
  const sources = [useRecords('receivables'), useRecords('expenses'), useRecords('alvaraTransfers'), useRecords('agentCommissions'), useRecords('societaryTransfers')]
  const [receivables, expenses, alvaraTransfers, commissions, societary] = sources
  const allRows = useMemo(() => movements(receivables.rows, expenses.rows, alvaraTransfers.rows, commissions.rows, societary.rows).sort((a,b) => a.date.localeCompare(b.date)), [receivables.rows, expenses.rows, alvaraTransfers.rows, commissions.rows, societary.rows])
  const rows = allRows.filter(item => item.date.startsWith(month))
  const noDate = allRows.filter(item => !item.date)
  const validationIssues = [...alvaraTransfers.rows.map(item => ({item, origin:'Repasse de Alvarás'})), ...commissions.rows.map(item => ({item, origin:'Comissões de Agentes'}))].flatMap(({item, origin}) => validatePlan(item).map(message => origin + ' · ' + item.id + ': ' + message))
  const visible = rows.filter(item => item.bank === scope)
  const plannedIn = sum(visible, 'previsto', 'entrada')
  const plannedOut = sum(visible, 'previsto', 'saida')
  const actualIn = sum(visible, 'realizado', 'entrada')
  const actualOut = sum(visible, 'realizado', 'saida')
  const pending = rows.filter(item => item.bank === 'indefinido').length
  const pfExcluded = rows.filter(item => item.bank === 'outro').length
  const loading = sources.some(item => !item.loaded)
  const error = sources.map(item => item.error).filter(Boolean).join(' · ')
  const accountLabels = { itau: 'Itaú PJ — identificados', indefinido: 'Sem conta identificada', outro: 'Outras contas (fora do escopo PJ)' }
  const handleDownloadPdf = async () => {
    if (loading || error || pdfBusy || !profile) return
    setPdfBusy(true)
    setPdfError('')
    try {
      downloadCashFlowPdf({
        month, monthTitle: monthLabel(month), account: accountLabels[scope],
        user: profile.displayName || profile.email, issuedAt: new Date(),
        actualIn, actualOut, plannedIn, plannedOut, pending,
        noDate, pfExcluded, validationIssues, movements: visible,
      })
      await addDoc(collection(db, 'auditLogs'), {
        action: 'PDF do Fluxo de Caixa gerado',
        module: 'Fluxo de Caixa',
        detail: 'Mês: ' + month + ' · Conta: ' + accountLabels[scope] + ' · Usuário: ' + (profile.displayName || profile.email),
        entityId: month,
        userId: profile.uid,
        userName: profile.displayName,
        userEmail: profile.email,
        month,
        bankScope: scope,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      setPdfError('Não foi possível concluir a geração ou o registro de auditoria do PDF: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPdfBusy(false)
    }
  }
  return <section className="cash-flow">
    <div className="page-heading payment-control-heading"><div><span className="eyebrow">Tesouraria · consulta</span><h1>Fluxo de Caixa Mensal</h1><p>Previsto x Realizado · sem editar lançamentos</p></div><div className="quick-actions"><button type="button" className="secondary-button" disabled={loading || !!error || pdfBusy} onClick={() => void handleDownloadPdf()}><FileDown size={17} />{pdfBusy ? 'Gerando PDF...' : 'Baixar PDF'}</button></div></div>
    {pdfError && <div className="page-card" role="alert">{pdfError}</div>}
    <div className="page-card cash-flow-disclaimer"><strong>Fase 1 — demonstrativo gerencial, não saldo bancário.</strong><p>Os valores seguem os registros existentes, não um extrato conciliado. Não há saldo inicial ou projeção de saldo final. Recebimentos realizados usam a data declarada no lançamento; a data efetiva do crédito pode ser diferente. Operações sem conta identificada ficam separadas para evitar atribuição indevida ao Itaú PJ.</p></div>
    <div className="page-card cash-flow-filters"><label>Mês de referência <input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label><label>Contas <select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="itau">Itaú PJ — identificados</option><option value="indefinido">Sem conta identificada</option><option value="outro">Outras contas (fora do escopo PJ)</option></select></label></div>
    {error && <div className="page-card" role="alert">Consulta incompleta: {error}. Não use totais até todas as fontes estarem disponíveis.</div>}
    {!loading && !error && <><div className="cash-flow-grid">
      <article className="page-card"><h2>Realizado · {monthLabel(month)}</h2><p>Entradas: <strong>{money.format(actualIn)}</strong></p><p>Saídas: <strong>{money.format(actualOut)}</strong></p><p>Resultado do mês: <strong>{money.format(actualIn - actualOut)}</strong></p></article>
      <article className="page-card"><h2>Previsto · {monthLabel(month)}</h2><p>Entradas: <strong>{money.format(plannedIn)}</strong></p><p>Saídas: <strong>{money.format(plannedOut)}</strong></p><p>Resultado previsto: <strong>{money.format(plannedIn - plannedOut)}</strong></p></article>
      <article className="page-card"><h2>Conciliação necessária</h2><p><strong>{pending}</strong> movimentações do mês sem conta identificada.</p><p>Valores não presumidos como Itaú PJ.</p><p><strong>{noDate.length}</strong> registros sem data válida (fora dos totais mensais).</p><p><strong>{pfExcluded}</strong> movimentações em contas PF excluídas do Itaú PJ.</p></article>
    </div>
    {validationIssues.length > 0 && <div className="page-card" role="alert"><h2>Inconsistências de parcelas</h2>{validationIssues.map((issue, i) => <p key={i}>{issue}</p>)}</div>}
    {noDate.length > 0 && <div className="page-card"><h2>Previsto/realizado sem data — fora dos totais</h2><p>Inclui repasses societários aprovados sem vencimento cadastrado. Não há atribuição artificial a nenhum mês.</p>{noDate.map(item => <p key={item.id}>{item.origin} · {item.description} · {money.format(item.value)} ({item.stage})</p>)}</div>}
    <div className="page-card"><h2>Movimentações — {monthLabel(month)}</h2><div className="cash-flow-table-wrap"><table className="cash-flow-table"><thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th>Tipo</th><th>Etapa</th><th>Valor</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} title={item.observation || ''}><td>{item.date.split('-').reverse().join('/')}</td><td>{item.origin}</td><td>{item.description}{item.alternativeDate ? ' · data alternativa' : ''}{item.treasuryDate ? ' · Tesouraria: ' + item.treasuryDate.split('-').reverse().join('/') + (item.treasuryDate !== item.date ? ' ⚠ datas diferentes' : '') : ''}</td><td>{item.direction === 'entrada' ? 'Entrada' : 'Saída'}</td><td>{item.stage === 'realizado' ? 'Realizado*' : 'Previsto'}</td><td className="cash-flow-number">{money.format(item.value)}</td></tr>)}</tbody></table>{visible.length === 0 && <p>Nenhum lançamento com data e conta bancária compatíveis com os filtros selecionados.</p>}</div></div></>}
    {loading && <p>Carregando movimentações...</p>}
    <p className="cash-flow-footnote">* Realizado significa status financeiro registrado no aplicativo; não substitui a conciliação com extrato. Registros sem data válida não entram no total. Repasses e comissões não são descontados novamente do valor bruto do recebimento: aparecem como saídas próprias.</p>
  </section>
}
