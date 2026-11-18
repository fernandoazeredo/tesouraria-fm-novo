import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAgent, buildCommissionReport } from '../src/lib/commissionReport.ts'
import { officialChartOfAccounts } from '../functions/chart-of-accounts.js'
const chart = officialChartOfAccounts.map((a) => ({ code: a.code, name: a.name }))

test('nome e conta do agente', () => {
  assert.deepEqual(resolveAgent('COMISSÃO / WALTER', chart), { name: 'Walter Brajowicht', account: '4.02.03.21 - Walter Brajowi (Participação no Processo - Alvará/Acordo)' })
  assert.equal(resolveAgent('LEO JUN', chart).name, 'Leonardo Jun')
  assert.equal(resolveAgent('WILIAM', chart).account, '4.02.03.20 - W. Larangeira (Participação no Processo - Alvará/Acordo)')
  assert.equal(resolveAgent('LEO JUN', chart).account, '4.02.03.11 - Leonardo Jun (Participação no Processo - Alvará/Acordo)')
  assert.deepEqual(resolveAgent('MICHAEL', [{ code: '4.02.03.24', name: 'Michael (Participação no Processo - Alvará/Acordo)' }]).name, 'Michael')
  assert.equal(resolveAgent('SOLANGE NOVA', [{ code: '4.02.03.99', name: 'Zeca Novo (Participação)' }, { code: '4.02.03.23', name: 'Solange (Participação no Processo - Alvará/Acordo)' }]).name, 'Solange')
  assert.equal(resolveAgent('RÔMULO', chart).name, 'Romulo Pimentel')
  assert.deepEqual(resolveAgent('MAURICIO', chart), { name: 'Mauricio', account: '4.02.03.25 - Mauricio (Participação no Processo - Alvará/Acordo)' })
  assert.deepEqual(resolveAgent('FULANO', chart), { name: 'Fulano', account: '' })
})

test('um relatório por agente e mês, com saldo anterior e pagamento único', () => {
  const groups = buildCommissionReport([
    { agent: 'WALTER', date: '2026-10-27', processo: 'P1', reclamante: 'ALEX', reclamada: 'UNIQUE', gross: 283.5, deduction: 55.28, payments: [{ date: '2026-11-19', value: 228.22 }] },
    { agent: 'WALTER', date: '2026-10-19', processo: 'P2', reclamante: 'ANDERSON', reclamada: 'REDECARD', gross: 19469.17, deduction: 2920.38, payments: [{ date: '2026-11-19', value: 16548.79 }] },
    { agent: 'WALTER', date: '2026-11-05', processo: 'P3', reclamante: 'BRUNO', reclamada: 'TERRAS', gross: 100, deduction: 0, payments: [] },
    { agent: 'COMISSÃO / WALTER', date: '2026-09-02', processo: 'P0', reclamante: 'ZECA', reclamada: 'X', gross: 50, deduction: 0, payments: [] },
  ], chart)
  assert.equal(groups.length, 3)
  const [set, out, nov] = groups
  assert.equal(set.month, 'SETEMBRO'); assert.equal(set.finalBalance, 50)
  assert.equal(out.month, 'OUTUBRO'); assert.equal(out.previousBalance, 50)
  assert.equal(out.lines[0].history, 'REF. RECEBIMENTO DE HONORÁRIOS PROCESSO Nº P1 – Autor: ALEX x UNIQUE')
  assert.equal(out.lines[1].history, 'REF. DEDUÇÃO COMPENSATÓRIA PROCESSO Nº P1 – Autor: ALEX x UNIQUE')
  const last = out.lines.at(-1)
  assert.equal(last.history, 'REF. PAGAMENTO PARTICIPAÇÃO EM DIVERSOS PROCESSOS')
  assert.equal(last.date, '2026-11-19'); assert.equal(last.debit, 16777.01)
  assert.equal(out.finalBalance, 50)
  assert.equal(nov.previousBalance, 50); assert.equal(nov.finalBalance, 150)
})
