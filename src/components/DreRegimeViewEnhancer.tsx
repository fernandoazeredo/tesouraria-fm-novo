import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { CalendarDays, Landmark } from 'lucide-react'
import { db } from '../lib/firebase'

type AnyRecord = { id: string } & DocumentData
type Regime = 'competencia' | 'caixa'
type MovementFilter = 'all' | 'revenue' | 'expense'
type DreRow = { id: string; type: 'revenue' | 'expense'; date: string; unit: string; amount: number; group: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const EXPENSE_COMPETENCE_STATUSES = new Set(['aprovado', 'pago', 'arquivado'])
const AGREEMENT_COMPETENCE_STATUSES = new Set(['enviado_tesouraria', 'recebido_tesouraria', 'encerrado'])
const FILTER_STORAGE_KEY = 'dre-gerencial-periodo'

function isoLocal(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayMonthRange() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  return {
    start: isoLocal(new Date(year, month, 1)),
    end: isoLocal(new Date(year, month + 1, 0)),
  }
}

function currentYearRange() {
  const now = new Date()
  return {
    start: isoLocal(new Date(now.getFullYear(), 0, 1)),
    end: isoLocal(new Date(now.getFullYear(), 11, 31)),
  }
}

function last30DaysRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return { start: isoLocal(start), end: isoLocal(end) }
}

function initialRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}') as { start?: string; end?: string }
    if (saved.start && saved.end) return { start: saved.start, end: saved.end }
  } catch { /* usa mês atual */ }
  return todayMonthRange()
}

function normalizeStatus(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeDate(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoLocal(value)
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate()
      if (!Number.isNaN(date.getTime())) return isoLocal(date)
    }
    const seconds = Number(candidate.seconds ?? candidate._seconds)
    if (Number.isFinite(seconds) && seconds > 0) return isoLocal(new Date(seconds * 1000))
  }
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split('/')
    return `${year}-${month}-${day}`
  }
  return ''
}

function firstValidDate(...values: unknown[]) {
  for (const value of values) {
    const date = normalizeDate(value)
    if (date) return date
  }
  return ''
}

function expenseCompetenceDate(record: AnyRecord) {
  const itemDate = Array.isArray(record.items) ? record.items.find((item: DocumentData) => item?.data)?.data : ''
  return firstValidDate(itemDate, record.competencia)
}

function expenseCashDate(record: AnyRecord) {
  return firstValidDate(record.paymentDate, record.paidDate, record.dataPagamento, record.payment?.date, record.financialMovement?.date, record.paidAt)
}

function revenueCompetenceDate(record: AnyRecord) {
  return firstValidDate(record.competencia, record.data, record.receiptDate)
}

function revenueCashDate(record: AnyRecord) {
  return firstValidDate(record.receiptDate, record.creditDate, record.dataCredito, record.data, record.receivedAt, record.receivedTreasuryAt, record.treasuryReceivedAt)
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '')
  if (!raw) return 0
  let normalized = raw
  if (raw.includes(',') && raw.includes('.')) normalized = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  else if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function revenueAmount(record: AnyRecord, classification?: AnyRecord) {
  const gross = toNumber(record.valorAlvara)
  const type = normalizeStatus(record.tipoRecebimento)
  const legacyOtherRevenue = !String(record.processo ?? '').trim() && gross > 0
  const classifiedAsOtherRevenue = classification?.accountDre === 'Outras Receitas Não Operacionais'

  if (type === 'outras_receitas' || legacyOtherRevenue || classifiedAsOtherRevenue) return gross

  const direct = toNumber(record.invoiceValue)
  if (direct > 0) return direct
  const components = Array.isArray(record.components) ? record.components as DocumentData[] : []
  return toNumber(components.find((item) => item.nome === 'Honorários do Escritório')?.valor)
}

function isLaborAgreement(record: AnyRecord) {
  return String(record.tipoRecebimento ?? '').trim().toLowerCase() === 'acordo_trabalhista'
}

function laborAgreementInstallmentAmount(record: AnyRecord, installment: DocumentData) {
  const direct = toNumber(installment.honorarios)
  if (direct > 0) return direct
  const installmentValue = toNumber(installment.valorParcela)
  const percentage = toNumber(record.percentualHonorarios)
  return installmentValue > 0 && percentage > 0 ? Number(((installmentValue * percentage) / 100).toFixed(2)) : 0
}

