/** Cálculos puros da Dashboard Financeira (sem Firebase). */
import type { Movement, RecordRow } from './cashFlowMovements'

export type Period = 'mes' | 'trimestre' | 'ano' | 'tudo'
export const PERIOD_LABELS: Record<Period, string> = { mes: 'Mês', trimestre: 'Trimestre', ano: 'Ano', tudo: 'Tudo' }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dateOf = (raw: unknown) => { const v = typeof raw === 'string' ? raw.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '' }
const monthOf = (raw: unknown) => { const v = typeof raw === 'string' ? raw.slice(0, 7) : ''; return /^\d{4}-\d{2}$/.test(v) ? v + '-01' : '' }
const tsDate = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return ''
  const v = raw as { toDate?: () => Date; seconds?: number }
  const d = typeof v.toDate === 'function' ? v.toDate() : typeof v.seconds === 'number' ? new Date(v.seconds * 1000) : null
  return d && !Number.isNaN(d.getTime()) ? iso(d) : ''
}
const num = (raw: unknown) => { const n = Number(raw); return Number.isFinite(n) ? n : 0 }
const addDays = (base: Date, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return d }

/** Intervalo [início, fim] (AAAA-MM-DD) do período atual. "tudo" não tem limite. */
export function periodRange(period: Period, today = new Date()): { start: string; end: string } {
  const y = today.getFullYear(), m = today.getMonth()
  if (period === 'mes') return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) }
  if (period === 'trimestre') { const q = Math.floor(m / 3) * 3; return { start: iso(new Date(y, q, 1)), end: iso(new Date(y, q + 3, 0)) } }
  if (period === 'ano') return { start: `${y}-01-01`, end: `${y}-12-31` }
  return { start: '0000-01-01', end: '9999-12-31' }
}
export const inRange = (date: string, r: { start: string; end: string }) => !!date && date >= r.start && date <= r.end

/** Data da receita efetiva: data do recebimento, data informada ou confirmação da Tesouraria. */
export const revenueDate = (item: RecordRow) => dateOf(item.receiptDate) || dateOf(item.data) || tsDate(item.treasuryAt) || dateOf(item.treasuryAt)
/** Data da despesa efetiva: pagamento; sem pagamento, a competência. */
export const expenseDate = (item: RecordRow) => dateOf(item.paymentDate) || monthOf(item.competencia) || tsDate(item.createdAt)

/** Meses exibidos no gráfico: 6 (mês/trimestre) ou 12 (ano/tudo), terminando no mês atual — no "Ano", de janeiro a dezembro. */
export function chartMonths(period: Period, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth()
  const list: string[] = []
  if (period === 'ano') { for (let i = 0; i < 12; i++) list.push(`${y}-${String(i + 1).padStart(2, '0')}`); return list }
  const count = period === 'tudo' ? 12 : 6
  for (let i = count - 1; i >= 0; i--) { const d = new Date(y, m - i, 1); list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  return list
}

export function monthlySeries(revenues: RecordRow[], expenses: RecordRow[], months: string[]) {
  const rows = months.map((month) => ({ month, receitas: 0, despesas: 0 }))
  const index = new Map(rows.map((r) => [r.month, r]))
  for (const item of revenues) { const row = index.get(revenueDate(item).slice(0, 7)); if (row) row.receitas += num(item.valorAlvara) }
  for (const item of expenses) { const row = index.get(expenseDate(item).slice(0, 7)); if (row) row.despesas += num(item.valorTotal) }
  return rows
}

export function topAccounts(expenses: RecordRow[], classifications: Map<string, RecordRow>, limit = 5) {
  const totals = new Map<string, { code: string; name: string; value: number }>()
  for (const item of expenses) {
    const c = classifications.get(`expense__${item.id}`)
    const code = String(c?.accountCode || item.expenseAccountCode || item.classificacaoContabil || '').trim()
    const name = String(c?.accountName || item.expenseAccountName || item.categoria || '').trim()
    const key = code || 'sem-conta'
    const row = totals.get(key) ?? { code, name: code ? name : 'Sem conta classificada', value: 0 }
    row.value += num(item.valorTotal)
    totals.set(key, row)
  }
  return [...totals.values()].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, limit)
}

/** Saídas previstas: vencendo em até 7 dias e atrasadas (data anterior a hoje). */
export function dueSoon(all: Movement[], today = new Date()) {
  const t = iso(today), limit = iso(addDays(today, 7))
  const planned = all.filter((m) => m.stage === 'previsto' && m.direction === 'saida' && m.date)
  const next = planned.filter((m) => m.date >= t && m.date <= limit)
  const late = planned.filter((m) => m.date < t)
  const sum = (list: Movement[]) => list.reduce((s, m) => s + m.value, 0)
  return { nextValue: sum(next), nextCount: next.length, lateValue: sum(late), lateCount: late.length }
}

/** Entradas e saídas previstas nos próximos 30 dias (a partir de hoje). */
export function forecast30(all: Movement[], today = new Date()) {
  const t = iso(today), limit = iso(addDays(today, 30))
  const planned = all.filter((m) => m.stage === 'previsto' && m.date >= t && m.date <= limit)
  const entradas = planned.filter((m) => m.direction === 'entrada').reduce((s, m) => s + m.value, 0)
  const saidas = planned.filter((m) => m.direction === 'saida').reduce((s, m) => s + m.value, 0)
  return { entradas, saidas, resultado: entradas - saidas }
}

/** Repasses aprovados ainda não pagos, por tipo. */
export function pendingTransfers(all: Movement[]) {
  const types = ['Repasse de Alvarás', 'Comissões de Agentes', 'Repasse Societário'] as const
  const rows = types.map((origin) => {
    const list = all.filter((m) => m.origin === origin && m.stage === 'previsto')
    return { origin, value: list.reduce((s, m) => s + m.value, 0), count: list.length }
  })
  return { rows, total: rows.reduce((s, r) => s + r.value, 0) }
}
