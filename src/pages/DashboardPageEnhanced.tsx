import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, BadgeDollarSign, CalendarClock, ChartLine, ChevronRight, Gavel, Info, ListChecks, ReceiptText, TrendingDown, TrendingUp } from 'lucide-react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../lib/firebase'
import { isEffectiveAlvaraReceivable } from '../lib/receivableClassification'
import { movements } from '../lib/cashFlowMovements'
import { PERIOD_LABELS, chartMonths, cumulativeBalance, dueSoon, expenseDate, forecast30, inRange, monthlySeries, pctChange, pendingTransfers, periodRange, previousRange, receivablesOutlook, revenueDate, topAccounts, upcomingPayments, type Period } from '../lib/dashboardMetrics'
import './DashboardPageEnhanced.css'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
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

function Delta({ value, inverse = false, label }: { value: number | null; inverse?: boolean; label?: string }) {
  if (value === null) return null
  const rounded = Math.round(value)
  const good = inverse ? rounded <= 0 : rounded >= 0
  const Icon = rounded >= 0 ? TrendingUp : TrendingDown
  return <span className={`dsh-delta ${rounded === 0 ? 'flat' : good ? 'good' : 'bad'}`}><Icon size={13} /> {rounded > 0 ? '+' : ''}{rounded}%{label ? ` ${label}` : ''}</span>
}

