// Pendências do escritório com o responsável pela regra do fluxo e quem lançou (Auditoria/login).
// Regras: aprovação = Master ou Diretor; Tesouraria = perfil Tesouraria; classificação na DRE = somente o Master;
// rascunho/devolvido = quem lançou o item.
import { normalizeText, redactSensitive } from './ai-core.js';

const DAY = 86400000;
const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const num = value => { if (typeof value === 'number') return value; const n = Number(String(value ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const safe = (value, len = 80) => redactSensitive(String(value ?? '').trim()).replace(/[\r\n\[\]*`|]/g, ' ').slice(0, len);
const toMs = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null;
};
const sinceOf = data => toMs(data?.decisionAt) ?? toMs(data?.approvedAt) ?? toMs(data?.updatedAt) ?? toMs(data?.createdAt);
const validClass = c => !!(c && c.confirmed && c.accountCode && c.accountDre && c.accountDre !== 'Não mostrar no DRE Gerencial');

/** Grupos de responsáveis a partir do cadastro de usuários (perfil + nome). */
export function responsibleGroups(users) {
  const active = users.filter(u => !u.status || u.status === 'active');
  const names = roles => active.filter(u => roles.includes(String(u.role || '').toLowerCase())).map(u => safe(u.displayName || u.name || 'Usuário', 40));
  const master = names(['master']);
  const approvers = names(['master', 'diretor', 'diretoria']);
  const treasury = names(['tesouraria']);
  const label = (title, list) => list.length ? `${title} (${[...new Set(list)].join(', ')})` : title;
  return {
    aprovacao: { key: 'aprovacao', label: label('Aprovação — Master ou Diretor', approvers), names: approvers },
    tesouraria: { key: 'tesouraria', label: label('Tesouraria', treasury), names: treasury },
    master: { key: 'master', label: label('Master — classificação na DRE', master), names: master },
  };
}

/** Lista as pendências com responsável, quem lançou e há quantos dias estão paradas. */
export function buildPendencias({ expenses = [], receivables = [], obligations = [], classMap = new Map(), users = [], now = Date.now() }) {
  const groups = responsibleGroups(users);
  const rows = [];
  const days = data => { const since = sinceOf(data); return since ? Math.max(0, Math.floor((now - since) / DAY)) : null; };
  const author = data => safe(data?.createdByName || data?.userName || '', 40) || 'não registrado';
  const owner = data => ({ key: 'autor', label: `Quem lançou (${author(data)})`, names: [author(data)] });
  const push = (responsavel, pendencia, item, valor, data, link) =>
    rows.push({ responsavel, pendencia, item: safe(item) || '—', valor: num(valor), lancadoPor: author(data), dias: days(data), link });

  for (const { id, data } of expenses) {
    const st = String(data?.status || '');
    const title = data?.fornecedor || data?.nome || 'Despesa';
    const value = data?.valorTotal;
    if (st === 'rascunho') push(owner(data), 'Despesa em rascunho — enviar para aprovação', title, value, data, '/despesas');
    else if (st === 'devolvido') push(owner(data), 'Despesa devolvida — corrigir e reenviar', title, value, data, '/despesas');
    else if (['enviado_aprovacao', 'em_analise'].includes(st)) push(groups.aprovacao, 'Despesa aguardando aprovação', title, value, data, '/aprovacoes');
    else if (st === 'aprovado') push(groups.tesouraria, 'Despesa aprovada — efetuar o pagamento', title, value, data, '/despesas');
    if (['aprovado', 'pago', 'arquivado'].includes(st) && !validClass(classMap.get(`expense__${id}`))) {
      push(groups.master, 'Despesa sem classificação na DRE', title, value, data, '/dre-gerencial');
    }
  }
  for (const { data } of receivables) {
    const st = String(data?.status || '');
    const title = data?.processo ? `Processo ${data.processo}` : (data?.descricaoOrigem || data?.descricao || data?.origem || 'Receita');
    const value = data?.valorAlvara;
    if (st === 'rascunho') push(owner(data), 'Receita em rascunho — enviar à Tesouraria', title, value, data, '/alvaras');
    else if (st === 'devolvido') push(owner(data), 'Receita devolvida — corrigir e reenviar', title, value, data, '/alvaras');
    else if (st === 'enviado_tesouraria') push(groups.tesouraria, 'Receita aguardando confirmação do recebimento', title, value, data, '/tesouraria');
  }
  for (const { type, path, data } of obligations) {
    const st = String(data?.status || '');
    const title = data?.beneficiary || data?.processo || type;
    const value = data?.netAmountDue ?? data?.amountDue ?? data?.approvedValue ?? data?.transferValue;
    if (st === 'aguardando_aprovacao') push(groups.aprovacao, `${type} aguardando aprovação`, title, value, data, '/aprovacoes');
    else if (['aprovado', 'aprovada'].includes(st)) push(groups.tesouraria, `${type} aprovado — efetuar o pagamento`, title, value, data, path);
  }
  return { rows, groups };
}

/** Filtra para "o que está pendente para mim / para <nome>". */
export function filterFor(rows, question, currentUserName) {
  const q = normalizeText(question);
  const target = /\bpara mim\b|\bminhas pendencias\b|\bo que eu (tenho|preciso)\b/.test(q) ? normalizeText(currentUserName || '')
    : (/\bpendenci(?:a|as)|pendente[s]?\b/.test(q) ? (/\b(?:pendencias?|pendentes?) (?:para|de|do|da|dos|das)\s+(?:a |o )?(.+?)[?.!]*$/.exec(q)?.[1] || '') : '').trim();
  if (!target) return { rows, target: '' };
  const word = target.split(' ').filter(w => w.length >= 3);
  const match = row => {
    const hay = normalizeText(`${row.responsavel.label} ${(row.responsavel.names || []).join(' ')}`);
    return word.length && word.every(w => hay.includes(w));
  };
  return { rows: rows.filter(match), target };
}

export function renderPendencias(rows, { title = 'Pendências e responsáveis', target = '' } = {}) {
  const lines = [`### ${title}${target ? ` · ${target}` : ''}`];
  if (!rows.length) { lines.push('', target ? 'Nenhuma pendência para esse responsável.' : 'Nenhuma pendência no momento.'); return lines.join('\n'); }
  const byGroup = new Map();
  for (const row of rows) {
    const key = row.responsavel.label;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }
  for (const [label, list] of byGroup) {
    const total = list.reduce((sum, row) => sum + row.valor, 0);
    lines.push('', `**${label}** — ${list.length} pendência(s), ${brl(total)}`);
    for (const row of list.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))) {
      const age = row.dias == null ? '' : row.dias === 0 ? ' · desde hoje' : ` · há ${row.dias} dia(s)`;
      const by = row.lancadoPor && row.lancadoPor !== 'não registrado' ? ` · lançado por ${row.lancadoPor}` : '';
      lines.push(`- ${row.pendencia}: **${row.item}** · ${brl(row.valor)}${by}${age} — [abrir](${row.link})`);
    }
  }
  return lines.join('\n');
}