function laborAgreementRows(record: AnyRecord, regime: Regime, group: string): DreRow[] {
  const installments = Array.isArray(record.parcelas) ? record.parcelas as DocumentData[] : []
  const unit = String(record.unidade ?? 'RJ')
  const rows: DreRow[] = []

  installments.forEach((installment, index) => {
    const realizedDate = firstValidDate(installment.dataRealizada)
    if (!realizedDate) return

    const amount = laborAgreementInstallmentAmount(record, installment)
    if (amount <= 0) return

    const date = regime === 'competencia'
      ? firstValidDate(installment.dataContabilizacao, realizedDate, installment.dataPrevista)
      : realizedDate
    if (!date) return

    const installmentNumber = Number(installment.numero) || index + 1
    rows.push({
      id: `${record.id}__parcela_${installmentNumber}`,
      type: 'revenue',
      date,
      unit,
      amount,
      group,
    })
  })

  return rows
}

export function DreRegimeViewEnhancer() {
  const savedRange = useMemo(initialRange, [])
  const [expenses, setExpenses] = useState<AnyRecord[]>([])
  const [revenues, setRevenues] = useState<AnyRecord[]>([])
  const [classifications, setClassifications] = useState<AnyRecord[]>([])
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [regime, setRegime] = useState<Regime>('competencia')
  const [startDate, setStartDate] = useState(savedRange.start)
  const [endDate, setEndDate] = useState(savedRange.end)
  const [unit, setUnit] = useState('Todas')
  const [movement, setMovement] = useState<MovementFilter>('all')

  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ start: startDate, end: endDate }))
  }, [startDate, endDate])

  useEffect(() => {
    const offExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => setExpenses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
    const offRevenues = onSnapshot(collection(db, 'receivables'), (snapshot) => setRevenues(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
    const offClassifications = onSnapshot(collection(db, 'managerialClassifications'), (snapshot) => setClassifications(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
    return () => { offExpenses(); offRevenues(); offClassifications() }
  }, [])

  useEffect(() => {
    const sync = () => {
      const original = document.querySelector<HTMLElement>('.dre-report-card:not(.dre-regime-card)')
      if (!original) { setTarget(null); return }
      original.style.display = 'none'
      let mount = document.getElementById('dre-regime-view-root')
      if (!mount) {
        mount = document.createElement('div')
        mount.id = 'dre-regime-view-root'
        original.parentElement?.insertBefore(mount, original)
      }
      setTarget(mount)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      document.querySelector<HTMLElement>('.dre-report-card:not(.dre-regime-card)')?.style.removeProperty('display')
      document.getElementById('dre-regime-view-root')?.remove()
    }
  }, [])

  const classificationMap = useMemo(() => new Map(classifications.map((item) => [item.id, item])), [classifications])

  const allRows = useMemo<DreRow[]>(() => {
    const result: DreRow[] = []

    for (const item of expenses) {
      const classification = classificationMap.get(`expense__${item.id}`)
      if (!classification?.confirmed || !classification.accountDre || classification.accountDre === 'Não mostrar no DRE Gerencial') continue
      const status = normalizeStatus(item.status)

      if (regime === 'competencia') {
        if (!EXPENSE_COMPETENCE_STATUSES.has(status)) continue
        const date = expenseCompetenceDate(item)
        if (!date) continue
        result.push({ id: item.id, type: 'expense', date, unit: String(item.unidade ?? 'RJ'), amount: toNumber(item.valorTotal), group: String(classification.accountDre) })
      } else {
        const date = expenseCashDate(item)
        if (!date) continue
        if (['rascunho', 'rejeitado', 'cancelado', 'excluido'].includes(status)) continue
        result.push({ id: item.id, type: 'expense', date, unit: String(item.unidade ?? 'RJ'), amount: toNumber(item.valorTotal), group: String(classification.accountDre) })
      }
    }

    for (const item of revenues) {
      const classification = classificationMap.get(`revenue__${item.id}`)
      if (!classification?.confirmed || !classification.accountDre || classification.accountDre === 'Não mostrar no DRE Gerencial') continue
      const status = normalizeStatus(item.status)
      const group = String(classification.accountDre)

      if (isLaborAgreement(item)) {
        if (regime === 'competencia' && !AGREEMENT_COMPETENCE_STATUSES.has(status)) continue
        if (regime === 'caixa' && ['rascunho', 'rejeitado', 'cancelado', 'excluido', 'pendente'].includes(status)) continue

        const installmentRows = laborAgreementRows(item, regime, group)
        if (installmentRows.length > 0) {
          result.push(...installmentRows)
          continue
        }
      }

      const date = regime === 'competencia' ? revenueCompetenceDate(item) : revenueCashDate(item)
      if (!date) continue
      if (regime === 'competencia' && !['recebido_tesouraria', 'encerrado'].includes(status)) continue
      if (regime === 'caixa' && ['rascunho', 'rejeitado', 'cancelado', 'excluido', 'pendente'].includes(status)) continue
      result.push({ id: item.id, type: 'revenue', date, unit: String(item.unidade ?? 'RJ'), amount: revenueAmount(item, classification), group })
    }

    return result
  }, [classificationMap, expenses, regime, revenues])

  const availableRange = useMemo(() => {
    const dates = allRows.map((item) => item.date).filter(Boolean).sort()
    return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
  }, [allRows])

  const rows = useMemo(() => allRows.filter((item) => {
    if (startDate && item.date < startDate) return false
    if (endDate && item.date > endDate) return false
    if (unit !== 'Todas' && item.unit !== unit) return false
    if (movement === 'revenue' && item.type !== 'revenue') return false
    if (movement === 'expense' && item.type !== 'expense') return false
    return true
  }), [allRows, endDate, movement, startDate, unit])

  const groups = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number; count: number }>()
    for (const row of rows) {
      const current = map.get(row.group) ?? { revenue: 0, expense: 0, count: 0 }
      if (row.type === 'revenue') current.revenue += row.amount
      else current.expense += row.amount
      current.count += 1
      map.set(row.group, current)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  }, [rows])

  const totalRevenue = rows.filter((item) => item.type === 'revenue').reduce((sum, item) => sum + item.amount, 0)
  const totalExpense = rows.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const balance = totalRevenue - totalExpense

  function applyRange(range: { start: string; end: string }) {
    setStartDate(range.start)
    setEndDate(range.end)
  }

  function showAllPeriod() {
    if (!availableRange) return
    applyRange(availableRange)
  }

  if (!target) return null

  return createPortal(
    <section className="page-card dre-report-card dre-regime-card">
      <div className="dre-section-heading"><div><span className="eyebrow">Demonstrativo Gerencial</span><h2>Resultado do Período</h2><p>Alterne entre competência econômica e movimentação efetiva de caixa e consulte qualquer intervalo de datas.</p></div></div>

      <div className="dre-regime-toggle" role="group" aria-label="Regime de visualização">
        <button className={regime === 'competencia' ? 'active' : ''} type="button" onClick={() => setRegime('competencia')}><CalendarDays size={16} /> Visão Competência</button>
        <button className={regime === 'caixa' ? 'active' : ''} type="button" onClick={() => setRegime('caixa')}><Landmark size={16} /> Visão Caixa</button>
      </div>

      <div className="dre-regime-explanation">{regime === 'competencia'
        ? 'Competência: despesas são consideradas pela data do lançamento vinculada à competência; receitas usam a data econômica disponível.'
        : 'Caixa: considera somente lançamentos que possuem data efetiva de pagamento/crédito, independentemente da competência.'}</div>

      <div className="dre-report-filters dre-date-range-filters">
        <label><span>Data inicial</span><input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Data final</span><input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label><span>Unidade</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option>Todas</option><option>RJ</option><option>SP</option></select></label>
        <label><span>Movimento</span><select value={movement} onChange={(event) => setMovement(event.target.value as MovementFilter)}><option value="all">Todos</option><option value="revenue">Somente Receitas</option><option value="expense">Somente Despesas</option></select></label>
      </div>

      <div className="dre-period-presets" role="group" aria-label="Atalhos de período">
        <button className="secondary-button" type="button" onClick={() => applyRange(last30DaysRange())}>Últimos 30 dias</button>
        <button className="secondary-button" type="button" onClick={() => applyRange(todayMonthRange())}>Mês atual</button>
        <button className="secondary-button" type="button" onClick={() => applyRange(currentYearRange())}>Ano atual</button>
        <button className="secondary-button" type="button" disabled={!availableRange} onClick={showAllPeriod}>Todo o período</button>
      </div>

      <div className="dre-kpis"><div><span>Receitas</span><strong>{money.format(totalRevenue)}</strong></div><div><span>Despesas</span><strong>{money.format(totalExpense)}</strong></div><div className={balance >= 0 ? 'positive' : 'negative'}><span>Resultado {regime === 'caixa' ? 'de Caixa' : 'Gerencial'}</span><strong>{money.format(balance)}</strong></div><div><span>Lançamentos</span><strong>{rows.length}</strong></div></div>

      <div className="dre-statement"><div className="dre-statement-row head"><span>Grupo DRE</span><span>Lançamentos</span><span>Valor</span></div>{groups.length === 0 ? <div className="dre-empty-statement">Nenhum lançamento classificado para esta visão e intervalo de datas.</div> : groups.map(([label, values]) => {
        const isExpense = values.expense > 0 && values.revenue === 0
        const net = values.revenue - values.expense
        return <div className={`dre-statement-row ${isExpense ? 'expense' : 'revenue'}`} key={label}><span>{label}</span><span>{values.count}</span><strong>{isExpense ? `(${money.format(values.expense)})` : money.format(net)}</strong></div>
      })}<div className="dre-statement-row total"><span>RESULTADO {regime === 'caixa' ? 'DE CAIXA' : 'GERENCIAL'}</span><span>{rows.length}</span><strong>{money.format(balance)}</strong></div></div>
    </section>,
    target,
  )
}
