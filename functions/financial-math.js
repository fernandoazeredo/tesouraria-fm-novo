// Cálculos combinados (soma e diferença) sobre totais que o próprio sistema calcula.
// A IA só decompõe a pergunta em itens; os valores e as contas vêm do motor financeiro.
import { normalizeText } from './ai-core.js';

const ARITH = /\b(?:somad[oa]s?|somar|somando|some|soma|juntos|juntas|ao todo|no total|total de|adicionad[oa]s?|diferenca|menos|subtrai\w*|subtrac\w*|descontad[oa]s?|descontando|a mais (?:que|do que)|a menos (?:que|do que)|compar\w*|versus|x)\b/;

/** Pergunta que pede um cálculo entre dois ou mais valores (soma, diferença ou comparação). */
export function isArithmeticQuestion(question) {
  const q = normalizeText(question);
  if (!ARITH.test(q)) return false;
  // Precisa haver pelo menos dois assuntos ligados por "e", "mais", "menos", "com" ou vírgula.
  return /\b(?:e|mais|menos|com|versus|x)\b|,/.test(q.replace(ARITH, ' '));
}

const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const round = value => Math.round((Number(value) || 0) * 100) / 100;

/** Total de uma consulta já calculada pelo motor financeiro (soma dos lançamentos encontrados). */
export function totalOf(result) {
  return round((result?.details ?? []).reduce((sum, row) => sum + (Number(row.value) || 0), 0));
}

/** Valida a decomposição devolvida pelo modelo. */
export function normalizePlan(plan) {
  const items = (Array.isArray(plan?.itens) ? plan.itens : [])
    .map(item => ({ rotulo: String(item?.rotulo ?? '').trim().slice(0, 80), pergunta: String(item?.pergunta ?? '').trim().slice(0, 300) }))
    .filter(item => item.rotulo && item.pergunta.length >= 5)
    .slice(0, 6);
  const operacao = ['soma', 'diferenca', 'soma_e_diferenca'].includes(plan?.operacao) ? plan.operacao : null;
  if (items.length < 2 || !operacao) return null;
  if (operacao !== 'soma' && items.length !== 2) return { operacao: 'soma', itens: items };
  return { operacao, itens: items };
}

/** Monta a resposta com os valores de cada item, a soma e/ou a diferença. */
export function renderArithmetic(plan, values) {
  const lines = ['**Cálculo solicitado** (valores calculados pelo sistema)', ''];
  plan.itens.forEach((item, index) => lines.push(`- ${item.rotulo}: **${brl(values[index])}**`));
  lines.push('');
  const result = {};
  if (plan.operacao === 'soma' || plan.operacao === 'soma_e_diferenca') {
    result.soma = round(values.reduce((sum, value) => sum + value, 0));
    lines.push(`- **Soma:** ${plan.itens.map(item => item.rotulo).join(' + ')} = **${brl(result.soma)}**`);
  }
  if (plan.operacao === 'diferenca' || plan.operacao === 'soma_e_diferenca') {
    result.diferenca = round(values[0] - values[1]);
    lines.push(`- **Diferença:** ${plan.itens[0].rotulo} − ${plan.itens[1].rotulo} = **${brl(result.diferenca)}**`);
    if (result.diferenca !== 0) {
      const maior = result.diferenca > 0 ? plan.itens[0].rotulo : plan.itens[1].rotulo;
      lines.push('', `${maior} foi maior em ${brl(Math.abs(result.diferenca))}.`);
    }
  }
  return { answer: lines.join('\n'), ...result };
}
