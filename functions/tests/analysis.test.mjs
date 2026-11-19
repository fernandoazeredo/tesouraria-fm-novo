import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisMetrics, isAnalysisQuestion } from '../analysis.js';

test('reconhece pedidos de análise gerencial e não confunde com consultas', () => {
  assert.equal(isAnalysisQuestion('Faça uma análise financeira gerencial do escritório'), true);
  assert.equal(isAnalysisQuestion('Analise as despesas e onde posso economizar'), true);
  assert.equal(isAnalysisQuestion('Quanto gastamos em outubro?'), false);
  assert.equal(isAnalysisQuestion('Resumo completo deste mês'), false);
});

test('calcula 12 meses, honorários, despesas por conta e repasses', () => {
  const m = analysisMetrics({
    receivables: [
      { id: 'r1', status: 'recebido_tesouraria', receiptDate: '2026-11-03', valorAlvara: 10000, components: [{ nome: 'Honorários do Escritório', valor: 3000 }] },
      { id: 'r2', status: 'enviado_tesouraria', receiptDate: '2026-11-04', valorAlvara: 999 },
      { id: 'r3', status: 'encerrado', receiptDate: '2025-01-10', valorAlvara: 5000 },
    ],
    expenses: [
      { id: 'e1', status: 'pago', paymentDate: '2026-10-10', valorTotal: 800, expenseAccountCode: '4.07.02', expenseAccountName: 'Aluguel' },
      { id: 'e2', status: 'aprovado', competencia: '2026-11', valorTotal: 200 },
      { id: 'e3', status: 'rascunho', competencia: '2026-11', valorTotal: 50 },
    ],
    alvaraTransfers: [{ status: 'aprovado', amountDue: 6000, paidValue: 1000 }],
  }, '2026-11-19');
  assert.equal(m.meses.length, 12);
  assert.equal(m.periodo, '2025-12 a 2026-11');
  assert.equal(m.totais.receitas_recebidas, 10000);
  assert.equal(m.totais.honorarios_escritorio, 3000);
  assert.equal(m.totais.despesas_efetivas, 1000);
  assert.equal(m.totais.resultado_honorarios_menos_despesas, 2000);
  assert.equal(m.despesas_por_conta_top10[0].conta, '4.07.02 Aluguel');
  assert.equal(m.qualidade_dos_dados.despesas_sem_conta, 1);
  assert.equal(m.repasses_a_pagar.repasse_de_alvaras, 5000);
});
