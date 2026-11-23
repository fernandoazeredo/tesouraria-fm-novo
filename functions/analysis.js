// Análise financeira gerencial: os números são calculados aqui, a partir dos lançamentos do app;
// a IA só interpreta (não inventa valores). Somente leitura.
import { applyWindow } from './time-window.js';
import { FieldPath } from 'firebase-admin/firestore';
import { normalizeText, dateSP } from './ai-core.js';
import { readAll } from './financial-query.js';
import { loadPlanned, forecastReport, dueReport } from './planning.js';

const ANALYSIS = /\b(?:analise|analisar|analisa|diagnostico|parecer|avaliacao|avalie|saude financeira|raio[ -]?x|visao gerencial|consultoria)\b.*\b(?:financeir[ao]|gerencial|escritorio|negocio|resultado|caixa|desempenho|despesas?|custos?|gastos?|receitas?|margem|lucro|economizar)\b|\banalise (?:financeira|gerencial)\b|\bcomo (?:esta|vai) (?:a saude|o desempenho) financeir/;
export const isAnalysisQuestion = q => ANALYSIS.test(normalizeText(q));

const round = v => Math.round((Number(v) || 0) * 100) / 100;
const num = raw => { const v = Number(raw); return Number.isFinite(v) ? v : 0; };
const dateOf = raw => { const v = typeof raw === 'string' ? raw.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };
const tsDate = raw => { if (!raw) return ''; if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10); if (typeof raw.seconds === 'number') return new Date(raw.seconds * 1000).toISOString().slice(0, 10); return dateOf(raw); };
const comp = (item, name) => num((Array.isArray(item.components) ? item.components : []).find(c => String(c?.nome || '').toLowerCase() === name.toLowerCase())?.valor);
const monthKey = d => (d || '').slice(0, 7);

/** Métricas gerenciais dos últimos 12 meses (pura; recebe os registros). */
export function analysisMetrics({ receivables = [], expenses = [], classifications = [], alvaraTransfers = [], agentCommissions = [], societaryTransfers = [] }, today) {
  const months = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const inWindow = k => k >= months[0] && k <= months[11];
  const byMonth = Object.fromEntries(months.map(k => [k, { receitas: 0, honorarios: 0, despesas: 0 }]));
  const byType = {};
  let receitasQtd = 0;
  for (const r of receivables) {
    if (!['recebido_tesouraria', 'encerrado'].includes(String(r.status))) continue;
    const k = monthKey(dateOf(r.receiptDate) || dateOf(r.data) || tsDate(r.treasuryAt));
    if (!inWindow(k)) continue;
    const valor = num(r.valorAlvara);
    byMonth[k].receitas += valor;
    byMonth[k].honorarios += comp(r, 'Honorários do Escritório');
    const tipo = String(r.tipoRecebimento || 'alvara');
    byType[tipo] = round((byType[tipo] || 0) + valor);
    receitasQtd += 1;
  }
  const classMap = new Map(classifications.map(c => [c.id, c]));
  const byAccount = {};
  let despesasQtd = 0, semConta = 0;
  for (const e of expenses) {
    if (!['aprovado', 'pago', 'arquivado'].includes(String(e.status))) continue;
    const k = monthKey(dateOf(e.paymentDate) || (/^\d{4}-\d{2}$/.test(String(e.competencia || '')) ? `${e.competencia}-01` : ''));
    if (!inWindow(k)) continue;
    const valor = num(e.valorTotal);
    byMonth[k].despesas += valor;
    const c = classMap.get(`expense__${e.id}`);
    const code = String(c?.accountCode || e.expenseAccountCode || '').trim();
    const name = String(c?.accountName || e.expenseAccountName || '').trim();
    const key = code ? `${code} ${name}`.trim() : 'Sem conta classificada';
    if (!code) semConta += 1;
    byAccount[key] = round((byAccount[key] || 0) + valor);
    despesasQtd += 1;
  }
  const pendingOf = (items, statuses) => items.filter(i => statuses.includes(String(i.status))).reduce((s, i) => s + Math.max(0, num(i.amountDue ?? i.netAmountDue ?? i.transferValue) - num(i.paidValue)), 0);
  const totals = Object.values(byMonth).reduce((a, v) => ({ receitas: a.receitas + v.receitas, honorarios: a.honorarios + v.honorarios, despesas: a.despesas + v.despesas }), { receitas: 0, honorarios: 0, despesas: 0 });
  const mesesComMovimento = Object.values(byMonth).filter(v => v.receitas || v.despesas).length;
  return {
    periodo: `${months[0]} a ${months[11]}`,
    meses: months.map(k => ({ mes: k, receitas: round(byMonth[k].receitas), honorarios_escritorio: round(byMonth[k].honorarios), despesas: round(byMonth[k].despesas), resultado_honorarios_menos_despesas: round(byMonth[k].honorarios - byMonth[k].despesas) })),
    totais: { receitas_recebidas: round(totals.receitas), honorarios_escritorio: round(totals.honorarios), despesas_efetivas: round(totals.despesas), resultado_honorarios_menos_despesas: round(totals.honorarios - totals.despesas), margem_sobre_honorarios_pct: totals.honorarios ? round(((totals.honorarios - totals.despesas) / totals.honorarios) * 100) : null },
    receitas_por_tipo: byType,
    despesas_por_conta_top10: Object.entries(byAccount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([conta, valor]) => ({ conta, valor, pct_das_despesas: totals.despesas ? round((valor / totals.despesas) * 100) : 0 })),
    repasses_a_pagar: {
      repasse_de_alvaras: round(pendingOf(alvaraTransfers, ['aprovado', 'parcialmente_pago', 'aguardando_aprovacao'])),
      comissoes_agentes: round(pendingOf(agentCommissions, ['aprovado', 'parcialmente_pago', 'aguardando_aprovacao'])),
      repasse_societario: round(pendingOf(societaryTransfers, ['apurado', 'aguardando_aprovacao', 'aprovado', 'enviado_tesouraria'])),
    },
    qualidade_dos_dados: { receitas_no_periodo: receitasQtd, despesas_no_periodo: despesasQtd, despesas_sem_conta: semConta, meses_com_movimento: mesesComMovimento },
  };
}

