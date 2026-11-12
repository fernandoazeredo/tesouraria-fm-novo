// Resumo completo: uma única resposta com entradas, saídas, resultado, aprovações, Tesouraria e alertas.
// Todos os valores vêm do motor financeiro e das filas do sistema; a IA não calcula nada aqui.
import { FieldPath } from 'firebase-admin/firestore';
import { normalizeText, APPROVAL_SOURCES, APPROVAL_DECIDED, buildApprovalQueue, approvalTotals, dateSP } from './ai-core.js';
import { periodOf, readAll } from './financial-query.js';
import { totalOf } from './financial-math.js';

const PANORAMA = /\b(?:resumo (?:completo|geral|do dia|da semana|do mes|de hoje|dos movimentos|financeiro)|panorama|visao (?:geral|completa)|como (?:esta|estamos|ficou|ficamos)(?: o escritorio| o financeiro)?(?: hoje| nesta data| esta semana| este mes)?|tudo de uma (?:unica )?vez|movimentos (?:de hoje|do dia|desta data|nesta data))\b/;

export function isPanoramaQuestion(question) {
  return PANORAMA.test(normalizeText(question));
}

const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const shown = iso => iso.split('-').reverse().join('/');
const round = value => Math.round((Number(value) || 0) * 100) / 100;

/** Período do resumo: o citado na pergunta ou, se nenhum, hoje. */
export function panoramaPeriod(question, today) {
  const periods = periodOf(question, today);
  const range = periods?.length ? periods[0] : { from: today, to: today };
  const label = range.from === range.to ? shown(range.from) : `${shown(range.from)} a ${shown(range.to)}`;
  const phrase = range.from === range.to ? `em ${shown(range.from)}` : `de ${shown(range.from)} a ${shown(range.to)}`;
  return { range, label, phrase };
}

/** Monta o texto final a partir dos números já calculados (função pura, testável). */
export function renderPanorama({ label, entradas, saidas, approvals, tesouraria, alertas }) {
  const resultado = round(entradas.total - saidas.total);
  const lines = [
    `## Resumo completo · ${label}`, '',
    `- **Entradas** (recebimentos confirmados): **${brl(entradas.total)}**`,
    `- **Saídas** (despesas na DRE): **${brl(saidas.total)}**`,
    `- **Resultado do período: ${brl(resultado)}**`,
    `- Aguardando aprovação (agora): ${brl(approvals.pendentes_valor)} · ${approvals.pendentes_quantidade} item(ns)`,
    `- Aguardando confirmação da Tesouraria: ${brl(tesouraria.valor)} · ${tesouraria.quantidade} receita(s)`,
    '',
  ];
  lines.push('### Aprovações');
  lines.push(`- Pendentes agora: **${approvals.pendentes_quantidade}** · ${brl(approvals.pendentes_valor)}`);
  lines.push(`- Aprovados hoje: ${approvals.aprovados_hoje_quantidade} · ${brl(approvals.aprovados_hoje_valor)}`);
  lines.push(`- Aprovados no mês: ${brl(approvals.aprovados_mes_valor)}`);
  if (approvals.devolvidos_ou_rejeitados_hoje) lines.push(`- Devolvidos ou rejeitados hoje: ${approvals.devolvidos_ou_rejeitados_hoje}`);
  lines.push('', '### Alertas');
  if (alertas.length) alertas.forEach(item => lines.push(`- ${item}`));
  else lines.push('- Nenhum alerta para o período.');
  lines.push('', '[Abrir Aprovações](/aprovacoes) · [Abrir Tesouraria](/tesouraria) · [Abrir DRE Gerencial](/dre-gerencial)');
  return { answer: lines.join('\n'), resultado };
}

/** Calcula o resumo usando as mesmas consultas do restante da IA. */
export async function buildPanorama(db, question, { resolveFinancial, runFinancial, chart, now = new Date() }) {
  const today = dateSP(now.toISOString());
  const { range, label, phrase } = panoramaPeriod(question, today);
  const [revIntent, expIntent] = await Promise.all([
    resolveFinancial(`Quanto recebemos ${phrase}?`, chart),
    resolveFinancial(`Quanto gastamos por conta ${phrase}?`, chart),
  ]);
  const [revenue, expenses] = await Promise.all([
    revIntent ? runFinancial(db, revIntent) : null,
    expIntent ? runFinancial(db, expIntent) : null,
  ]);
  const ordered = name => db.collection(name).orderBy(FieldPath.documentId());
  const bySource = {};
  for (const source of APPROVAL_SOURCES) {
    const docs = await readAll(db.collection(source.collection).where('status', 'in', [...source.statuses, ...APPROVAL_DECIDED]).orderBy(FieldPath.documentId()));
    bySource[source.collection] = docs.map(doc => ({ id: doc.id, data: doc.data() }));
  }
  const approvals = approvalTotals(buildApprovalQueue(bySource), today);
  const waiting = await readAll(db.collection('receivables').where('status', '==', 'enviado_tesouraria').orderBy(FieldPath.documentId()));
  const tesouraria = { quantidade: waiting.length, valor: round(waiting.reduce((sum, doc) => sum + (Number(doc.data().valorAlvara) || 0), 0)) };
  const alertas = [];
  const unclassified = /Sem classificação gerencial confirmada[^:]*:\*\*\s*(\d+)[^,]*,\s*(R\$\s?[\d.,]+)/.exec(expenses?.answer ?? '');
  if (unclassified && Number(unclassified[1]) > 0) alertas.push(`${unclassified[1]} despesa(s) aprovada(s) sem classificação na DRE (${unclassified[2]}) — [classificar](/dre-gerencial)`);
  if (approvals.pendentes_quantidade) alertas.push(`${approvals.pendentes_quantidade} item(ns) aguardando aprovação (${brl(approvals.pendentes_valor)}) — [ver fila](/aprovacoes)`);
  if (tesouraria.quantidade) alertas.push(`${tesouraria.quantidade} receita(s) aguardando confirmação da Tesouraria (${brl(tesouraria.valor)}) — [confirmar](/tesouraria)`);
  const entradas = { total: totalOf(revenue) };
  const saidas = { total: totalOf(expenses) };
  const { answer } = renderPanorama({ label, entradas, saidas, approvals, tesouraria, alertas });
  const detail = [
    revenue ? `---\n\n### Entradas em detalhe\n\n${revenue.answer}` : '',
    expenses ? `---\n\n### Saídas em detalhe\n\n${expenses.answer}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    answer: `${answer}\n\n${detail}`.trim(),
    consultedAt: new Date().toISOString(),
    sources: [...(revenue?.sources ?? []), ...(expenses?.sources ?? []), { modulo: 'Aprovações', caminho: '/aprovacoes', parcial: false, registros: approvals.pendentes_quantidade }],
    details: [...(revenue?.details ?? []), ...(expenses?.details ?? [])],
    disclaimer: `Resumo de ${range.from === range.to ? shown(range.from) : `${shown(range.from)} a ${shown(range.to)}`}. Entradas pela data do recebimento; saídas pela competência da DRE; pendências são de todos os períodos.`,
  };
}
