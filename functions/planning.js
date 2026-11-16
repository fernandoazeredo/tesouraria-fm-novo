// Vencimentos e previsão de caixa — calculados pelo sistema a partir dos lançamentos (mesma regra do Fluxo de Caixa do app).
// Não há saldo bancário gravado: a previsão mostra entradas e saídas previstas, não o saldo da conta.
import { FieldPath } from 'firebase-admin/firestore';
import { normalizeText, dateSP } from './ai-core.js';
import { readAll } from './financial-query.js';

const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const round = v => Math.round((Number(v) || 0) * 100) / 100;
const dateOf = raw => { const v = typeof raw === 'string' ? raw.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };
const num = raw => { const v = Number(raw); return Number.isFinite(v) && v > 0 ? v : 0; };
const br = iso => (iso ? iso.split('-').reverse().join('/') : 'sem data');
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

const DUE = /\b(?:vence|vencem|vencer|vencimento|vencimentos|vencid[oa]s?|a pagar (?:hoje|esta semana|nos proximos)|atrasad[oa]s?|em atraso|contas a pagar)\b/;
const FORECAST = /\b(?:previsao de caixa|caixa previsto|fluxo de caixa previsto|projecao de caixa|previsao (?:de )?(?:entradas|saidas|recebimentos|pagamentos)|previsao financeira|quanto (?:vamos|vou) (?:receber|pagar)|o que (?:vamos|vou) (?:receber|pagar))\b/;
export const isDueQuestion = q => DUE.test(normalizeText(q));
export const isForecastQuestion = q => FORECAST.test(normalizeText(q));
export function horizonOf(question, fallback) {
  const n = normalizeText(question);
  const m = /\bproxim[oa]s?\s+(\d{1,3})\s+dias\b/.exec(n) || /\b(\d{1,3})\s+dias\b/.exec(n);
  if (m) return Math.min(180, Math.max(1, Number(m[1])));
  if (/\bhoje\b/.test(n)) return 0;
  if (/\bsemana\b/.test(n)) return 7;
  if (/\bmes\b|\b30\b/.test(n)) return 30;
  return fallback;
}

const PATH = { Despesas: '/despesas', Recebimentos: '/tesouraria', 'Acordo Trabalhista': '/alvaras', 'Repasse de Alvarás': '/repasse-alvaras', 'Comissões de Agentes': '/comissoes-agentes', 'Repasse Societário': '/repasse-societario' };

/** Movimentos previstos (ainda não realizados) — mesma regra do Fluxo de Caixa do app. */
export function plannedMovements({ receivables = [], expenses = [], alvaraTransfers = [], agentCommissions = [], societaryTransfers = [] }) {
  const out = [];
  for (const item of receivables) {
    const status = String(item.status || '');
    const description = String(item.processo || item.reclamante || item.descricao || 'Receita');
    if (String(item.tipoRecebimento) === 'acordo_trabalhista') {
      if (!['recebido_tesouraria', 'encerrado', 'enviado_tesouraria'].includes(status)) continue;
      const confirmed = status === 'recebido_tesouraria' || status === 'encerrado';
      (Array.isArray(item.parcelas) ? item.parcelas : []).forEach((part, i) => {
        if (confirmed && dateOf(part.dataRealizada)) return;
        const value = num(part.valorParcela);
        if (value) out.push({ origin: 'Acordo Trabalhista', description: `${description} · parcela ${i + 1}`, date: dateOf(part.dataPrevista), value, direction: 'entrada' });
      });
      continue;
    }
    if (status !== 'enviado_tesouraria') continue;
    const value = num(item.valorAlvara);
    if (value) out.push({ origin: 'Recebimentos', description, date: dateOf(item.dataPrevista), value, direction: 'entrada' });
  }
  for (const item of expenses) {
    const status = String(item.status || '');
    const awaiting = ['enviado_aprovacao', 'em_analise'].includes(status);
    if (!awaiting && !['aprovado', 'enviado_tesouraria', 'agendado'].includes(status)) continue;
    const value = num(item.valorTotal);
    if (value) out.push({ origin: 'Despesas', description: String(item.fornecedor || item.nome || 'Despesa'), date: dateOf(item.paymentDate), value, direction: 'saida', awaitingApproval: awaiting });
  }
  const installments = (items, origin) => {
    for (const item of items) {
      const status = String(item.status || '');
      if (!['aprovado', 'enviado_tesouraria', 'parcialmente_pago'].includes(status)) continue;
      (Array.isArray(item.installments) ? item.installments : []).forEach((part, i) => {
        if (part.paid === true || part.status === 'paga') return;
        const value = num(part.value);
        if (value) out.push({ origin, description: `${item.processo || item.sourceSnapshot?.processo || item.beneficiary || 'Parcela'} · parcela ${i + 1}`, date: dateOf(part.dueDate), value, direction: 'saida' });
      });
    }
  };
  installments(alvaraTransfers, 'Repasse de Alvarás');
  installments(agentCommissions, 'Comissões de Agentes');
  for (const item of societaryTransfers) {
    const status = String(item.status || '');
    if (!['aprovado', 'enviado_tesouraria'].includes(status)) continue;
    const value = Math.max(0, num(item.transferValue) - num(item.paidValue));
    if (value) out.push({ origin: 'Repasse Societário', description: String(item.processo || item.beneficiary || 'Repasse societário'), date: dateOf(item.dueDate), value, direction: 'saida' });
  }
  return out;
}

