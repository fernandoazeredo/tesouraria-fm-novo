import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationMatches, classificationTarget, expenseRow, expenseSummary, filterPeriod, financialDetails,
  financialIntent, periodOf, readAll, renderFinancial, revenueRows, sumFinancial,
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
