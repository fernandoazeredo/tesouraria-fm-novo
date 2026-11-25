import test from 'node:test'
import assert from 'node:assert/strict'
import { periodRange, chartMonths, monthlySeries, topAccounts, dueSoon, forecast30, pendingTransfers, inRange, expenseDate, revenueDate } from '../src/lib/dashboardMetrics.ts'
import { movements } from '../src/lib/cashFlowMovements.ts'
const today = new Date(2026, 10, 17) // 17/11/2026
test('períodos', () => {
  assert.deepEqual(periodRange('mes', today), { start: '2026-11-01', end: '2026-11-30' })
  assert.deepEqual(periodRange('trimestre', today), { start: '2026-10-01', end: '2026-12-31' })
  assert.deepEqual(periodRange('semestre', today), { start: '2026-07-01', end: '2026-12-31' })
  assert.deepEqual(periodRange('semestre', new Date(2026, 2, 5)), { start: '2026-01-01', end: '2026-06-30' })
  assert.deepEqual(periodRange('ano', today), { start: '2026-01-01', end: '2026-12-31' })
  assert.equal(inRange('2020-01-01', periodRange('tudo', today)), true)
})
test('meses do gráfico', () => {
  assert.deepEqual(chartMonths('mes', today), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  assert.deepEqual(chartMonths('semestre', today), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
  assert.equal(chartMonths('ano', today).length, 12)
  assert.equal(chartMonths('tudo', today)[0], '2025-12')
})
test('datas de receita e despesa', () => {
  assert.equal(revenueDate({ id: 'r', receiptDate: '2026-11-03' }), '2026-11-03')
  assert.equal(expenseDate({ id: 'e', competencia: '2026-10' }), '2026-10-01')
  assert.equal(expenseDate({ id: 'e', paymentDate: '2026-11-05', competencia: '2026-10' }), '2026-11-05')
})
test('série mensal e top contas', () => {
  const s = monthlySeries([{ id: 'r', receiptDate: '2026-11-03', valorAlvara: 1000 }], [{ id: 'e', paymentDate: '2026-10-10', valorTotal: 300 }], chartMonths('mes', today))
  assert.equal(s.find((r) => r.month === '2026-11').receitas, 1000)
  assert.equal(s.find((r) => r.month === '2026-10').despesas, 300)
  const top = topAccounts([{ id: 'a', valorTotal: 100, expenseAccountCode: '4.01', expenseAccountName: 'Aluguel' }, { id: 'b', valorTotal: 50 }, { id: 'c', valorTotal: 70 }], new Map([['expense__c', { accountCode: '4.01', accountName: 'Aluguel' }]]))
  assert.deepEqual(top.map((t) => [t.code, t.value]), [['4.01', 170], ['', 50]])
})
test('a pagar 7 dias, previsão 30 dias e repasses pendentes', () => {
  const all = movements(
    [{ id: 'r1', status: 'enviado_tesouraria', valorAlvara: 5000, dataPrevista: '2026-11-25' }],
    [{ id: 'e1', status: 'aprovado', valorTotal: 200, paymentDate: '2026-11-20' }, { id: 'e2', status: 'aprovado', valorTotal: 80, paymentDate: '2026-11-10' }, { id: 'e3', status: 'pago', valorTotal: 999, paymentDate: '2026-11-18' }],
    [{ id: 'a1', status: 'aprovado', installments: [{ value: 300, dueDate: '2026-12-01' }, { value: 100, paid: true, paidDate: '2026-11-01' }] }],
    [], [{ id: 's1', status: 'aprovado', transferValue: 1000, paidValue: 0, dueDate: '2026-12-30' }])
  assert.deepEqual(dueSoon(all, today), { nextValue: 200, nextCount: 1, lateValue: 80, lateCount: 1 })
  assert.deepEqual(forecast30(all, today), { entradas: 5000, saidas: 500, resultado: 4500 })
  const p = pendingTransfers(all)
  assert.equal(p.total, 1300)
  assert.equal(p.rows.find((r) => r.origin === 'Repasse de Alvarás').count, 1)
})

test('comparação, saldo acumulado, vencimentos e recebíveis', async () => {
  const { previousRange, pctChange, cumulativeBalance, upcomingPayments, receivablesOutlook } = await import('../src/lib/dashboardMetrics.ts')
  assert.deepEqual(previousRange('mes', today), { start: '2026-10-01', end: '2026-10-31' })
  assert.deepEqual(previousRange('trimestre', today), { start: '2026-07-01', end: '2026-09-30' })
  assert.deepEqual(previousRange('ano', today), { start: '2025-01-01', end: '2025-12-31' })
  assert.equal(previousRange('tudo', today), null)
  assert.equal(pctChange(110, 100), 10)
  assert.equal(pctChange(10, 0), null)
  assert.deepEqual(cumulativeBalance([{ receitas: 100, despesas: 40 }, { receitas: 0, despesas: 10 }]), [60, 50])
  const all = movements(
    [{ id: 'r1', status: 'enviado_tesouraria', valorAlvara: 5000, dataPrevista: '2026-11-25', processo: 'P1' },
     { id: 'r2', status: 'enviado_tesouraria', valorAlvara: 900, dataPrevista: '2026-11-12', processo: 'P2' },
     { id: 'r3', status: 'enviado_tesouraria', valorAlvara: 700, dataPrevista: '2027-02-01' },
     { id: 'r4', status: 'recebido_tesouraria', valorAlvara: 300, receiptDate: '2026-11-05' }],
    [{ id: 'e1', status: 'aprovado', valorTotal: 200, paymentDate: '2026-11-20' }, { id: 'e2', status: 'aprovado', valorTotal: 80, paymentDate: '2026-11-10' }],
    [], [], [])
  assert.deepEqual(upcomingPayments(all, today).map((m) => [m.value, m.late]), [[80, true], [200, false]])
  const out = receivablesOutlook(all, today)
  assert.equal(out.total, 5900); assert.equal(out.lateCount, 1); assert.equal(out.lateValue, 900)
  assert.equal(out.received, 300); assert.equal(out.weeks[0] + out.weeks[1], 5000)
  assert.deepEqual(out.items.map((i) => i.days), [-5, 8])
})

test('conferência de entradas: créditos do OFX e sugestões por valor', async () => {
  const { creditsFromOfx, confirmableReceivables, suggestCredits } = await import('../src/lib/incomingCredits.ts')
  const parsed = { transactions: [
    { identityKey: 'a', fitId: '1', movementClass: 'conciliavel', date: '2026-11-24', amount: 22000, memo: 'TED RECEBIDA', name: '', refNum: '' },
    { identityKey: 'b', fitId: '2', movementClass: 'conciliavel', date: '2026-11-24', amount: -500, memo: 'PAGTO', name: '', refNum: '' },
    { identityKey: 'c', fitId: '3', movementClass: 'saldo', date: '2026-11-24', amount: 9000, memo: 'SALDO', name: '', refNum: '' },
    { identityKey: 'd', fitId: '4', movementClass: 'conciliavel', date: '2026-11-20', amount: 22000.004, memo: 'TED', name: '', refNum: '' },
  ] }
  const credits = creditsFromOfx(parsed)
  assert.deepEqual(credits.map((c) => [c.id, c.amount]), [['itau__a', 22000], ['itau__d', 22000]])
  const rows = [
    { id: 'r1', status: 'enviado_tesouraria', valorAlvara: 22000, dataPrevista: '2026-11-25' },
    { id: 'r2', status: 'rascunho', valorAlvara: 22000 },
    { id: 'r3', status: 'enviado_tesouraria', tipoRecebimento: 'acordo_trabalhista', valorAlvara: 22000 },
  ]
  assert.deepEqual(confirmableReceivables(rows).map((r) => r.id), ['r1'])
  assert.deepEqual(suggestCredits(rows[0], credits).map((c) => c.id), ['itau__a', 'itau__d'])
  assert.deepEqual(suggestCredits(rows[0], [{ ...credits[0], matchedReceivableId: 'x' }, credits[1]]).map((c) => c.id), ['itau__d'])
})
