import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canEditReceivable,
  isAllowedReceivableTransition,
  receivableAuditAction,
  receivableEditMode,
  restoreComponents,
  stripImmutableFields,
} from '../src/lib/receivableEditing.ts'

const defaults = [
  { nome: 'Imposto de Renda', percentual: 0, valor: 0 },
  { nome: 'Honorários do Escritório', percentual: 0, valor: 0 },
  { nome: 'Outras Deduções / Participações - Geral 1', percentual: 0, valor: 0, detalhe: '' },
  { nome: 'Outras Deduções / Participações', percentual: 0, valor: 0, detalhe: '' },
]

test('botão disponível apenas para rascunho e devolvido', () => {
  assert.equal(canEditReceivable({ status: 'rascunho' }, 'operador'), true)
  assert.equal(canEditReceivable({ status: 'devolvido' }, 'gerente'), true)
  for (const status of ['enviado_tesouraria', 'recebido_tesouraria', 'encerrado', undefined]) {
    assert.equal(canEditReceivable({ status }, 'master'), false, String(status))
  }
})

test('somente perfis autorizados pelas regras da origem', () => {
  assert.equal(canEditReceivable({ status: 'rascunho' }, 'master'), true)
  for (const role of ['tesouraria', 'diretor', '', undefined]) {
    assert.equal(canEditReceivable({ status: 'rascunho' }, role), false, String(role))
  }
})

test('acordo trabalhista e outras receitas não usam este editor', () => {
  assert.equal(canEditReceivable({ status: 'rascunho', tipoRecebimento: 'acordo_trabalhista' }, 'master'), false)
  assert.equal(canEditReceivable({ status: 'devolvido', tipoRecebimento: 'outras_receitas' }, 'master'), false)
})

test('transições espelham originReceivableUpdate das firestore.rules', () => {
  assert.equal(isAllowedReceivableTransition('rascunho', 'rascunho'), true)
  assert.equal(isAllowedReceivableTransition('rascunho', 'enviado_tesouraria'), true)
  assert.equal(isAllowedReceivableTransition('rascunho', 'devolvido'), false)
  assert.equal(isAllowedReceivableTransition('devolvido', 'devolvido'), true)
  assert.equal(isAllowedReceivableTransition('devolvido', 'enviado_tesouraria'), true)
  assert.equal(isAllowedReceivableTransition('devolvido', 'rascunho'), false)
  assert.equal(isAllowedReceivableTransition('enviado_tesouraria', 'enviado_tesouraria'), false)
  assert.equal(isAllowedReceivableTransition('encerrado', 'rascunho'), false)
})

test('modo de edição por status', () => {
  assert.equal(receivableEditMode('rascunho'), 'draft')
  assert.equal(receivableEditMode('devolvido'), 'returned')
  assert.equal(receivableEditMode('recebido_tesouraria'), null)
})

test('recupera composição salva preservando comissão de R$ 300,00 e honorários', () => {
  const stored = [
    { nome: 'Honorários do Escritório', percentual: 30, valor: 3000 },
    { nome: 'Outras Deduções / Participações', percentual: 3, valor: 300, detalhe: 'AGENTE FICTÍCIO — TESTE' },
    { nome: 'Outras Deduções / Participações - Adicional abc', percentual: 1, valor: 100, detalhe: 'Extra' },
  ]
  const restored = restoreComponents(defaults, stored)
  assert.equal(restored.length, 5)
  assert.deepEqual(restored.map((c) => c.nome).slice(0, 4), defaults.map((c) => c.nome))
  const agent = restored.find((c) => c.nome === 'Outras Deduções / Participações')
  assert.equal(agent.valor, 300)
  assert.equal(agent.percentual, 3)
  assert.equal(agent.detalhe, 'AGENTE FICTÍCIO — TESTE')
  assert.equal(restored.find((c) => c.nome === 'Honorários do Escritório').valor, 3000)
  assert.equal(restored.at(-1).valor, 100)
  const total = restored.reduce((sum, c) => sum + c.valor, 0)
  assert.equal(10000 - total + 100, 6700) // sem o adicional: líquido do cliente R$ 6.700,00
  assert.equal(defaults[1].valor, 0, 'não altera a lista padrão')
})

test('composição ausente volta ao padrão', () => {
  assert.deepEqual(restoreComponents(defaults, undefined), defaults)
})

test('edição nunca sobrescreve createdAt, createdBy e createdByName', () => {
  const out = stripImmutableFields({ status: 'rascunho', createdAt: 1, createdBy: 'x', createdByName: 'X', valorAlvara: 10 })
  assert.deepEqual(out, { status: 'rascunho', valorAlvara: 10 })
})

test('ações de auditoria distintas para edição, correção e reenvio', () => {
  assert.equal(receivableAuditAction(null, 'rascunho'), 'Receita salva como rascunho')
  assert.equal(receivableAuditAction('draft', 'rascunho'), 'Rascunho de receita editado')
  assert.equal(receivableAuditAction('draft', 'enviado_tesouraria'), 'Rascunho de receita enviado à Tesouraria')
  assert.equal(receivableAuditAction('returned', 'devolvido'), 'Receita devolvida corrigida')
  assert.equal(receivableAuditAction('returned', 'enviado_tesouraria'), 'Receita corrigida reenviada à Tesouraria')
})
