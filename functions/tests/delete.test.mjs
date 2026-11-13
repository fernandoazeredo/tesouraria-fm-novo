import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeleteRequest, isChangeRequest, selectedCollections, DELETABLE_COLLECTIONS } from '../ai-core.js';
import { describeRecord } from '../delete-actions.js';

test('reconhece pedidos de exclusão de despesa e receita', () => {
  for (const q of ['Exclua a despesa da Light de 320 reais', 'apague o lançamento TESTE IA - Vivo', 'Excluir a receita do processo 123', 'delete o alvará do processo 999', 'Remova o acordo do reclamante João'])
    assert.equal(isDeleteRequest(q), true, q);
  for (const q of ['Quanto gastamos com energia?', 'Altere o valor da despesa para 200', 'remova a classificação da despesa na DRE', 'apague o anexo da despesa'])
    assert.equal(isDeleteRequest(q), false, q);
});
test('exclusão lê somente Despesas e Receitas', () => {
  assert.deepEqual(DELETABLE_COLLECTIONS, ['expenses', 'receivables']);
  assert.deepEqual(selectedCollections('Exclua a despesa da Light').map(s => s.collection), ['expenses']);
  assert.deepEqual(selectedCollections('Apague o lançamento do processo 123').map(s => s.collection), ['receivables']);
  assert.deepEqual(selectedCollections('Apague o lançamento TESTE IA').map(s => s.collection), ['expenses', 'receivables']);
});
test('resumo da exclusão sem dados bancários e com aviso de finalizado', () => {
  const v = describeRecord('expenses', { fornecedor: 'Light', valorTotal: 320, status: 'pago', competencia: '2026-11', attachments: [{}], agencia: '1234', conta: '999' });
  assert.ok(v.itens.some(r => r.label === 'Valor' && /320/.test(r.value)));
  assert.ok(v.itens.every(r => !/1234|999/.test(r.value)));
  assert.ok(v.avisos.some(a => /finalizado/.test(a)));
  assert.equal(isChangeRequest('Exclua a despesa da Light'), false);
});
