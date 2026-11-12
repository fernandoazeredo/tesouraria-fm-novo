import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPendencias, filterFor, renderPendencias } from '../pendencias.js';
import { isPendingQuestion } from '../panorama.js';

const users = [
  { displayName: 'Fernando Azeredo', role: 'master', status: 'active' },
  { displayName: 'Flávio Marques', role: 'diretor', status: 'active' },
  { displayName: 'Dona Socorro', role: 'tesouraria', status: 'active' },
  { displayName: 'Bloqueado', role: 'tesouraria', status: 'blocked' },
];
const now = Date.parse('2026-11-12T12:00:00Z');
const ts = s => ({ toDate: () => new Date(s) });

test('pendências com responsável pela regra e quem lançou', () => {
  const { rows } = buildPendencias({
    users, now,
    expenses: [
      { id: 'a', data: { status: 'enviado_aprovacao', fornecedor: 'Light', valorTotal: 320, createdByName: 'Reinaldo', updatedAt: ts('2026-11-10T12:00:00Z') } },
      { id: 'b', data: { status: 'aprovado', fornecedor: 'Vivo', valorTotal: 180, createdByName: 'Reinaldo' } },
      { id: 'c', data: { status: 'devolvido', fornecedor: 'Papelaria', valorTotal: 50, createdByName: 'Ana' } },
    ],
    receivables: [{ id: 'r', data: { status: 'enviado_tesouraria', processo: '123', valorAlvara: 800, createdByName: 'Reinaldo' } }],
    obligations: [{ type: 'Comissão de agente', path: '/comissoes-agentes', data: { status: 'aguardando_aprovacao', beneficiary: 'Agente X', netAmountDue: 90 } }],
    classMap: new Map([['expense__b', { confirmed: true, accountCode: '4.05.28', accountDre: 'Despesas Administrativas' }]]),
  });
  const find = text => rows.find(r => r.pendencia.includes(text));
  assert.match(find('aguardando aprovação').responsavel.label, /Fernando Azeredo, Flávio Marques/);
  assert.equal(find('aguardando aprovação').dias, 2);
  assert.match(find('efetuar o pagamento').responsavel.label, /Tesouraria — pagamentos e comprovantes \(Dona Socorro\)/);
  assert.ok(!find('efetuar o pagamento').responsavel.label.includes('Bloqueado'));
  assert.match(find('devolvida').responsavel.label, /Quem lançou \(Ana\)/);
  assert.match(find('confirmação do recebimento').responsavel.label, /Dona Socorro/);
  assert.match(find('Comissão').responsavel.label, /Master ou Diretor/);
  assert.ok(!rows.some(r => r.pendencia.includes('sem classificação')), 'despesa aprovada já classificada');
});

test('despesa sem classificação na DRE fica só com o Master', () => {
  const { rows } = buildPendencias({ users, now, expenses: [{ id: 'x', data: { status: 'pago', fornecedor: 'Água', valorTotal: 70 } }] });
  const row = rows.find(r => r.pendencia.includes('sem classificação'));
  assert.match(row.responsavel.label, /^Master — classificação na DRE \(Fernando Azeredo\)$/);
});

test('filtra "para mim" e "para a Dona Socorro"', () => {
  const { rows } = buildPendencias({ users, now,
    expenses: [{ id: 'a', data: { status: 'aprovado', fornecedor: 'Vivo', valorTotal: 180 } }, { id: 'b', data: { status: 'enviado_aprovacao', fornecedor: 'Light', valorTotal: 320 } }] });
  assert.equal(filterFor(rows, 'O que está pendente para a Dona Socorro?', '').rows.length, 2 - 1 + 0 + (rows.filter(r => r.pendencia.includes('sem classificação')).length ? 0 : 0));
  const mine = filterFor(rows, 'O que está pendente para mim?', 'Fernando Azeredo').rows;
  assert.ok(mine.every(r => /Fernando Azeredo/.test(r.responsavel.label)));
  assert.ok(mine.some(r => r.pendencia.includes('aguardando aprovação')));
  assert.match(renderPendencias(mine, { target: 'para você' }), /Light/);
});

test('reconhece perguntas de pendências', () => {
  for (const q of ['O que está pendente?', 'O que está pendente para mim?', 'Pendências da Tesouraria', 'O que eu tenho que fazer?', 'Quem é responsável pelas pendências?']) assert.ok(isPendingQuestion(q), q);
  assert.ok(!isPendingQuestion('Quais comissões estão pendentes?'));
});

test('filtra "pendências da Tesouraria"', () => {
  const { rows } = buildPendencias({ users, now, expenses: [{ id: 'a', data: { status: 'aprovado', fornecedor: 'Vivo', valorTotal: 180 } }, { id: 'b', data: { status: 'enviado_aprovacao', fornecedor: 'Light', valorTotal: 320 } }],
    classMap: new Map([['expense__a', { confirmed: true, accountCode: '4.05.28', accountDre: 'Despesas Administrativas' }]]) });
  const t = filterFor(rows, 'Pendências da Tesouraria', '');
  assert.equal(t.rows.length, 1);
  assert.match(t.rows[0].pendencia, /efetuar o pagamento/);
});

test('Jurídico (Reinaldo) responde por receitas, repasses e comissões; Socorro por comprovantes', () => {
  const team = [...users, { displayName: 'Reinaldo', role: 'gerente', status: 'active' }];
  const { rows } = buildPendencias({ users: team, now,
    expenses: [{ id: 'p', data: { status: 'pago', fornecedor: 'Light', valorTotal: 320 } }],
    receivables: [{ id: 'r', data: { status: 'rascunho', processo: '999', valorAlvara: 1000 } }],
    obligations: [{ type: 'Repasse de alvará', path: '/repasse-alvaras', data: { status: 'devolvido', beneficiary: 'Cliente Y', transferValue: 400 } }],
    classMap: new Map([['expense__p', { confirmed: true, accountCode: '4.05.28', accountDre: 'Despesas Administrativas' }]]) });
  const find = text => rows.find(r => r.pendencia.includes(text));
  assert.match(find('sem comprovante').responsavel.label, /Tesouraria — pagamentos e comprovantes \(Dona Socorro\)/);
  assert.match(find('Receita em rascunho').responsavel.label, /Jurídico — receitas, repasses e comissões \(Reinaldo\)/);
  assert.match(find('Repasse de alvará devolvido').responsavel.label, /Jurídico.*Reinaldo/);
  assert.equal(filterFor(rows, 'Pendências do Jurídico', '').rows.length, 2);
});