const INSTRUCTIONS = [
  'Você é o controller/CFO de um escritório de advocacia trabalhista (Flávio Marques Advogados Associados) e escreve uma análise financeira gerencial para o sócio administrador.',
  'Use SOMENTE os números do JSON recebido. Não invente valores, percentuais ou fatos. Cite os valores em R$ no formato brasileiro.',
  'Conceitos: "receitas_recebidas" é o valor bruto dos alvarás/recebimentos (inclui dinheiro do cliente). A receita do escritório são os "honorarios_escritorio". "Repasse de alvarás" é dinheiro do cliente, não despesa. O resultado gerencial é honorários do escritório menos despesas efetivas. Previsão de caixa não é saldo bancário.',
  'Estrutura (títulos com ###): Resumo executivo (3 a 5 linhas); Receita e honorários; Despesas (maiores contas e concentração); Resultado e margem; Caixa: vencimentos e previsão 30 dias; Riscos e alertas; Recomendações práticas (3 a 6 itens objetivos).',
  'Compare meses quando houver dados (tendência, sazonalidade, melhor e pior mês). Se houver poucos dados (poucos meses com movimento ou poucos lançamentos), diga isso no início e limite as conclusões.',
  'Aponte problemas de qualidade dos dados que afetam a análise (ex.: despesas sem conta classificada).',
  'Não dê recomendação de investimento. Seja direto, sem rodeios, em português do Brasil.',
].join('\n');

export async function buildAnalysisAnswer(db, question, { key, model, now = new Date() }) {
  const today = dateSP(now.toISOString());
  const all = name => readAll(db.collection(name).orderBy(FieldPath.documentId())).then(docs => docs.map(d => ({ id: d.id, ...d.data() })));
  const loaded = await Promise.all(
    ['receivables', 'expenses', 'managerialClassifications', 'alvaraTransfers', 'agentCommissions', 'societaryTransfers'].map(all));
  // Janela padrão de 12 meses; classificações (managerialClassifications) não são filtradas.
  const win = list => applyWindow(list, question, { now });
  const [receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers] = [loaded[0], loaded[1], loaded[3], loaded[4], loaded[5]].map(list => win(list).items);
  const classifications = loaded[2];
  const fullHistory = win([]).full;
  const metrics = analysisMetrics({ receivables, expenses, classifications, alvaraTransfers, agentCommissions, societaryTransfers }, today);
  let caixa = null;
  try {
    const moves = await loadPlanned(db);
    const f = forecastReport(moves, { today, days: 30 });
    const d = dueReport(moves, { today, days: 7 });
    caixa = { previsao_30_dias: f, vencimentos_7_dias: d };
  } catch (error) { console.warn('Previsão indisponível', error?.name); }
  const payload = { hoje: today, pergunta: question, janela: fullHistory ? 'histórico completo' : 'últimos 12 meses + lançamentos em aberto (cite o ano para incluir períodos anteriores)', ...metrics, caixa };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      contents: [{ role: 'user', parts: [{ text: `Dados do aplicativo (JSON):\n${JSON.stringify(payload).slice(0, 60000)}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`IA HTTP ${response.status}`);
  const json = await response.json();
  const answer = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
  if (!answer) throw new Error('IA sem resposta');
  return {
    answer: `## Análise financeira gerencial\n\n${answer}`.slice(0, 16000),
    consultedAt: new Date().toISOString(),
    sources: [
      { modulo: 'Receitas', caminho: '/alvaras', parcial: false, registros: metrics.qualidade_dos_dados.receitas_no_periodo },
      { modulo: 'Despesas', caminho: '/despesas', parcial: false, registros: metrics.qualidade_dos_dados.despesas_no_periodo },
      { modulo: 'Fluxo de Caixa', caminho: '/fluxo-caixa', parcial: false, registros: 0 },
    ],
    disclaimer: `Análise de ${metrics.periodo} (12 meses), com números calculados pelo sistema a partir dos lançamentos; a interpretação é da IA. Não é saldo bancário nem recomendação de investimento.`,
  };
}
