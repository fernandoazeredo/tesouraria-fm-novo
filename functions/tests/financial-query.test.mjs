import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationMatches, classificationTarget, expenseRow, expenseSummary, filterPeriod, financialDetails,
  financialIntent, financialRequest, periodOf, readAll, renderFinancial, revenueRows, sumFinancial,
} from '../financial-query.js';

const today = '2026-11-11';
const energy = { confirmed: true, accountCode: '4.07.05', accountName: 'Energia Elétrica', accountDre: 'Despesas Administrativas' };
const phone = { ...energy, accountCode: '4.05.28', accountName: 'Telefonia Móvel (Celular, Nextel e Etc.)' };
const expense = { fornecedor: 'Demonstrativo', competencia: '2026-11', unidade: 'RJ', status: 'pago', valorTotal: 'R$ 12,34',
  items: [{ data: '2026-11-02', historico: 'Demonstrativo' }, { data: '2026-11-02', historico: 'Conta de luz do escritório' }] };

test('lê mais de duas páginas completas e também a última linha', async () => {
  const docs = Array.from({ length: 503 }, (_, id) => ({ id }));
  function query(offset) {
    return {
      limit: size => ({ get: async () => ({ docs: docs.slice(offset, offset + size) }) }),
      startAfter: cursor => query(cursor.id + 1),
    };
  }
  assert.deepEqual(await readAll(query(0)), docs);
});

test('soma centenas de despesas da conta em centavos e informa as sem classificação', () => {
  const intent = financialIntent('Quanto gastamos com energia elétrica em 2026?', today);
  const rows = [
    ...Array.from({ length: 502 }, (_, id) => expenseRow(String(id), expense, energy)),
    expenseRow('telefone', expense, phone),
    expenseRow('sem-classificacao', expense),
    expenseRow('nao-confirmada', expense, { ...energy, confirmed: false }),
    expenseRow('rascunho', { ...expense, status: 'rascunho' }, energy),
    expenseRow('2025', { ...expense, items: [{ data: '2025-11-02' }] }, energy),
  ];
  const result = expenseSummary(rows, intent);
  assert.equal(sumFinancial(result.rows), 619468);
  assert.equal(sumFinancial(result.pending), 2468);
  assert.equal(financialDetails(result.rows).length, 502);
  assert.match(renderFinancial(intent, result.rows, result.pending), /502 lançamento\(s\)/);
});

test('resolve contas oficiais, o grupo e a última linha de histórico em outro campo', () => {
  const q = 'Classifique a despesa referente à conta de luz como despesa administrativa plano de contas 4.07.05 em despesa de eletricidade escritório RJ';
  const intent = financialIntent(q, today);
  assert.equal(classificationTarget(q).code, energy.accountCode);
  assert.equal(classificationTarget('Classifique a despesa de conta de luz como Energia Elétrica, 4.05.27'), null);
  assert.deepEqual(classificationMatches([
    expenseRow('certo', expense),
    expenseRow('unidade', { ...expense, unidade: 'SP' }),
    expenseRow('historico', { ...expense, items: [{ historico: 'Outra conta' }] }),
    expenseRow('pendente', { ...expense, status: 'em_analise' }),
  ], q, intent).map(row => row.id), ['certo']);
});

test('telefone engloba fixa e móvel e admite comparação entre exercícios', () => {
  const intent = financialIntent('Quanto gastamos com telefone em 2026 e 2025?', today);
  assert.deepEqual(intent.alias.codes, ['4.05.27', '4.05.28']);
  assert.deepEqual(intent.periods.map(range => range.from), ['2026-01-01', '2025-01-01']);
  assert.equal(periodOf('quanto gastamos em fevereiro de 2024', today)[0].to, '2024-02-29');
  assert.deepEqual(periodOf('quanto recebemos de 2024 a 2026', today), [{ from: '2024-01-01', to: '2026-12-31' }]);
  assert.deepEqual(periodOf('em 31/02/2026', today), []);
});

test('receitas trabalhistas usam data efetiva, tipo e parcela, sem somar valores previstos', () => {
  const intent = financialIntent('Quanto recebemos de acordos ou alvarás de ações trabalhistas em 2025?', today);
  const alvara = { origem: 'Alvará', natureza: 'Trabalhista', processo: 'Processo', reclamante: 'Parte',
    status: 'recebido_tesouraria', receiptDate: '2025-12-30', data: '2026-01-03', valorAlvara: 900, invoiceValue: 300 };
  const acordo = { tipoRecebimento: 'acordo_trabalhista', origem: 'Acordo Trabalhista', status: 'encerrado',
    valorAlvara: 5500, parcelas: [
      { numero: 1, dataRealizada: '2025-12-28', valorParcela: 1200, honorarios: 360 },
      { numero: 2, dataRealizada: '2026-01-28', valorParcela: 1200 },
      { numero: 3, dataPrevista: '2025-12-22', valorParcela: 1200 },
    ] };
  const rows = filterPeriod([alvara, acordo, { ...alvara, natureza: 'Cível' }, { ...alvara, status: 'enviado_tesouraria' },
    { ...acordo, status: 'rascunho' }].flatMap(record => revenueRows(record, intent)), intent.periods);
  assert.equal(sumFinancial(rows), 210000);
  assert.deepEqual(rows.map(row => [row.label, row.fees]), [['Alvarás trabalhistas', 30000], ['Acordos trabalhistas', 36000]]);
});