export async function loadPlanned(db) {
  const all = name => readAll(db.collection(name).orderBy(FieldPath.documentId())).then(docs => docs.map(doc => ({ id: doc.id, ...doc.data() })));
  const [receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers] = await Promise.all(
    ['receivables', 'expenses', 'alvaraTransfers', 'agentCommissions', 'societaryTransfers'].map(all));
  return plannedMovements({ receivables, expenses, alvaraTransfers, agentCommissions, societaryTransfers });
}

const line = (m, today) => {
  const late = m.date && m.date < today ? ` · **${diffDays(today, m.date)} dia(s) de atraso**` : '';
  const wait = m.awaitingApproval ? ' · ainda aguardando aprovação' : '';
  return `- ${br(m.date)} · ${m.direction === 'entrada' ? 'Entrada' : 'Saída'} · ${m.origin}: **${m.description}** · ${brl(m.value)}${late}${wait} — [abrir](${PATH[m.origin] || '/'})`;
};
const sum = list => round(list.reduce((s, m) => s + m.value, 0));

/** Vencimentos: atrasados, hoje e próximos N dias (padrão 7). */
export function dueReport(moves, { today, days = 7 }) {
  const end = addDays(today, days);
  const late = moves.filter(m => m.date && m.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const now = moves.filter(m => m.date === today);
  const next = moves.filter(m => m.date && m.date > today && m.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const undated = moves.filter(m => !m.date);
  return { late, now, next, undated, end };
}

export function renderDue(report, { today, days }) {
  const { late, now, next, undated, end } = report;
  const block = (title, list) => list.length
    ? [`### ${title} — ${list.length} item(ns) · Saídas ${brl(sum(list.filter(m => m.direction === 'saida')))} · Entradas ${brl(sum(list.filter(m => m.direction === 'entrada')))}`, ...list.slice(0, 40).map(m => line(m, today)), list.length > 40 ? `- … e mais ${list.length - 40} item(ns).` : ''].filter(Boolean).join('\n')
    : `### ${title}\n- Nenhum item.`;
  const parts = [`## Vencimentos — referência ${br(today)}`, block('Atrasados', late), block('Vencem hoje', now)];
  if (days > 0) parts.push(block(`Próximos ${days} dias (até ${br(end)})`, next));
  if (undated.length) parts.push(`### Sem data prevista\n- ${undated.length} item(ns) previstos sem data (${brl(sum(undated))}). Informe a data no lançamento para entrarem nos alertas.`);
  parts.push('_Considera despesas aprovadas ou aguardando aprovação, parcelas de repasses e comissões aprovadas, repasses societários aprovados e receitas aguardando a Tesouraria._');
  return parts.join('\n\n');
}

/** Previsão de caixa: entradas e saídas previstas nos próximos N dias (padrão 30), por semana. */
export function forecastReport(moves, { today, days = 30 }) {
  const end = addDays(today, days);
  const window = moves.filter(m => m.date && m.date >= today && m.date <= end);
  const weeks = [];
  for (let start = today; start <= end; start = addDays(start, 7)) {
    const stop = addDays(start, 6) < end ? addDays(start, 6) : end;
    const list = window.filter(m => m.date >= start && m.date <= stop);
    const inflow = sum(list.filter(m => m.direction === 'entrada'));
    const outflow = sum(list.filter(m => m.direction === 'saida' && !m.awaitingApproval));
    const pending = sum(list.filter(m => m.direction === 'saida' && m.awaitingApproval));
    weeks.push({ start, stop, inflow, outflow, pending, net: round(inflow - outflow) });
  }
  const late = moves.filter(m => m.date && m.date < today);
  const undated = moves.filter(m => !m.date);
  return { end, window, weeks, late, undated };
}

export function renderForecast(report, { today, days }) {
  const { end, window, weeks, late, undated } = report;
  const inflow = sum(window.filter(m => m.direction === 'entrada'));
  const outflow = sum(window.filter(m => m.direction === 'saida' && !m.awaitingApproval));
  const pending = sum(window.filter(m => m.direction === 'saida' && m.awaitingApproval));
  const lines = [
    `## Previsão de caixa — próximos ${days} dias (${br(today)} a ${br(end)})`,
    `- **Entradas previstas:** ${brl(inflow)}`,
    `- **Saídas previstas (aprovadas):** ${brl(outflow)}`,
    `- **Resultado previsto do período:** ${brl(inflow - outflow)}`,
    pending ? `- **Saídas que ainda aguardam aprovação:** ${brl(pending)} (entram no caixa se forem aprovadas)` : '',
    '', '### Por semana',
    ...weeks.map(w => `- ${br(w.start)} a ${br(w.stop)}: entradas ${brl(w.inflow)} · saídas ${brl(w.outflow)} · resultado **${brl(w.net)}**${w.pending ? ` · aguardando aprovação ${brl(w.pending)}` : ''}`),
  ].filter(l => l !== null);
  if (late.length) lines.push('', `### Atenção — atrasados (fora da previsão)\n- ${late.length} item(ns) com data já vencida: saídas ${brl(sum(late.filter(m => m.direction === 'saida')))} · entradas ${brl(sum(late.filter(m => m.direction === 'entrada')))}. Pergunte "Quais pagamentos estão atrasados?" para ver a lista.`);
  if (undated.length) lines.push('', `### Sem data prevista\n- ${undated.length} item(ns) (${brl(sum(undated))}) não entram na previsão por falta de data.`);
  if (window.length) lines.push('', '### Itens do período', ...window.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40).map(m => line(m, today)));
  lines.push('', '_Não é saldo bancário: o app não guarda saldo de conta. Mostra só o que está previsto nos lançamentos. Veja também o [Fluxo de Caixa](/fluxo-caixa)._');
  return lines.filter(l => l !== '').join('\n').replace(/\n(#)/g, '\n\n$1');
}

export async function buildDueAnswer(db, question) {
  const today = dateSP(new Date().toISOString());
  const days = horizonOf(question, 7);
  const moves = await loadPlanned(db);
  const report = dueReport(moves, { today, days });
  return { answer: renderDue(report, { today, days }), consultedAt: new Date().toISOString(), sources: [{ modulo: 'Fluxo de Caixa', caminho: '/fluxo-caixa', parcial: false, registros: moves.length }], disclaimer: 'Calculado pelo sistema a partir das datas previstas nos lançamentos.' };
}

export async function buildForecastAnswer(db, question) {
  const today = dateSP(new Date().toISOString());
  const days = Math.max(1, horizonOf(question, 30));
  const moves = await loadPlanned(db);
  const report = forecastReport(moves, { today, days });
  return { answer: renderForecast(report, { today, days }), consultedAt: new Date().toISOString(), sources: [{ modulo: 'Fluxo de Caixa', caminho: '/fluxo-caixa', parcial: false, registros: moves.length }], disclaimer: 'Previsão calculada pelo sistema a partir das datas previstas; não é saldo bancário.' };
}

/** Linhas de alerta de vencimento para o Resumo completo. */
export function dueAlerts(moves, today) {
  const { late, next } = dueReport(moves, { today, days: 7 });
  const alerts = [];
  const lateOut = late.filter(m => m.direction === 'saida');
  const lateIn = late.filter(m => m.direction === 'entrada');
  if (lateOut.length) alerts.push(`${lateOut.length} pagamento(s) com data vencida (${brl(sum(lateOut))}) — pergunte "Quais pagamentos estão atrasados?"`);
  if (lateIn.length) alerts.push(`${lateIn.length} recebimento(s) previsto(s) com data vencida (${brl(sum(lateIn))})`);
  const nextOut = next.filter(m => m.direction === 'saida');
  if (nextOut.length) alerts.push(`${nextOut.length} pagamento(s) vencem nos próximos 7 dias (${brl(sum(nextOut))}) — pergunte "O que vence nos próximos 7 dias?"`);
  return alerts;
}
