import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { storage } from '../lib/firebase'
import { OfficialFinancialDocumentPreviewButton } from '../components/OfficialFinancialDocument'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, FileText, Paperclip, RefreshCw } from 'lucide-react'
import { db } from '../lib/firebase'
import { isEffectiveAlvaraReceivable } from '../lib/receivableClassification'
import './FinancialCalendarPage.css'

type AnyRecord = { id: string } & DocumentData
type Attachment = { name?: string; url?: string; path?: string; size?: number; type?: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })

function useCollectionRecords(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [name])
  return { records, loading }
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function attachmentsOf(item: AnyRecord): Attachment[] {
  return Array.isArray(item.attachments) ? item.attachments as Attachment[] : []
}

function dateKey(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function localDateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function monthKey(year: number, monthZeroBased: number) {
  return `${year}-${String(monthZeroBased + 1).padStart(2, '0')}`
}

function fileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'demonstrativo'
}

function DemonstrativeLink({ item }: { item: AnyRecord }) {
  const storedUrl = String(item.demonstrative?.url || item.demonstrativeUrl || '')
  const path = String(item.demonstrative?.path || item.demonstrativePath || '')
  const [url, setUrl] = useState(storedUrl)
  useEffect(() => {
    setUrl(storedUrl)
    if (storedUrl || !path) return
    let alive = true
    getDownloadURL(storageRef(storage, path)).then((resolved) => {
      if (alive) setUrl(resolved)
    }).catch((error) => console.warn('Demonstrativo do calendário indisponível:', path, error))
    return () => { alive = false }
  }, [path, storedUrl])
  return url
    ? <a href={url} target="_blank" rel="noreferrer"><FileText size={14} /> Demonstrativo</a>
    : <span><FileText size={14} /> Demonstrativo pendente</span>
}

