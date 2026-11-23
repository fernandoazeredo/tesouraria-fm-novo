// Conferência dos cálculos da Dashboard Financeira com dados gravados no Firestore Emulator.
// Os valores esperados foram calculados à mão a partir da massa abaixo (hoje = 23/11/2026, período = Mês).
// Não faz parte do npm test. Para rodar localmente:
//   npm i -D --legacy-peer-deps firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project demo-tesouraria-fm \
//     "node --experimental-strip-types --test tests/emulator/dashboard-calculations.emulator.test.mjs"
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { isEffectiveAlvaraReceivable } from '../../src/lib/receivableClassification.ts'
import { movements } from '../../src/lib/cashFlowMovements.ts'
import { chartMonths, cumulativeBalance, dueSoon, expenseDate, forecast30, inRange, monthlySeries, pctChange, pendingTransfers, periodRange, previousRange, receivablesOutlook, revenueDate, topAccounts, upcomingPayments } from '../../src/lib/dashboardMetrics.ts'
import { DASHBOARD_SEED } from './dashboard-seed.mjs'

const today = new Date(2026, 10, 23, 12) // 23/11/2026
let env
let data = {}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tesouraria-fm', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [name, rows] of Object.entries(DASHBOARD_SEED)) for (const row of rows) { const { id, ...rest } = row; await setDoc(doc(db, name, id), rest) }
    for (const name of Object.keys(DASHBOARD_SEED)) data[name] = (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }))
  })
})
after(async () => { await env?.cleanup() })

const sum = (list, field) => list.reduce((s, item) => s + Number(item[field] || 0), 0)

test('saldo, receitas, despesas, margem e variação vs mês anterior', () => {
  const range = periodRange('mes', today), prev = previousRange('mes', today)
  const approvedAll = data.expenses.filter((e) => ['aprovado', 'pago', 'arquivado'].includes(e.status))
  const effective = data.receivables.filter(isEffectiveAlvaraReceivable)
  const revenue = sum(effective.filter((r) => inRange(revenueDate(r), range)), 'valorAlvara')
  const expense = sum(approvedAll.filter((e) => inRange(expenseDate(e), range)), 'valorTotal')
  const prevRevenue = sum(effective.filter((r) => inRange(revenueDate(r), prev)), 'valorAlvara')
  const prevExpense = sum(approvedAll.filter((e) => inRange(expenseDate(e), prev)), 'valorTotal')
  assert.equal(revenue, 80000)          // 50.000 + 30.000 (outras receitas fica fora)
  assert.equal(expense, 25500)          // 12.000 + 6.500 + 3.500 + 2.000 + 1.500
  assert.equal(revenue - expense, 54500)
  assert.equal(Math.round(((revenue - expense) / revenue) * 100), 68)
  assert.equal(prevRevenue, 40000); assert.equal(prevExpense, 14000)
  assert.equal(Math.round(((revenue - expense) - (prevRevenue - prevExpense)) / Math.abs(prevRevenue - prevExpense) * 100), 110)
  assert.equal(Math.round(pctChange(revenue, prevRevenue)), 100)
  assert.equal(Math.round(pctChange(expense, prevExpense)), 82)
})

test('top contas, participação e variação', () => {
  const approvedAll = data.expenses.filter((e) => ['aprovado', 'pago', 'arquivado'].includes(e.status))
  const nov = approvedAll.filter((e) => inRange(expenseDate(e), periodRange('mes', today)))
  const oct = approvedAll.filter((e) => inRange(expenseDate(e), previousRange('mes', today)))
  const top = topAccounts(nov, new Map())
  assert.deepEqual(top.map((r) => [r.code, r.value]), [['4.1', 15500], ['4.2', 6500], ['4.3', 2000], ['4.4', 1500]])
  assert.deepEqual(top.map((r) => Math.round((r.value / 25500) * 100)), [61, 25, 8, 6])
  const prevMap = new Map(topAccounts(oct, new Map(), 1000).map((r) => [r.code, r.value]))
  assert.deepEqual(top.map((r) => { const v = pctChange(r.value, prevMap.get(r.code) ?? 0); return v === null ? null : Math.round(v) }), [55, 63, null, null])
})

test('central de pendências, vencimentos e previsão', () => {
  const all = movements(data.receivables, data.expenses, data.alvaraTransfers, data.agentCommissions, data.societaryTransfers)
  const pendingApproval = data.expenses.filter((e) => e.status === 'enviado_aprovacao' || e.status === 'em_analise').length
    + data.agentCommissions.filter((c) => c.status === 'aguardando_aprovacao').length
  assert.equal(pendingApproval, 3)
  assert.deepEqual(dueSoon(all, today), { nextValue: 5700, nextCount: 2, lateValue: 2000, lateCount: 1 })
  assert.deepEqual(forecast30(all, today), { entradas: 43500, saidas: 8500, resultado: 35000 })
  const tr = pendingTransfers(all)
  assert.equal(tr.total, 6200)
  assert.deepEqual(tr.rows.map((r) => r.value), [4200, 0, 2000])
  assert.deepEqual(upcomingPayments(all, today).map((m) => [m.date, m.value, m.late]), [['2026-11-20', 2000, true], ['2026-11-27', 1500, false], ['2026-11-28', 4200, false], ['2026-12-10', 800, false]])
})

test('a receber: total, atrasados, semanas e recebido no mês', () => {
  const all = movements(data.receivables, data.expenses, data.alvaraTransfers, data.agentCommissions, data.societaryTransfers)
  const out = receivablesOutlook(all, today)
  assert.equal(out.total, 53400); assert.equal(out.count, 4)
  assert.equal(out.lateValue, 9900); assert.equal(out.lateCount, 1); assert.equal(out.nextValue, 43500)
  assert.deepEqual(out.weeks, [22000, 18500, 0, 3000])
  assert.equal(out.received, 85000) // 50.000 + 30.000 + 5.000 de outras receitas
  assert.deepEqual(out.items.map((i) => [i.value, i.days]), [[9900, -5], [22000, 3], [18500, 11]])
})

test('gráfico: série mensal e saldo acumulado', () => {
  const approvedAll = data.expenses.filter((e) => ['aprovado', 'pago', 'arquivado'].includes(e.status))
  const series = monthlySeries(data.receivables.filter(isEffectiveAlvaraReceivable), approvedAll, chartMonths('mes', today))
  assert.deepEqual(series.map((r) => [r.month, r.receitas, r.despesas]), [['2026-06', 0, 0], ['2026-07', 0, 0], ['2026-08', 0, 0], ['2026-09', 20000, 5000], ['2026-10', 40000, 14000], ['2026-11', 80000, 25500]])
  assert.deepEqual(cumulativeBalance(series), [0, 0, 0, 15000, 41000, 95500])
})