const shortDate = (date: string) => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : 'sem data'
const dayMonth = (date: string) => ({ d: date.slice(8, 10), m: MONTHS[Number(date.slice(5, 7)) - 1] || '' })
const relativeDays = (days: number) => days < 0 ? `Atrasado ${-days} ${days === -1 ? 'dia' : 'dias'}` : days === 0 ? 'Hoje' : `Em ${days} ${days === 1 ? 'dia' : 'dias'}`

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
  const prevRange = previousRange(period)
  const approvedAll = expenses.filter((item) => ['aprovado', 'pago', 'arquivado'].includes(String(item.status)))
  const effectiveAll = receivables.filter(isEffectiveAlvaraReceivable)
  const approved = approvedAll.filter((item) => inRange(expenseDate(item), range))
  const effectiveReceivables = effectiveAll.filter((item) => inRange(revenueDate(item), range))
  const rejected = expenses.filter((item) => item.status === 'rejeitado')
  const sumOf = (list: AnyRecord[], field: string) => list.reduce((sum, item) => sum + toNumber(item[field]), 0)
  const expenseTotal = sumOf(approved, 'valorTotal')
  const rejectedTotal = sumOf(rejected, 'valorTotal')
  const revenueTotal = sumOf(effectiveReceivables, 'valorAlvara')
  const balance = revenueTotal - expenseTotal
  const margin = revenueTotal > 0 ? Math.round((balance / revenueTotal) * 100) : null
  const prevApproved = prevRange ? approvedAll.filter((item) => inRange(expenseDate(item), prevRange)) : []
  const prevRevenue = prevRange ? sumOf(effectiveAll.filter((item) => inRange(revenueDate(item), prevRange)), 'valorAlvara') : 0
  const prevExpense = sumOf(prevApproved, 'valorTotal')
  const prevBalance = prevRevenue - prevExpense
  const balanceDelta = prevRange && prevBalance !== 0 ? ((balance - prevBalance) / Math.abs(prevBalance)) * 100 : null
  const prevLabel: Record<Period, string> = { mes: 'vs mês anterior', trimestre: 'vs trimestre anterior', semestre: 'vs semestre anterior', ano: 'vs ano anterior', tudo: '' }

  const pendingExpenses = expenses.filter((item) => item.status === 'enviado_aprovacao' || item.status === 'em_analise').length
  const pendingCommissions = agentCommissions.filter((item) => item.status === 'aguardando_aprovacao').length
  const pendingAlvaraTransfers = alvaraTransfers.filter((item) => item.status === 'aguardando_aprovacao').length
  const pendingSocietaryTransfers = societaryTransfers.filter((item) => item.status === 'aguardando_aprovacao').length
  const pending = pendingExpenses + pendingCommissions + pendingAlvaraTransfers + pendingSocietaryTransfers
  const drafts = expenses.filter((item) => item.status === 'rascunho').length
  const returned = expenses.filter((item) => item.status === 'devolvido').length

  const allMovements = useMemo(() => movements(receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers), [receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers])
  const due = dueSoon(allMovements)
  const forecast = forecast30(allMovements)
  const transfers = pendingTransfers(allMovements)
  const upcoming = upcomingPayments(allMovements)
  const outlook = receivablesOutlook(allMovements)

  const series = monthlySeries(effectiveAll, approvedAll, chartMonths(period))
  const currentMonth = new Date().toISOString().slice(0, 7)
  const cumulative = cumulativeBalance(series)
  const lastPast = series.reduce((idx, row, i) => (row.month <= currentMonth ? i : idx), -1)
  const showForecast = lastPast === series.length - 1
  const forecastPoint = lastPast >= 0 ? cumulative[lastPast] + forecast.resultado : 0
  const columns = series.length + (showForecast ? 1 : 0)
  const scaleMax = Math.max(1, ...series.map((row) => Math.max(row.receitas, row.despesas)), ...cumulative.slice(0, lastPast + 1), showForecast ? forecastPoint : 0)
  const pct = (value: number) => Math.max(0, Math.min(100, (value / scaleMax) * 100))
  const xOf = (i: number) => ((i + 0.5) / columns) * 100
  const linePoints = cumulative.slice(0, lastPast + 1).map((value, i) => ({ x: xOf(i), y: pct(value) }))
  const forecastXY = showForecast && lastPast >= 0 ? { x: xOf(series.length), y: pct(forecastPoint) } : null

  const monthlyBalance = series.slice(0, lastPast + 1).map((row) => row.receitas - row.despesas)
  const sparkMin = Math.min(0, ...monthlyBalance), sparkMax = Math.max(1, ...monthlyBalance)
  const spark = monthlyBalance.map((value, i) => `${monthlyBalance.length > 1 ? (i / (monthlyBalance.length - 1)) * 100 : 50},${38 - ((value - sparkMin) / (sparkMax - sparkMin || 1)) * 34}`).join(' ')

  const classificationMap = useMemo(() => new Map(classifications.map((item) => [item.id, item])), [classifications])
  const accounts = topAccounts(approved, classificationMap)
  const prevAccounts = new Map(topAccounts(prevApproved, classificationMap, 1000).map((row) => [row.code || 'sem', row.value]))
  const accountsMax = Math.max(1, ...accounts.map((row) => row.value))
  const periodHint = period === 'tudo' ? 'todo o histórico' : `${PERIOD_LABELS[period].toLowerCase()} atual`
  const periodHelp = `O período (${periodHint}) vale para Saldo, Receitas, Despesas, o gráfico e as contas. A Central de pendências, os vencimentos e os valores a receber não mudam com o período: mostram o que vence de hoje em diante.`
  const outlookBase = Math.max(1, outlook.received + outlook.lateValue + outlook.nextValue)
  const weeksMax = Math.max(1, ...outlook.weeks)

  return <div className="dsh">
    <div className="page-heading dsh-heading">
      <div><span className="eyebrow">Visão gerencial</span>
        <div className="dsh-title-row"><h1>Dashboard Financeira</h1>
          <select className="dsh-period-select" aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => <option key={key} value={key}>{PERIOD_LABELS[key]}</option>)}
          </select>
          <span className="dsh-info" title={periodHelp} aria-label={periodHelp} tabIndex={0}><Info size={17} /></span>
        </div>
      </div>
      <div className="quick-actions"><Link className="expense-button button-link" to="/despesas?novo=1"><ReceiptText size={18} /> + Despesa</Link><Link className="revenue-button button-link" to="/alvaras?escolherReceita=1"><BadgeDollarSign size={18} /> + Receita</Link></div>
    </div>

    <div className="dsh-row">
      <section className="page-card dsh-hero">
        <div className="dsh-hero-top">
          <div>
            <span className="dsh-label">Saldo do período</span>
            <strong className={`dsh-balance ${balance < 0 ? 'negative' : ''}`}>{money.format(balance)}</strong>
            <Delta value={balanceDelta} label={prevLabel[period]} />
          </div>
          <div className="dsh-hero-side">
            <Link to="/alvaras" title="Abrir Receitas"><span>Receitas</span><strong className="rev">{money.format(revenueTotal)}</strong><Delta value={prevRange ? pctChange(revenueTotal, prevRevenue) : null} /></Link>
            <Link to="/despesas" title="Abrir Despesas"><span>Despesas</span><strong className="exp">{money.format(expenseTotal)}</strong><Delta value={prevRange ? pctChange(expenseTotal, prevExpense) : null} inverse /></Link>
            <div><span>Margem</span><strong>{margin === null ? '—' : `${margin}%`}</strong></div>
          </div>
        </div>
        <svg className={`dsh-spark ${balance < 0 ? 'negative' : ''}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          {monthlyBalance.length > 0 && <>
            <polygon points={`0,40 ${spark} 100,40`} />
            <polyline points={spark} vectorEffect="non-scaling-stroke" />
          </>}
        </svg>
      </section>

      <section className="page-card dsh-pending">
        <div className="card-title-row"><h2>Central de pendências</h2><small>de hoje em diante</small></div>
        <Link to="/aprovacoes" className="dsh-pending-row"><i className="ic approval"><ListChecks size={16} /></i><span>Aguardando aprovação</span><strong>{pending}</strong></Link>
        <Link to="/fluxo-caixa" className="dsh-pending-row"><i className="ic due"><CalendarClock size={16} /></i><span>A pagar em 7 dias<small className={due.lateCount ? 'late' : 'ok'}>{due.lateCount ? `${due.lateCount} ${due.lateCount === 1 ? 'atrasado' : 'atrasados'} · ${money.format(due.lateValue)}` : `${due.nextCount} ${due.nextCount === 1 ? 'pagamento' : 'pagamentos'} · nenhum atrasado`}</small></span><strong>{money.format(due.nextValue)}</strong></Link>
        <Link to="/repasse-alvaras" className="dsh-pending-row" title={transfers.rows.map((row) => `${row.origin}: ${money.format(row.value)}`).join('\n')}><i className="ic transfer"><ArrowLeftRight size={16} /></i><span>Repasses pendentes<small>{transfers.rows.filter((row) => row.value > 0).map((row) => row.origin === 'Comissões de Agentes' ? 'Comissões' : row.origin.replace('Repasse de ', '')).join(' · ') || 'Nenhum pendente'}</small></span><strong>{money.format(transfers.total)}</strong></Link>
        <Link to="/fluxo-caixa" className="dsh-pending-row" title="Previsto, não é saldo bancário"><i className="ic forecast"><ChartLine size={16} /></i><span>Previsão de caixa · 30 dias<small>entra {compact.format(forecast.entradas)} · sai {compact.format(forecast.saidas)}</small></span><strong className={forecast.resultado < 0 ? 'negative-text' : ''}>{money.format(forecast.resultado)}</strong></Link>
      </section>
    </div>

    <div className="dsh-row">
      <section className="page-card dsh-flow">
        <div className="card-title-row"><h2>Fluxo de caixa</h2><span className="mini-legend"><i className="legend-revenue" /> Receitas <i className="legend-expense" /> Despesas <i className="legend-balance" /> Saldo acumulado{showForecast ? <> <i className="legend-forecast" /> Previsão 30d</> : null}</span></div>
        <div className="dsh-plot" role="img" aria-label="Gráfico mensal de receitas, despesas e saldo acumulado">
          {series.map((row, i) => {
            const [y, m] = row.month.split('-')
            return <div className="dsh-col" key={row.month} title={`${MONTHS[Number(m) - 1]}/${y} · Receitas ${money.format(row.receitas)} · Despesas ${money.format(row.despesas)}${i <= lastPast ? ` · Saldo acumulado ${money.format(cumulative[i])}` : ''}`}>
              <b className="revenue-bar" style={{ height: `${row.receitas ? Math.max(1.5, pct(row.receitas)) : 0}%` }} />
              <b className="expense-bar" style={{ height: `${row.despesas ? Math.max(1.5, pct(row.despesas)) : 0}%` }} />
            </div>
          })}
          {showForecast && <div className="dsh-col forecast" title={`Previsão 30 dias · saldo ${money.format(forecastPoint)}`} />}
          <svg className="dsh-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {linePoints.length > 1 && <polyline points={linePoints.map((p) => `${p.x},${100 - p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />}
            {forecastXY && linePoints.length > 0 && <polyline className="dashed" points={`${linePoints[linePoints.length - 1].x},${100 - linePoints[linePoints.length - 1].y} ${forecastXY.x},${100 - forecastXY.y}`} vectorEffect="non-scaling-stroke" />}
          </svg>
          {linePoints.map((p, i) => <span key={i} className="dsh-dot" style={{ left: `${p.x}%`, bottom: `${p.y}%` }} />)}
          {forecastXY && <span className="dsh-dot hollow" style={{ left: `${forecastXY.x}%`, bottom: `${forecastXY.y}%` }} />}
        </div>
        <div className="dsh-xlabels">
          {series.map((row) => { const [y, m] = row.month.split('-'); return <span key={row.month}>{MONTHS[Number(m) - 1]}{Number(m) === 1 || row === series[0] ? `/${y.slice(2)}` : ''}</span> })}
          {showForecast && <span>+30d</span>}
        </div>
      </section>

      <div className="dsh-stack">
        <Link to="/aprovacoes" className="page-card dashboard-panel-link dsh-approvals" title="Abrir Fluxo de Aprovação">
          <div className="card-title-row"><h2>Aprovações</h2><small>Ver fluxo →</small></div>
          <div className="dsh-funnel">
            <div className="step draft"><strong>{drafts}</strong><span>Rascunho</span></div><ChevronRight size={16} />
            <div className="step review"><strong>{pending}</strong><span>Em análise</span></div><ChevronRight size={16} />
            <div className="step done"><strong>{approvedAll.length}</strong><span>Aprovado</span></div>
          </div>
          <div className="dsh-funnel-foot"><span className="ret">Devolvidos {returned}</span><span className="rej">Rejeitados {rejected.length} · {money.format(rejectedTotal)}</span></div>
        </Link>
        <section className="page-card dsh-due-list">
          <div className="card-title-row"><h2>Próximos vencimentos</h2><Link to="/fluxo-caixa">Ver tudo →</Link></div>
          {upcoming.length === 0 ? <p className="dash-empty">Nenhum pagamento previsto.</p> : upcoming.map((item) => <div key={item.id} className="dsh-list-row" title={item.origin}>
            <span><b className={item.late ? 'late' : ''}>{shortDate(item.date)}</b> {item.description}</span><strong>{money.format(item.value)}</strong>
          </div>)}
        </section>
      </div>
    </div>

    <div className="dsh-row">
      <section className="page-card">
        <div className="card-title-row"><h2>Top 5 contas de despesa</h2><Link to="/plano-contas">Plano de Contas →</Link></div>
        {accounts.length === 0 ? <p className="dash-empty">Nenhuma despesa efetiva no período. <Link to="/despesas?novo=1">Lançar despesa</Link></p> : <>
          <div className="dsh-acc-row head"><span>Conta</span><span /><span>Valor</span><span>%</span><span>Var.</span></div>
          {accounts.map((row) => {
            const share = expenseTotal > 0 ? Math.round((row.value / expenseTotal) * 100) : 0
            const delta = prevRange ? pctChange(row.value, prevAccounts.get(row.code || 'sem') ?? 0) : null
            return <div key={row.code || 'sem'} className="dsh-acc-row" title={`${row.code} ${row.name}`}>
              <span className="name"><strong>{row.code || '—'}</strong> {row.name}</span>
              <span className="track"><b className="expense-bar" style={{ width: `${Math.max(3, (row.value / accountsMax) * 100)}%` }} /></span>
              <span>{money.format(row.value)}</span><span>{share}%</span>
              <span>{delta === null ? '—' : <Delta value={delta} inverse />}</span>
            </div>
          })}
          <div className="dsh-acc-total"><span>Total de despesas efetivas</span><strong>{money.format(expenseTotal)}</strong></div>
        </>}
      </section>

      <section className="page-card dsh-receive">
        <div className="card-title-row"><h2><Gavel size={16} /> A receber</h2><Link to="/alvaras">Ver tudo →</Link></div>
        <div className="dsh-receive-head">
          <div><strong>{money.format(outlook.total)}</strong><small>{outlook.count} {outlook.count === 1 ? 'previsto' : 'previstos'} · próximos 30 dias · alvarás, acordos e outras receitas</small></div>
          {outlook.lateCount > 0 && <span className="dsh-badge late">{outlook.lateCount} {outlook.lateCount === 1 ? 'atrasado' : 'atrasados'}</span>}
        </div>
        <div className="dsh-progress" title={`Recebido no mês ${money.format(outlook.received)} · Atrasado ${money.format(outlook.lateValue)} · A vencer ${money.format(outlook.nextValue)}`}>
          <b className="got" style={{ width: `${(outlook.received / outlookBase) * 100}%` }} /><b className="late" style={{ width: `${(outlook.lateValue / outlookBase) * 100}%` }} />
        </div>
        <div className="dsh-progress-legend"><span><i className="got" /> Recebido no mês</span><span><i className="late" /> Atrasado</span><span><i /> A vencer</span></div>
        <div className="dsh-weeks" aria-label="Previsão por semana">
          {outlook.weeks.map((value, i) => <div key={i} title={money.format(value)}><b style={{ height: `${value ? Math.max(8, (value / weeksMax) * 100) : 4}%` }} /><span>sem {i + 1}</span></div>)}
        </div>
        {outlook.items.length === 0 ? <p className="dash-empty">Nenhum recebimento previsto.</p> : outlook.items.map((item) => {
          const dm = dayMonth(item.date)
          const tone = item.days < 0 ? 'late' : item.days <= 7 ? 'soon' : 'later'
          return <div key={item.id} className="dsh-receive-row">
            <span className={`dsh-date ${tone}`}><b>{dm.d}</b>{dm.m}</span>
            <span className="desc"><span>{item.description}</span><small className={tone}>{relativeDays(item.days)}</small></span>
            <strong>{money.format(item.value)}</strong>
          </div>
        })}
      </section>
    </div>
  </div>
}
