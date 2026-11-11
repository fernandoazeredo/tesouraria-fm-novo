import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeChart, modelAccountSelection, selectAccounts, selectedLeaves } from '../account-query.js';
import { officialChartOfAccounts } from '../chart-of-accounts.js';
import { financialRequest } from '../financial-query.js';
import { readActiveChart, runFinancial } from '../financial-actions.js';

const chart = officialChartOfAccounts;
const today = '2026-11-11';
const doc = (id, data) => ({ id, data: () => data });
function dbFor(rows) {
  function query(docs, offset = 0) {
    return {
      orderBy: () => query(docs),
      startAfter: last => query(docs, docs.indexOf(last) + 1),
      limit: count => ({ get: async () => ({ docs: docs.slice(offset, offset + count) }) }),
    };
  }
  return { collection: name => query(rows[name] ?? []) };
}

test('localiza cada um dos 202 códigos oficiais no catálogo e identifica contas e grupos', async () => {
  assert.equal(chart.length, 202);
  for (const account of chart) {
    const request = financialRequest('Qual é a conta ' + account.code + '?', today, chart);
    assert.equal(request.kind, 'plan', account.code);
    assert.deepEqual(request.selection.entries, [account], account.code);
    const byName = selectAccounts(account.name, chart, account.category);
    assert.ok(byName.entries.some(entry => entry.code === account.code), account.name);
    if (account.kind === 'account' && ['Despesa', 'Receita'].includes(account.category)) {
      const total = financialRequest('Qual o valor da conta ' + account.code + ' em 2026?', today, chart);
      assert.equal(total.kind, account.category === 'Despesa' ? 'expense' : 'revenue', account.code);
      assert.deepEqual(total.leaves.map(leaf => leaf.code), [account.code], account.code);
    }
  }
  const all = financialRequest('Liste todas as contas do plano de contas', today, chart);
  assert.equal(all.selection.entries.length, 202);
  const result = await runFinancial(dbFor({}), all);
  assert.equal(result.answer.split('\n').filter(line => /^- \*\*\d/.test(line)).length, 202);
  const group = selectAccounts('conta 4.07', chart);
  assert.ok(selectedLeaves(chart, group.entries).some(entry => entry.code === '4.07.05'));
});

test('usa o plano importado do Firestore e preserva o catálogo padrão na ausência dele', async () => {
  const imported = [
    { code: '3.90', name: 'Receitas Contratuais Novas', kind: 'group', category: 'Receita' },
    { code: '3.90.01', name: 'Recebimento Licença Anual', kind: 'account', category: 'Receita', dre: 'Receitas de Teste' },
    { code: '4.90.02', name: 'Manutenção de Servidores Fictícia', kind: 'account', category: 'Despesa', dre: 'Despesas Administrativas' },
  ];
  const actual = await readActiveChart(dbFor({ chartOfAccounts: imported.map(item => doc(item.code, item)) }));
  assert.equal(actual.length, 3);
  assert.deepEqual(activeChart([]), chart);
  assert.equal(financialRequest('Quanto recebemos no grupo 3.90 no ano de 26?', today, actual).leaves[0].code, '3.90.01');
  assert.equal(financialRequest('Quanto gastamos com manutenção de servidores fictícia?', today, actual).leaves[0].code, '4.90.02');
  assert.equal(financialRequest('Quanto gastamos na conta 4.99.99?', today, actual).kind, 'plan');
});

test('calcula despesas e receitas pelos códigos cadastrados sem misturar a DRE com os lançamentos', async () => {
  const db = dbFor({
    expenses: [
      doc('a', { status: 'pago', competencia: '2026-01', valorTotal: 100, expenseAccountCode: '4.07.05' }),
      doc('b', { status: 'aprovado', competencia: '2026-01', valorTotal: 300 }),
      doc('c', { status: 'pago', competencia: '2025-01', valorTotal: 500, expenseAccountCode: '4.07.05' }),
    ],
    managerialClassifications: [
      doc('expense__b', { accountCode: '4.07.05', accountDre: 'Despesas Administrativas', confirmed: true }),
    ],
    receivables: [
      doc('a', { tipoRecebimento: 'outras_receitas', status: 'encerrado', receiptDate: '2026-02-20', valorAlvara: 700, revenueAccountCode: '3.02.01' }),
      doc('b', { tipoRecebimento: 'outras_receitas', status: 'encerrado', receiptDate: '2025-02-20', valorAlvara: 800, revenueAccountCode: '3.02.01' }),
      doc('c', { tipoRecebimento: 'outras_receitas', status: 'enviado_tesouraria', receiptDate: '2026-02-20', valorAlvara: 900, revenueAccountCode: '3.02.01' }),
      doc('d', { tipoRecebimento: 'outras_receitas', status: 'encerrado', receiptDate: '2026-02-20', valorAlvara: 250, revenueAccountCode: '3.02.02' }),
    ],
  });
  const ask = q => runFinancial(db, financialRequest(q, today, chart));
  assert.deepEqual((await ask('Quanto gastamos na conta 4.07.05 em 26?')).details.map(row => row.value), [100, 300]);
  assert.deepEqual((await ask('Qual o valor na DRE da conta 4.07.05 em 26?')).details.map(row => row.value), [300]);
  assert.deepEqual((await ask('Quanto gastamos com energia elétrica em 26?')).details.map(row => row.value), [300]);
  assert.equal(financialRequest('Quanto gastamos na conta ininteligível em 2026?', today, chart).suggest.category, 'Despesa');
  assert.deepEqual((await ask('Quanto recebemos de Receitas Financeiras em 2026?')).details.map(row => row.value), [700, 250]);
  assert.deepEqual((await ask('Quanto entrou na conta 3.02.02 em 2026?')).details.map(row => row.value), [250]);
});

test('valida a sugestão do modelo contra o catálogo sem aceitar códigos inventados', () => {
  assert.equal(modelAccountSelection({ codes: ['4.99.99'], certain: true }, chart, 'Despesa'), null);
  assert.equal(modelAccountSelection({ codes: ['3.02.01'], certain: true }, chart, 'Despesa'), null);
  assert.equal(modelAccountSelection({ codes: ['4.07.05'], certain: false }, chart, 'Despesa').ambiguous, true);
  assert.equal(modelAccountSelection({ codes: ['4.07.05'], certain: true }, chart, 'Despesa').entries[0].name, 'Energia Elétrica');
});


test('orienta a classificação e informa os totais do cadastro por natureza', async () => {
  const ask = q => runFinancial(dbFor({}), financialRequest(q, today, chart));
  const guidance = await ask('Qual conta uso para classificar um gasto com conta de luz?');
  assert.match(guidance.answer, /4\.07\.05 — Energia Elétrica.*Despesas Administrativas/);
  const count = await ask('Quantas contas tem o Plano de Contas?');
  assert.match(count.answer, /202 códigos.*19 grupos e 183 contas finais/);
  assert.match(count.answer, /Receita: 22.*Despesa: 137.*Patrimonial \/ Dívida: 24/);
});

test('reconhece conta no singular quando o plano está no plural', async () => {
  const { classificationTarget } = await import('../financial-query.js');
  const { officialChartOfAccounts } = await import('../chart-of-accounts.js');
  assert.equal(classificationTarget('Classifique a despesa do fornecedor X como Material de Escritório', officialChartOfAccounts)?.code, '4.05.20');
  assert.equal(classificationTarget('Classifique a despesa da Light como Energia Elétrica', officialChartOfAccounts)?.code, '4.07.05');
});
