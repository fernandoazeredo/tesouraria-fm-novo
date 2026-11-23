import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWindow, wantsFullHistory, recordDay, cutoffDay } from '../time-window.js'

const now = new Date('2026-11-23T12:00:00Z')

test('pergunta sem ano usa janela de 12 meses; com ano ou histórico usa tudo', () => {
  assert.equal(wantsFullHistory('Quanto gastamos com aluguel?'), false)
  assert.equal(wantsFullHistory('Quanto gastamos em 2024?'), true)
  assert.equal(wantsFullHistory('Mostre o histórico de despesas'), true)
  assert.equal(wantsFullHistory('compare com o ano passado'), true)
})

test('corte de 12 meses', () => {
  assert.equal(cutoffDay(now), '2025-11-23')
})

test('data do registro: competência, data ISO e Timestamp', () => {
  assert.equal(recordDay({ competencia: '2025-03' }), '2025-03-01')
  assert.equal(recordDay({ paymentDate: '2026-01-10' }), '2026-01-10')
  assert.equal(recordDay({ createdAt: { toDate: () => new Date('2024-05-02T10:00:00Z') } }), '2024-05-02')
  assert.equal(recordDay({}), null)
})

test('antigos encerrados saem; antigos em aberto e sem data ficam', () => {
  const items = [
    { id: 'novo', status: 'pago', competencia: '2026-10' },
    { id: 'velho-pago', status: 'pago', competencia: '2024-01' },
    { id: 'velho-aberto', status: 'aprovado', competencia: '2024-01' },
    { id: 'sem-data', status: 'arquivado' },
  ]
  const r = applyWindow(items, 'Quais despesas pagas?', { now })
  assert.deepEqual(r.items.map(i => i.id), ['novo', 'velho-aberto', 'sem-data'])
  assert.equal(r.excluded, 1)
  const full = applyWindow(items, 'despesas de 2024', { now })
  assert.equal(full.items.length, 4)
  assert.equal(full.full, true)
})
