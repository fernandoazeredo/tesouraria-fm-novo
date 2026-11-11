import test from 'node:test';
import assert from 'node:assert/strict';
import { isArithmeticQuestion, normalizePlan, renderArithmetic, totalOf } from '../financial-math.js';

test('reconhece pedidos de soma e diferença', () => {
  assert.ok(isArithmeticQuestion('Quanto gastei em 2026 com energia elétrica mais telefone somados? E qual a diferença entre o gasto com energia e o gasto com telefone?'));
  assert.ok(isArithmeticQuestion('Qual a diferença entre o que gastamos com luz e com telefone este ano?'));
  assert.ok(isArithmeticQuestion('Some os gastos de energia e telefone de 2026'));
  assert.ok(isArithmeticQuestion('Quanto recebemos de alvarás menos o que gastamos com aluguel em 2026?'));
  assert.ok(!isArithmeticQuestion('Quanto eu gastei com energia elétrica esse ano de 2026?'));
  assert.ok(!isArithmeticQuestion('Quais comissões estão pendentes?'));
});

test('total soma os lançamentos encontrados pelo sistema', () => {
  assert.equal(totalOf({ details: [{ value: 320 }, { value: 0.1 }, { value: 0.2 }] }), 320.3);
  assert.equal(totalOf({ details: [] }), 0);
});

test('valida a decomposição do modelo', () => {
  assert.equal(normalizePlan({ operacao: 'soma', itens: [{ rotulo: 'Luz', pergunta: 'Quanto gastamos com luz em 2026?' }] }), null);
  assert.equal(normalizePlan({ operacao: 'outra', itens: [{ rotulo: 'A', pergunta: 'Quanto A?' }, { rotulo: 'B', pergunta: 'Quanto B?' }] }), null);
  const three = normalizePlan({ operacao: 'diferenca', itens: [1, 2, 3].map(i => ({ rotulo: `I${i}`, pergunta: `Quanto gastamos com ${i}?` })) });
  assert.equal(three.operacao, 'soma');
});

test('soma e diferença exatas, com sinal e maior item', () => {
  const plan = normalizePlan({ operacao: 'soma_e_diferenca', itens: [
    { rotulo: 'Energia elétrica', pergunta: 'Quanto gastamos com energia elétrica em 2026?' },
    { rotulo: 'Telefone', pergunta: 'Quanto gastamos com telefone em 2026?' },
  ] });
  const r = renderArithmetic(plan, [320, 180]);
  assert.equal(r.soma, 500);
  assert.equal(r.diferenca, 140);
  assert.match(r.answer, /R\$\s?500,00/);
  assert.match(r.answer, /R\$\s?140,00/);
  assert.match(r.answer, /Energia elétrica foi maior/);
  const d = renderArithmetic({ operacao: 'diferenca', itens: plan.itens }, [0.1 + 0.2, 0.3]);
  assert.equal(d.diferenca, 0);
});
