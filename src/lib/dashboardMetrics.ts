/** Cálculos puros da Dashboard Financeira (sem Firebase). */
import type { Movement, RecordRow } from './cashFlowMovements'

export type Period = 'mes' | 'trimestre' | 'semestre' | 'ano' | 'tudo'
export const PERIOD_LABELS: Record<Period, string> = { mes: 'Mês', trimestre: 'Trimestre', semestre: 'Semestre', ano: 'Ano', tudo: 'Tudo' }

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
  if (period === 'semestre') { const h = m < 6 ? 0 : 6; return { start: iso(new Date(y, h, 1)), end: iso(new Date(y, h + 6, 0)) } }
  if (period === 'ano') return { start: `${y}-01-01`, end: `${y}-12-31` }
  return { start: '0000-01-01', end: '9999-12-31' }
}
export const inRange = (date: string, r: { start: string; end: string }) => !!date && date >= r.start && date <= r.end

/** Data da receita efetiva: data do recebimento, data informada ou confirmação da Tesouraria. */
export const revenueDate = (item: RecordRow) => dateOf(item.receiptDate) || dateOf(item.data) || tsDate(item.treasuryAt) || dateOf(item.treasuryAt)
/** Data da despesa efetiva: pagamento; sem pagamento, a competência. */
export const expenseDate = (item: RecordRow) => dateOf(item.paymentDate) || monthOf(item.competencia) || tsDate(item.createdAt)

/** Meses do gráfico: últimos 6 (mês/trimestre), os 6 do semestre, jan–dez (ano) ou últimos 12 (tudo). */
export function chartMonths(period: Period, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth()
  const list: string[] = []
  if (period === 'semestre') { const h = m < 6 ? 0 : 6; for (let i = h; i < h + 6; i++) list.push(`${y}-${String(i + 1).padStart(2, '0')}`); return list }
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

/** Intervalo equivalente imediatamente anterior (para comparação). "tudo" não tem anterior. */
export function previousRange(period: Period, today = new Date()): { start: string; end: string } | null {
  const y = today.getFullYear(), m = today.getMonth()
  if (period === 'mes') return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
  if (period === 'trimestre') { const q = Math.floor(m / 3) * 3; return { start: iso(new Date(y, q - 3, 1)), end: iso(new Date(y, q, 0)) } }
  if (period === 'semestre') { const h = m < 6 ? 0 : 6; return { start: iso(new Date(y, h - 6, 1)), end: iso(new Date(y, h, 0)) } }
  if (period === 'ano') return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` }
  return null
}

/** Variação percentual; null quando não há base de comparação. */
export const pctChange = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null

/** Saldo acumulado mês a mês da série do gráfico. */
export function cumulativeBalance(series: { receitas: number; despesas: number }[]) {
  let acc = 0
  return series.map((row) => (acc += row.receitas - row.despesas))
}

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000)

/** Próximas saídas previstas (atrasadas primeiro), para a lista de vencimentos. */
export function upcomingPayments(all: Movement[], today = new Date(), limit = 4) {
  const t = iso(today)
  return all.filter((m) => m.stage === 'previsto' && m.direction === 'saida' && m.date)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit)
    .map((m) => ({ ...m, late: m.date < t }))
}

/** Entradas previstas: atrasadas + próximos 30 dias, semanas, recebido no mês e lista. */
export function receivablesOutlook(all: Movement[], today = new Date(), limit = 3) {
  const t = iso(today), limit30 = iso(addDays(today, 30)), monthStart = t.slice(0, 7) + '-01'
  const planned = all.filter((m) => m.stage === 'previsto' && m.direction === 'entrada' && m.date && m.date <= limit30)
    .sort((a, b) => a.date.localeCompare(b.date))
  const late = planned.filter((m) => m.date < t)
  const next = planned.filter((m) => m.date >= t)
  const sum = (list: Movement[]) => list.reduce((s, m) => s + m.value, 0)
  const weeks = [0, 0, 0, 0]
  for (const m of next) weeks[Math.min(3, Math.floor(daysBetween(t, m.date) / 8))] += m.value
  const received = sum(all.filter((m) => m.stage === 'realizado' && m.direction === 'entrada' && m.date >= monthStart && m.date <= t))
  return {
    total: sum(planned), count: planned.length, lateValue: sum(late), lateCount: late.length, nextValue: sum(next), received, weeks,
    items: planned.slice(0, limit).map((m) => ({ ...m, days: daysBetween(t, m.date) })),
  }
}
