import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedMovements, dueReport, renderDue, forecastReport, renderForecast, isDueQuestion, isForecastQuestion, horizonOf, dueAlerts } from '../planning.js';
import { isCreateRequest, buildDraft } from '../create-actions.js';
import { isDeleteRequest } from '../ai-core.js';

const today = '2026-11-16';
const data = {
  expenses: [
    { id: 'a', status: 'aprovado', fornecedor: 'Light', valorTotal: 320, paymentDate: '2026-11-10' },
    { id: 'b', status: 'aprovado', fornecedor: 'Vivo', valorTotal: 180, paymentDate: '2026-11-18' },
    { id: 'c', status: 'enviado_aprovacao', fornecedor: 'Aluguel', valorTotal: 5000, paymentDate: '2026-11-20' },
    { id: 'd', status: 'pago', fornecedor: 'Pago', valorTotal: 99, paymentDate: '2026-11-17' },
    { id: 'e', status: 'rascunho', fornecedor: 'Rascunho', valorTotal: 77, paymentDate: '2026-11-17' },
  ],
  receivables: [{ id: 'r', status: 'enviado_tesouraria', processo: '123', valorAlvara: 8000, dataPrevista: '2026-11-25' }],
  alvaraTransfers: [{ id: 't', status: 'aprovado', processo: '123', installments: [{ value: 1000, dueDate: '2026-11-16' }, { value: 1000, dueDate: '2026-12-16', paid: false }, { value: 500, paid: true, dueDate: '2026-10-01' }] }],
};

test('movimentos previstos seguem a regra do Fluxo de Caixa', () => {
  const m = plannedMovements(data);
  assert.equal(m.length, 6);
  assert.ok(!m.some(x => /Pago|Rascunho/.test(x.description)));
  assert.ok(m.find(x => x.description === 'Aluguel').awaitingApproval);
});
test('vencimentos: atrasados, hoje e próximos 7 dias', () => {
  const r = dueReport(plannedMovements(data), { today, days: 7 });
  assert.deepEqual(r.late.map(x => x.description), ['Light']);
  assert.equal(r.now.length, 1);
  assert.deepEqual(r.next.map(x => x.description), ['Vivo', 'Aluguel']);
  const text = renderDue(r, { today, days: 7 });
  assert.match(text, /6 dia\(s\) de atraso/);
  assert.match(text, /ainda aguardando aprovação/);
  assert.ok(dueAlerts(plannedMovements(data), today).some(a => /data vencida/.test(a)));
});
test('previsão de caixa 30 dias por semana, sem misturar aprovação pendente', () => {
  const r = forecastReport(plannedMovements(data), { today, days: 30 });
  const text = renderForecast(r, { today, days: 30 });
  assert.match(text, /Entradas previstas:\*\* R\$\s?8\.000,00/);
  assert.match(text, /Saídas previstas \(aprovadas\):\*\* R\$\s?2\.180,00/);
  assert.match(text, /aguardam aprovação:\*\* R\$\s?5\.000,00/);
  assert.match(text, /não é saldo bancário/i);
});
test('reconhece perguntas e pedidos', () => {
  for (const q of ['O que vence nos próximos 7 dias?', 'Quais pagamentos estão atrasados?', 'Vencimentos de hoje']) assert.ok(isDueQuestion(q), q);
  for (const q of ['Previsão de caixa dos próximos 30 dias', 'Quanto vamos receber nos próximos 15 dias?']) assert.ok(isForecastQuestion(q), q);
  assert.equal(horizonOf('próximos 15 dias', 30), 15);
  for (const q of ['Crie um rascunho de despesa da Light de R$ 320', 'Lance um rascunho de alvará do processo 123', 'Cadastre a despesa de aluguel']) assert.ok(isCreateRequest(q), q);
  for (const q of ['Como lançar despesas?', 'O que foi lançado ontem?', 'Quanto gastamos com luz?']) assert.equal(isCreateRequest(q), false, q);
  assert.equal(isDeleteRequest('Crie um rascunho de despesa'), false);
});
test('rascunho de despesa no formato da tela', () => {
  const chart = [{ code: '4.05.10', name: 'Energia Elétrica', category: 'Despesa', kind: 'account', dre: 'Despesas Administrativas' }];
  const bank = { id: 'itau', bank: 'Itaú', agency: '8548', account: '26486-3' };
  const d = buildDraft({ tipo: 'despesa', fornecedor: 'Light', historico: 'Conta de luz', valor: 320, vencimento: '2026-11-20', contaCodigo: '4.05.10' }, { chart, today, bank, company: 'FM' });
  assert.equal(d.collection, 'expenses');
  assert.equal(d.payload.status, 'rascunho');
  assert.equal(d.payload.valorTotal, 320);
  assert.equal(d.payload.items[0].historico, 'Conta de luz');
  assert.equal(d.payload.expenseAccountCode, '4.05.10');
  assert.equal(d.payload.paymentDate, '2026-11-20');
  const inv = buildDraft({ tipo: 'despesa', fornecedor: 'X', historico: 'Y', valor: 10, contaCodigo: '9.99' }, { chart, today, bank, company: 'FM' });
  assert.equal(inv.payload.expenseAccountCode, null);
  const alv = buildDraft({ tipo: 'alvara', processo: '123', reclamante: 'João', valor: 10000 }, { chart, today, bank, company: 'FM' });
  assert.equal(alv.collection, 'receivables');
  assert.equal(alv.payload.tipoRecebimento, undefined);
  assert.equal(alv.payload.status, 'rascunho');
  assert.match(buildDraft({ tipo: 'acordo', valor: 10 }, { chart, today, bank, company: 'FM' }).error, /pela tela/);
  assert.match(buildDraft({ tipo: 'despesa', valor: 0 }, { chart, today, bank, company: 'FM' }).error, /valor/);
});