test('entende o ano abreviado sem confundir dia ou código contábil com ano', () => {
  const year = [{ from: '2026-01-01', to: '2026-12-31' }];
  assert.deepEqual(periodOf('Qual foi nosso gasto com eletricidade no ano de 26?', today), year);
  assert.deepEqual(periodOf('Quanto gastamos em 26 de eletricidade?', today), year);
  assert.deepEqual(periodOf('Quanto gastamos em 26/10/2025?', today), [{ from: '2025-10-26', to: '2025-10-26' }]);
  assert.equal(periodOf('Quanto gastamos na conta 4.05.26?', today), null);
});

test('separa recebimentos e despesas na mesma pergunta e herda o período omitido', () => {
  const request = financialRequest('Qual foi o valor recebido no ano de 26 de acordos trabalhistas e qual foi o valor de alvarás? A mesma coisa na despesa, qual foi nosso gasto de eletricidade e conta de luz no RJ?', today);
  assert.equal(request.kind, 'mixed');
  const [revenue, expense] = request.queries;
  assert.equal(revenue.kind, 'revenue');
  assert.equal(revenue.type, 'ambos');
  assert.equal(revenue.unit, '');
  assert.equal(expense.kind, 'expense');
  assert.equal(expense.unit, 'RJ');
  assert.deepEqual(expense.alias.codes, ['4.07.05']);
  assert.deepEqual(expense.periods, [{ from: '2026-01-01', to: '2026-12-31' }]);
  assert.deepEqual(revenue.periods, expense.periods);
});

test('preserva períodos distintos e a ordem dos pedidos de despesas e receitas', () => {
  const request = financialRequest('Qual foi o nosso gasto com conta de luz em 2025 e quanto recebemos de alvarás trabalhistas no ano 26?', today);
  assert.deepEqual(request.queries.map(q => [q.kind, q.periods[0].from]), [['expense', '2025-01-01'], ['revenue', '2026-01-01']]);
  const single = financialRequest('Qual foi o valor recebido no ano de 26 de acordos trabalhistas e qual foi o valor de alvarás?', today);
  assert.equal(single.kind, 'revenue');
  assert.equal(single.type, 'ambos');
  assert.equal(single.periods[0].from, '2026-01-01');
});

test('outras receitas citadas junto com alvarás e acordos entram no total', async () => {
  const { financialRequest, revenueRows } = await import('../financial-query.js');
  const other = { status: 'encerrado', tipoRecebimento: 'outras_receitas', origem: 'Outras Receitas', receiptDate: '2026-11-10', valorAlvara: 500, unidade: 'RJ' };
  const all = financialRequest('Quanto recebemos em 2026? Separe por alvarás, acordos e outras receitas.', '2026-11-11');
  assert.equal(revenueRows(other, all).length, 1);
  const labor = financialRequest('Quanto recebemos em 2026 de alvarás e acordos trabalhistas?', '2026-11-11');
  assert.equal(revenueRows(other, labor).length, 0);
});

test('sem recebimento no período: mostra pendentes da Tesouraria e o último recebido', async () => {
  const { financialRequest, revenueRows, revenueContext, filterPeriod } = await import('../financial-query.js');
  const intent = financialRequest('Qual valor das receitas hoje', '2026-11-11');
  const records = [
    { status: 'encerrado', tipoRecebimento: 'outras_receitas', origem: 'Outras Receitas', descricaoOrigem: 'Aporte', receiptDate: '2026-11-10', valorAlvara: 500, unidade: 'RJ' },
    { status: 'enviado_tesouraria', origem: 'Alvará', natureza: 'Trabalhista', processo: '9', reclamante: 'x', data: '2026-11-11', valorAlvara: 800, unidade: 'RJ' },
  ];
  const all = records.flatMap(r => revenueRows(r, intent));
  assert.equal(filterPeriod(all, intent.periods).length, 0);
  const ctx = revenueContext(records, intent, all);
  assert.match(ctx, /Aguardando confirmação da Tesouraria: 1 lançamento\(s\), R\$\s?800,00/);
  assert.match(ctx, /Último recebimento confirmado: \*\*10\/11\/2026\*\*/);
  assert.match(ctx, /R\$\s?500,00/);
});

test('classificação: nome completo do fornecedor desempata entre despesas parecidas', async () => {
  const { expenseRow, classificationMatches, financialRequest } = await import('../financial-query.js');
  const rows = [['b', 'TESTE IA - Light'], ['c', 'TESTE IA - Vivo'], ['d', 'TESTE IA - Fornecedor Teste']]
    .map(([id, f]) => expenseRow(id, { fornecedor: f, status: 'aprovado', competencia: '2026-11', valorTotal: 150, items: [{ data: '2026-11-11', historico: 'TESTE IA' }] }));
  const q = 'Classifique a despesa do fornecedor TESTE IA - Fornecedor Teste como Material de Escritório';
  assert.deepEqual(classificationMatches(rows, q, financialRequest(q, '2026-11-11')).map(r => r.id), ['d']);
  const all = 'Classifique as despesas TESTE IA como Material de Escritório';
  assert.equal(classificationMatches(rows, all, financialRequest(all, '2026-11-11')).length, 3);
});
