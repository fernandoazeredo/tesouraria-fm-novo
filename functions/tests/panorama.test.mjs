import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPanoramaQuestion, panoramaPeriod, renderPanorama } from '../panorama.js';

test('reconhece pedidos de resumo completo', () => {
  for (const q of ['Resumo completo de hoje', 'Resumo completo dos movimentos nesta data', 'Faça um resumo geral do escritório', 'Me dê uma visão geral do mês', 'Como estamos hoje?', 'Resumo completo desta semana']) assert.ok(isPanoramaQuestion(q), q);
  for (const q of ['Quanto gastamos com telefone em 2026?', 'Quais comissões estão pendentes?']) assert.ok(!isPanoramaQuestion(q), q);
});

test('período: hoje por padrão, mês e data citada', () => {
  assert.deepEqual(panoramaPeriod('Resumo completo', '2026-11-12').range, { from: '2026-11-12', to: '2026-11-12' });
  assert.equal(panoramaPeriod('Resumo completo deste mês', '2026-11-12').range.from, '2026-11-01');
  assert.equal(panoramaPeriod('Resumo completo de 10/11/2026', '2026-11-12').label, '10/11/2026');
});

test('monta o resumo com resultado e alertas', () => {
  const { answer, resultado } = renderPanorama({
    label: '01/11/2026 a 30/11/2026',
    entradas: { total: 5500 }, saidas: { total: 650 },
    approvals: { pendentes_quantidade: 1, pendentes_valor: 150, aprovados_hoje_quantidade: 0, aprovados_hoje_valor: 0, aprovados_mes_valor: 650, devolvidos_ou_rejeitados_hoje: 0 },
    tesouraria: { quantidade: 0, valor: 0 },
    alertas: ['1 item(ns) aguardando aprovação'],
  });
  assert.equal(resultado, 4850);
  assert.match(answer, /Resultado do período: R\$\s?4\.850,00/);
  assert.match(answer, /Entradas\*\* \(recebimentos confirmados\): \*\*R\$\s?5\.500,00/);
  assert.match(answer, /1 item\(ns\) aguardando aprovação/);
});