function AttachmentLink({ file, index }: { file: Attachment; index: number }) {
  const savedUrl = String(file.url || '')
  const path = String(file.path || '')
  const [url, setUrl] = useState(savedUrl)
  useEffect(() => {
    setUrl(savedUrl)
    if (savedUrl || !path) return
    let mounted = true
    getDownloadURL(storageRef(storage, path)).then((resolved) => {
      if (mounted) setUrl(resolved)
    }).catch((error) => console.warn('Comprovante indisponível no calendário:', path, error))
    return () => { mounted = false }
  }, [savedUrl, path])
  return url
    ? <a href={url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {file.name || `Documento ${index + 1}`} <ExternalLink size={11} /></a>
    : <span><Paperclip size={13} /> {file.name || `Documento ${index + 1}`} indisponível</span>
}

function ExpenseMovement({ item }: { item: AnyRecord }) {
  const attachments = attachmentsOf(item)
  return <article className="financial-movement-card expense-movement">
    <div className="financial-movement-main">
      <div><strong>{item.fornecedor || item.nome || 'Despesa'}</strong><span>{item.expenseAccountName || item.categoria || item.expenseAccountCode || 'Despesa'}</span></div>
      <b>{money.format(toNumber(item.valorTotal))}</b>
    </div>
    <div className="financial-document-row">
      <DemonstrativeLink item={item} />
      <OfficialFinancialDocumentPreviewButton kind="revenue" record={item} />
      <OfficialFinancialDocumentPreviewButton kind="expense" record={item} />
      {attachments.map((file, index) => <AttachmentLink key={file.path || `${file.name}-${index}`} file={file} index={index} />)}
    </div>
  </article>
}

function RevenueMovement({ item }: { item: AnyRecord }) {
  const attachments = attachmentsOf(item)
  return <article className="financial-movement-card revenue-movement">
    <div className="financial-movement-main">
      <div><strong>{item.processo || item.reclamante || 'Receita'}</strong><span>{item.reclamante || item.origem || item.natureza || 'Recebimento'}</span></div>
      <b>{money.format(toNumber(item.valorAlvara || item.valorLiquidoCliente))}</b>
    </div>
    <div className="financial-document-row">
      <DemonstrativeLink item={item} />
      {attachments.map((file, index) => <AttachmentLink key={file.path || `${file.name}-${index}`} file={file} index={index} />)}
    </div>
  </article>
}

type PayoutMovement = { id: string; kind: 'Repasse de Alvará' | 'Comissão de Agente' | 'Repasse Societário'; date: string; process: string; beneficiary: string; value: number; record: AnyRecord }

function PayoutMovementCard({ item }: { item: PayoutMovement }) {
  const attachments = attachmentsOf(item.record)
  return <article className="financial-movement-card payout-movement">
    <div className="financial-movement-main">
      <div><strong>{item.kind}</strong><span>{item.process || '—'} · {item.beneficiary || '—'}</span></div>
      <b>{money.format(item.value)}</b>
    </div>
    <div className="financial-document-row">
      <DemonstrativeLink item={item.record} />
      <OfficialFinancialDocumentPreviewButton kind={item.kind === 'Comissão de Agente' ? 'commission' : item.kind === 'Repasse Societário' ? 'societaryTransfer' : 'alvaraTransfer'} record={item.record} />
      {attachments.map((file, index) => <AttachmentLink key={file.path || `${file.name}-${index}`} file={file} index={index} />)}
    </div>
  </article>
}


export function FinancialCalendarPage() {
  const { records: expenses, loading: loadingExpenses } = useCollectionRecords('expenses')
  const { records: receivables, loading: loadingReceivables } = useCollectionRecords('receivables')
  const { records: alvaraTransfers, loading: loadingTransfers } = useCollectionRecords('alvaraTransfers')
  const { records: commissions, loading: loadingCommissions } = useCollectionRecords('agentCommissions')
  const { records: societaryTransfers, loading: loadingSocietary } = useCollectionRecords('societaryTransfers')
  const today = new Date()
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const selectedMonth = monthKey(year, month)
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const expensesByDay = useMemo(() => {
    const grouped = new Map<string, AnyRecord[]>()
    expenses
      .filter((item) => ['aprovado', 'pago', 'arquivado'].includes(String(item.status)))
      .forEach((item) => {
        const key = dateKey(item.paymentDate)
        if (!key || !key.startsWith(selectedMonth)) return
        grouped.set(key, [...(grouped.get(key) || []), item])
      })
    return grouped
  }, [expenses, selectedMonth])

  const receivablesByDay = useMemo(() => {
    const grouped = new Map<string, AnyRecord[]>()
    receivables
      .filter(isEffectiveAlvaraReceivable)
      .forEach((item) => {
        const key = dateKey(item.receiptDate || item.data)
        if (!key || !key.startsWith(selectedMonth)) return
        grouped.set(key, [...(grouped.get(key) || []), item])
      })
    return grouped
  }, [receivables, selectedMonth])

  const payoutsByDay = useMemo(() => {
    const grouped = new Map<string, PayoutMovement[]>()
    const add = (row: PayoutMovement) => {
      const key = dateKey(row.date)
      if (!key || !key.startsWith(selectedMonth)) return
      grouped.set(key, [...(grouped.get(key) || []), row])
    }
    for (const plan of alvaraTransfers) {
      const installments = Array.isArray(plan.installments) ? plan.installments : []
      installments.forEach((installment: DocumentData, index: number) => {
        if (!installment?.paid || !installment?.paidDate) return
        add({ id: `alvara-${plan.id}-${index}`, kind: 'Repasse de Alvará', date: String(installment.paidDate), process: String(plan.processo || plan.sourceSnapshot?.processo || ''), beneficiary: String(plan.beneficiary || plan.sourceSnapshot?.titular || plan.sourceSnapshot?.reclamante || 'Cliente'), value: toNumber(installment.value), record: plan })
      })
    }
    for (const plan of commissions) {
      const installments = Array.isArray(plan.installments) ? plan.installments : []
      installments.forEach((installment: DocumentData, index: number) => {
        if (!installment?.paid || !installment?.paidDate) return
        add({ id: `commission-${plan.id}-${index}`, kind: 'Comissão de Agente', date: String(installment.paidDate), process: String(plan.processo || plan.sourceSnapshot?.processo || ''), beneficiary: String(plan.beneficiary || plan.sourceSnapshot?.agentName || 'Agente'), value: toNumber(installment.value), record: plan })
      })
    }
    for (const plan of societaryTransfers) {
      if (plan.status !== 'pago' || !plan.paymentDate) continue
      add({ id: `societary-${plan.id}`, kind: 'Repasse Societário', date: String(plan.paymentDate), process: String(plan.processo || ''), beneficiary: String(plan.beneficiary || 'Ana Müller'), value: toNumber(plan.paidValue || plan.transferValue), record: plan })
    }
    return grouped
  }, [alvaraTransfers, commissions, selectedMonth, societaryTransfers])

  const monthExpenses = [...expensesByDay.values()].flat()
  const monthReceivables = [...receivablesByDay.values()].flat()
  const expenseTotal = monthExpenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = monthReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara || item.valorLiquidoCliente), 0)
  const resultTotal = revenueTotal - expenseTotal
  const summaryScale = Math.max(revenueTotal, expenseTotal, Math.abs(resultTotal), 1)
  const revenueBar = (revenueTotal / summaryScale) * 100
  const expenseBar = (expenseTotal / summaryScale) * 100
  const resultBar = (Math.abs(resultTotal) / summaryScale) * 100
  const resultTone = resultTotal > 0 ? 'positive' : resultTotal < 0 ? 'negative' : 'neutral'
  const loading = loadingExpenses || loadingReceivables || loadingTransfers || loadingCommissions || loadingSocietary

  return <>
    <div className="page-heading financial-calendar-heading">
      <div><span className="eyebrow">Consulta cronológica</span><h1>Calendário Financeiro</h1><p>Despesas e receitas agrupadas pela data efetiva de pagamento e recebimento, com acesso aos demonstrativos e documentos comprobatórios.</p></div>
    </div>

    <section className="page-card financial-calendar-toolbar">
      <button type="button" className="secondary-button" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={17} /> Mês anterior</button>
      <div><CalendarDays size={22} /><strong>{monthFormatter.format(cursor)}</strong><span>{daysInMonth} dias</span></div>
      <button type="button" className="secondary-button" onClick={() => setCursor(new Date(year, month + 1, 1))}>Próximo mês <ChevronRight size={17} /></button>
    </section>

    <section className="financial-calendar-summary">
      <article>
        <span>Receitas do mês</span>
        <strong className="revenue-calendar-value">{money.format(revenueTotal)}</strong>
        <small>{monthReceivables.length} lançamento(s)</small>
        <div className="financial-mini-chart" aria-label="Gráfico de receitas do mês"><i className="financial-mini-bar revenue-bar" style={{ width: `${revenueBar}%` }} /></div>
      </article>
      <article>
        <span>Despesas do mês</span>
        <strong className="expense-calendar-value">{money.format(expenseTotal)}</strong>
        <small>{monthExpenses.length} lançamento(s)</small>
        <div className="financial-mini-chart" aria-label="Gráfico de despesas do mês"><i className="financial-mini-bar expense-bar" style={{ width: `${expenseBar}%` }} /></div>
      </article>
      <article>
        <span>Resultado do mês</span>
        <strong className={`result-calendar-value ${resultTone}`}>{money.format(resultTotal)}</strong>
        <small>Receitas menos despesas</small>
        <div className="financial-mini-chart" aria-label={`Gráfico do resultado do mês: ${resultTone === 'positive' ? 'positivo' : resultTone === 'negative' ? 'negativo' : 'zerado'}`}>
          <i className={`financial-mini-bar result-bar ${resultTone}`} style={{ width: `${resultBar}%` }} />
        </div>
      </article>
    </section>

    {loading ? <section className="page-card module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando calendário financeiro</strong></section> :
      <section className="financial-calendar-grid">
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = `${selectedMonth}-${String(day).padStart(2, '0')}`
          const dayExpenses = expensesByDay.get(key) || []
          const dayReceivables = receivablesByDay.get(key) || []
          const dayPayouts = payoutsByDay.get(key) || []
          const dayExpenseTotal = dayExpenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
          const dayRevenueTotal = dayReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara || item.valorLiquidoCliente), 0)

          return <article className="financial-day-card" key={key}>
            <header><h2>{dateFormatter.format(localDateFromKey(key))}</h2><span>Dia {day}/{daysInMonth}</span></header>

            {dayExpenses.length > 0 && <section className="financial-day-section financial-day-expenses">
              <div className="financial-day-section-head"><h3>Despesas</h3><strong>{money.format(dayExpenseTotal)}</strong></div>
              <div className="financial-movement-list">{dayExpenses.map((item) => <ExpenseMovement key={item.id} item={item} />)}</div>
            </section>}

            {dayReceivables.length > 0 && <section className="financial-day-section financial-day-revenues">
              <div className="financial-day-section-head"><h3>Receitas</h3><strong>{money.format(dayRevenueTotal)}</strong></div>
              <div className="financial-movement-list">{dayReceivables.map((item) => <RevenueMovement key={item.id} item={item} />)}</div>
            </section>}

            {dayPayouts.length > 0 && <section className="financial-day-section financial-day-payouts">
              <div className="financial-day-section-head"><h3>Repasses e Comissões Pagos</h3><strong>{money.format(dayPayouts.reduce((sum, item) => sum + item.value, 0))}</strong></div>
              <div className="financial-movement-list">{dayPayouts.map((item) => <PayoutMovementCard key={item.id} item={item} />)}</div>
            </section>}

            {dayExpenses.length === 0 && dayReceivables.length === 0 && dayPayouts.length === 0 && <div className="financial-day-empty">Sem movimento</div>}
          </article>
        })}
      </section>}
  </>
}
