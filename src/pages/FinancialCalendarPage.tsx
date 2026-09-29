import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, FileText, Paperclip, RefreshCw } from 'lucide-react'
import { db } from '../lib/firebase'
import { createTextPdf } from '../lib/simplePdf'
import './FinancialCalendarPage.css'

type AnyRecord = { id: string } & DocumentData
type Attachment = { name?: string; url?: string; path?: string; size?: number; type?: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })

function useCollectionRecords(name: 'expenses' | 'receivables') {
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

function downloadPdf(title: string, lines: string[], name: string) {
  const bytes = createTextPdf(title, lines)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function expensePdf(item: AnyRecord) {
  downloadPdf('DEMONSTRATIVO DA DESPESA', [
    'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',
    `Data do pagamento: ${String(item.paymentDate || '—')}`,
    `Competência: ${String(item.competencia || '—')}`,
    `Unidade: ${String(item.unidade || '—')}`,
    `Responsável: ${String(item.nome || '—')}`,
    `Fornecedor / favorecido: ${String(item.fornecedor || '—')}`,
    `CPF / CNPJ: ${String(item.documento || '—')}`,
    `Plano de contas: ${String(item.expenseAccountCode || item.classificacaoContabil || '—')} · ${String(item.expenseAccountName || item.categoria || '')}`,
    `Status: ${String(item.status || '—')}`,
    `Valor total: ${money.format(toNumber(item.valorTotal))}`,
    `Forma de pagamento: ${String(item.paymentMethod || '—')}`,
    `Observações: ${String(item.observacoes || item.observation || '—')}`,
    `Documentos comprobatórios: ${attachmentsOf(item).length}`,
  ], `Demonstrativo_da_Despesa_${fileName(String(item.fornecedor || item.nome || item.id))}.pdf`)
}

function revenuePdf(item: AnyRecord) {
  downloadPdf('DEMONSTRATIVO DE RECEBIMENTO', [
    'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',
    `Data do recebimento: ${String(item.receiptDate || item.data || '—')}`,
    `Unidade: ${String(item.unidade || '—')}`,
    `Processo: ${String(item.processo || '—')}`,
    `Reclamante: ${String(item.reclamante || '—')}`,
    `Reclamada: ${String(item.reclamada || '—')}`,
    `Origem: ${String(item.origem || item.natureza || '—')}`,
    `Status: ${String(item.status || '—')}`,
    `Valor recebido: ${money.format(toNumber(item.valorAlvara || item.valorLiquidoCliente))}`,
    `Documentos comprobatórios: ${attachmentsOf(item).length}`,
  ], `Demonstrativo_de_Recebimento_${fileName(String(item.processo || item.reclamante || item.id))}.pdf`)
}

function ExpenseMovement({ item }: { item: AnyRecord }) {
  const attachments = attachmentsOf(item)
  return <article className="financial-movement-card expense-movement">
    <div className="financial-movement-main">
      <div><strong>{item.fornecedor || item.nome || 'Despesa'}</strong><span>{item.expenseAccountName || item.categoria || item.expenseAccountCode || 'Despesa'}</span></div>
      <b>{money.format(toNumber(item.valorTotal))}</b>
    </div>
    <div className="financial-document-row">
      <button type="button" onClick={() => expensePdf(item)}><FileText size={14} /> Demonstrativo</button>
      {attachments.map((file, index) => file.url ? <a key={file.path || `${file.name}-${index}`} href={file.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {file.name || `Documento ${index + 1}`} <ExternalLink size={11} /></a> : null)}
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
      <button type="button" onClick={() => revenuePdf(item)}><FileText size={14} /> Demonstrativo</button>
      {attachments.map((file, index) => file.url ? <a key={file.path || `${file.name}-${index}`} href={file.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {file.name || `Documento ${index + 1}`} <ExternalLink size={11} /></a> : null)}
    </div>
  </article>
}

export function FinancialCalendarPage() {
  const { records: expenses, loading: loadingExpenses } = useCollectionRecords('expenses')
  const { records: receivables, loading: loadingReceivables } = useCollectionRecords('receivables')
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
      .filter((item) => ['recebido_tesouraria', 'encerrado'].includes(String(item.status)))
      .forEach((item) => {
        const key = dateKey(item.receiptDate || item.data)
        if (!key || !key.startsWith(selectedMonth)) return
        grouped.set(key, [...(grouped.get(key) || []), item])
      })
    return grouped
  }, [receivables, selectedMonth])

  const monthExpenses = [...expensesByDay.values()].flat()
  const monthReceivables = [...receivablesByDay.values()].flat()
  const expenseTotal = monthExpenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = monthReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara || item.valorLiquidoCliente), 0)
  const loading = loadingExpenses || loadingReceivables

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
      <article><span>Receitas do mês</span><strong className="revenue-calendar-value">{money.format(revenueTotal)}</strong><small>{monthReceivables.length} lançamento(s)</small></article>
      <article><span>Despesas do mês</span><strong className="expense-calendar-value">{money.format(expenseTotal)}</strong><small>{monthExpenses.length} lançamento(s)</small></article>
      <article><span>Resultado do mês</span><strong>{money.format(revenueTotal - expenseTotal)}</strong><small>Receitas menos despesas</small></article>
    </section>

    {loading ? <section className="page-card module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando calendário financeiro</strong></section> :
      <section className="financial-calendar-grid">
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = `${selectedMonth}-${String(day).padStart(2, '0')}`
          const dayExpenses = expensesByDay.get(key) || []
          const dayReceivables = receivablesByDay.get(key) || []
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
          </article>
        })}
      </section>}
  </>
}
