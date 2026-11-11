import { dateSP, normalizeText, redactSensitive } from './ai-core.js';
import { officialChartOfAccounts } from './chart-of-accounts.js';
import { chartCodes, excludedDreGroup as excludedGroup, selectAccounts, selectedLeaves } from './account-query.js';

const expenseStatuses = new Set(['aprovado', 'pago', 'arquivado']);
const receivedStatuses = new Set(['recebido_tesouraria', 'encerrado']);
const months = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const clean = value => normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
const status = value => clean(value).replaceAll(' ', '_');
const text = value => redactSensitive(String(value ?? '')).replace(/[\r\n\[\]*`]/g, ' ').trim();
const shownDate = value => value.split('-').reverse().join('/');
const money = cents => currency.format(cents / 100);
const monthNumber = index => String(index + 1).padStart(2, '0');
const bounds = (year, month) => month
  ? { from: `${year}-${month}-01`, to: new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10) }
  : { from: `${year}-01-01`, to: `${year}-12-31` };
const shift = (date, days) => new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);

export async function readAll(query, pageSize = 250) {
  const rows = [];
  for (let cursor; ;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(pageSize).get();
    rows.push(...page.docs);
    if (page.docs.length < pageSize) return rows;
    cursor = page.docs.at(-1);
  }
}

export function periodOf(question, today = dateSP(new Date().toISOString())) {
  const q = normalizeText(question).replace(/\b(ano(?:\s+de)?\s+|em\s+)(\d{2})\b(?![.,/\-]\d|\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b)/g, (_, prefix, abbreviatedYear) => prefix + '20' + abbreviatedYear);
  const [year, month] = today.split('-');
  const years = [...new Set(q.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
  if (!years.length && /\bano (passado|anterior)\b/.test(q)) years.push(String(Number(year) - 1));
  const explicitDates = [...q.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g)].map(match => dateOnly(match[0]));
  if (explicitDates.length) {
    if (explicitDates.some(date => !date)) return [];
    return [{ from: explicitDates[0], to: explicitDates.at(-1) }].filter(range => range.from <= range.to);
  }
  if (/\b(hoje|ontem)\b/.test(q)) {
    const day = /\bontem\b/.test(q) ? shift(today, -1) : today;
    return [{ from: day, to: day }];
  }
  if (/\bsemana\b/.test(q)) {
    const monday = shift(today, -((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7));
    const start = /semana (passada|anterior)/.test(q) ? shift(monday, -7) : monday;
    return [{ from: start, to: shift(start, 6) }];
  }
  const namedMonths = months.flatMap((name, index) => new RegExp(`\\b${name}\\b`).test(q) ? [monthNumber(index)] : []);
  if (namedMonths.length) return (years.length ? years : [year]).flatMap(value => namedMonths.map(named => bounds(value, named)));
  if (/\bmes (passado|anterior)\b/.test(q)) {
    const [previousYear, previousMonth] = shift(`${year}-${month}-01`, -1).split('-');
    return [bounds(previousYear, previousMonth)];
  }
  if (/\b(?:deste|este|desse|nesse|do) mes\b|\bmes atual\b/.test(q)) return [bounds(year, month)];
  if (years.length) {
    if (years.length === 2 && /\b(?:de\s+)?(?:19|20)\d{2}\s+(?:a|ate)\s+(?:19|20)\d{2}\b/.test(q)) {
      return [{ from: bounds(years[0]).from, to: bounds(years[1]).to }].filter(range => range.from <= range.to);
    }
    return years.map(value => bounds(value));
  }
  if (/\b(?:este|deste|nesse|neste|desse) ano\b|\bano atual\b/.test(q)) return [bounds(year)];
  return null;
}

function dateOnly(value) {
  if (typeof value?.toDate === 'function') return dateSP(value.toDate().toISOString());
  if (typeof value?.seconds === 'number') return dateSP(new Date(value.seconds * 1000).toISOString());
  const string = String(value ?? '').trim();
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(string) ? string.split('/').reverse().join('-')
    : /^\d{4}-\d{2}$/.test(string) ? string + '-01' : string.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().startsWith(date) ? date : '';
}

function cents(value) {
  let raw = String(value ?? '').replace(/R\$|\s/g, '');
  if (raw.includes(',')) raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replaceAll('.', '').replace(',', '.') : raw.replaceAll(',', '');
  const number = Number(raw);
  return Number.isFinite(number) ? Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100) : 0;
}

const expenseAccounts = officialChartOfAccounts.filter(account => account.category === 'Despesa');
const labels = [...new Set(expenseAccounts.flatMap(account => [account.name, account.dre]).filter(label => label && label !== excludedGroup))].sort((a, b) => b.length - a.length);
const contains = (haystack, term) => ` ${haystack} `.includes(` ${term} `);
const aliases = [
  { codes: ['4.07.05'], words: /\b(?:luz|eletricidade|energia|light)\b/, history: /\b(?:conta de luz|fatura de luz|energia eletrica|eletricidade|light)\b/ },
  { codes: ['4.05.28'], words: /\b(?:telefonia movel|telefone celular|celular|nextel)\b/, history: /\b(?:telefonia movel|telefone celular|celular|nextel)\b/ },
  { codes: ['4.05.27'], words: /\b(?:telefonia fixa|telefone fixo|internet)\b/, history: /\b(?:telefonia fixa|telefone fixo|internet)\b/ },
  { codes: ['4.05.27', '4.05.28'], words: /\b(?:telefone|telefonia)\b/, history: /\b(?:telefone|telefonia|celular)\b/ },
];
const accountCodes = q => [...new Set(q.match(/\b4(?:\.\d{2}){1,4}\b/g) ?? [])];
function unitOf(question) {
  const q = clean(question);
  if (/\b(?:rio de janeiro|rj)\b/.test(q)) return 'RJ';
  if (/\b(?:sao paulo|sp)\b/.test(q)) return 'SP';
  return '';
}

export function financialIntent(question, today, chart = officialChartOfAccounts) {
  const q = clean(question);
  if (/\b(?:quanto custa|passagem aerea|clima|previsao do tempo|receita culinaria)\b/.test(q)) return null;
  const unit = unitOf(question);
  const periods = periodOf(question, today);
  const type = /\bacordos?\b/.test(q) && /\balvaras?\b/.test(q) ? 'ambos'
    : /\bacordos?\b/.test(q) ? 'acordo' : /\balvaras?\b/.test(q) ? 'alvara' : 'todos';
  if (/^(?:(?:por favor|voce pode|pode) )?(?:classifique|classificar|reclassifique|reclassificar)\b/.test(q)) {
    return { kind: 'classification', unit, periods };
  }
  const hasPlan = /\b(?:plano de contas|conta contabil|codigo contabil|classificacao contabil|contas do plano|todas as contas)\b/.test(q);
  const hasExpense = /\b(?:gastamos|gastei|gastos?|despesas?|pagamos)\b/.test(q);
  const hasRevenue = /\b(?:recebemos|recebido|recebida|recebimentos?|receitas?|honorarios)\b/.test(q);
  const category = hasExpense === hasRevenue ? '' : hasExpense ? 'Despesa' : 'Receita';
  const wantsAmount = /\b(?:quanto|quantia|total|valor|saldo|movimentos?|lancamentos?|gastos?|gastamos|gastei|recebemos|comparar|compare)\b/.test(q);
  const lookupByName = /\b(?:o que e|qual e|explique)\b/.test(q)
    && selectAccounts(question, chart, category, { partial: false }).entries.length > 0;
  const classificationHelp = /\b(?:como classific\w*|qual conta (?:uso|utilizo|escolho)|em qual conta classific\w*)\b/.test(q);
  const catalogLookup = classificationHelp || (!wantsAmount && (lookupByName || hasPlan || chartCodes(question, chart).length
    || /\b(?:qual|quais|qual e|o que e|quantas) (?:a |as )?(?:conta|contas|classificacao|grupo)\b/.test(q)));
  if (catalogLookup) {
    const selection = selectAccounts(question, chart, category);
    if (!selection.entries.length && !selection.unknown.length && category !== 'Receita') {
      const alias = aliases.find(item => item.words.test(q));
      if (alias) selection.entries = chart.filter(account => alias.codes.includes(account.code));
    }
    const listing = /\b(?:liste|lista|mostrar|mostre|todas|todos|quais contas)\b/.test(q);
    if (!selection.entries.length && !selection.unknown.length && hasPlan && !/\b(?:de|para) (?:contabilizar|classificar)\b/.test(q)) {
      if (listing) selection.entries = chart.filter(account => !category || account.category === category);
    }
    const countOnly = /\b(?:quantas|quantos)\b/.test(q);
    return { kind: 'plan', chart, selection, listing, countOnly, suggest: !countOnly && !selection.entries.length && !selection.unknown.length ? { category } : null };
  }
  if (/\b(?:como|onde|qual o prazo)\b/.test(q) && !/\bquanto\b/.test(q)) return null;
  if (!/\b(?:quanto|quantos|quantas|qual|quais|liste|mostre|total|resumo|compare|recebido|gasto|saldo)\b/.test(q)) return null;
  const pendingOnly = /sem classificacao/.test(q);
  if (wantsAmount && !pendingOnly && !/\b(?:repasse|repasses|previst[oa]s?|aguardando|rejeitad[oa]s?|devolvid[oa]s?|aprovacao)\b/.test(q)) {
    const explicitAccount = hasPlan || /\b(?:na conta|da conta|nas contas|das contas|por conta|por codigo|por categoria)\b/.test(q);
    const selection = selectAccounts(question, chart, category, { partial: (type === 'todos' || explicitAccount) && !aliases.some(item => item.words.test(q)) });
    if (selection.unknown.length || selection.ambiguous) return { kind: 'plan', chart, selection };
    if (selection.entries.length) {
      const leaves = selectedLeaves(chart, selection.entries);
      const requestedDre = /\b(?:na|pela|da|do) dre\b/.test(q);
      const queries = [];
      for (const [category, kind] of [['Despesa', 'expense'], ['Receita', 'revenue']]) {
        const categoryLeaves = leaves.filter(account => account.category === category);
        if (!categoryLeaves.length) continue;
        const entries = selection.entries.filter(entry => entry.category === category);
        const managerialExpense = kind === 'expense' && !explicitAccount && !chartCodes(question, chart).length
          && categoryLeaves.every(account => account.dre && account.dre !== excludedGroup);
        queries.push({
          kind, periods, unit, selection: { ...selection, entries }, leaves: categoryLeaves,
          basis: requestedDre || managerialExpense ? 'dre' : 'account',
          feesOnly: kind === 'revenue' && /\bhonorarios\b/.test(q),
        });
      }
      if (queries.length > 1) return { kind: 'mixed', queries };
      if (queries.length) return queries[0];
      return { kind: 'plan', chart, selection, noLedger: true };
    }
    const colloquialExpense = hasExpense && /\b(?:gastamos|gastei|gastos?|pagamos)(?:.*)\bcom\b/.test(q) && !aliases.some(item => item.words.test(q));
    const colloquialRevenue = hasRevenue && type === 'todos' && /\b(?:recebemos|recebido)(?:.*)\bcom\b/.test(q);
    if ((explicitAccount && !/\b(?:por conta|por categoria|todas as contas)\b/.test(q)) || colloquialExpense || colloquialRevenue) {
      return { kind: 'plan', chart, selection, suggest: { category, wantsAmount: true, periods, unit } };
    }
  }
  if (/\b(?:repasse|repasses|comissao|comissoes|previsto|previstos|pendente|pendentes|aprovacao|confirmadas|devolvidas|rejeitadas|aguardando)\b/.test(q) && !pendingOnly) return null;
  if (/\b(?:recebemos|recebido|recebida|recebimentos?|receitas?|honorarios)\b/.test(q) || (type !== 'todos' && /\btrabalhist\w*/.test(q))) {
    return { kind: 'revenue', type, periods, unit, feesOnly: /\bhonorarios\b/.test(q), laborOnly: /\btrabalhist\w*/.test(q) || type === 'ambos' };
  }
  if (/\bresultado da dre\b/.test(q)) return { kind: 'dre', periods, unit };
  const codes = accountCodes(question);
  const labelsInQuestion = labels.filter(label => contains(q, clean(label)));
  const alias = aliases.find(item => item.words.test(q));
  const kind = codes.length || labelsInQuestion.length || alias || /\b(?:gastamos|gastei|gastos?|despesas?|dre|pago|pagamos)\b/.test(q);
  if (!kind || /\b(?:o que foi|quais despesas foram) pag/.test(q)) return null;
  return { kind: 'expense', periods, unit, codes, label: labelsInQuestion[0], alias, pendingOnly: /sem classificacao/.test(q), ranking: /\b(?:maiores|ranking|por conta|por categoria)\b/.test(q) || (alias?.codes.length ?? 0) > 1 };
}

export function financialRequest(question, today, chart = officialChartOfAccounts) {
  const intent = financialIntent(question, today, chart);
  if (intent?.kind === 'classification') return intent;

  const normalized = normalizeText(question);
  const separators = /[?;\n]+|\be\s+(?=(?:quanto|qual|quais|a mesma coisa|despesas|receitas|gastos)\b)|,\s*(?=(?:quanto|qual|quais|a mesma coisa)\b)/g;
  const queryKind = query => query?.kind === 'plan' && query.suggest?.wantsAmount
    ? ({ Despesa: 'expense', Receita: 'revenue' }[query.suggest.category])
    : query?.kind;
  let mixed = null;
  for (const divider of normalized.matchAll(separators)) {
    const firstText = question.slice(0, divider.index).trim();
    const secondText = question.slice(divider.index + divider[0].length).trim();
    if (!firstText || !secondText) continue;
    const first = financialIntent(firstText, today, chart);
    const firstKind = queryKind(first);
    if (!['expense', 'revenue'].includes(firstKind)) continue;
    const second = financialIntent(secondText, today, chart)
      ?? (/^a mesma coisa\b/.test(clean(secondText)) ? financialIntent('Total ' + secondText, today, chart) : null);
    const secondKind = queryKind(second);
    if (!['expense', 'revenue'].includes(secondKind) || firstKind === secondKind) continue;
    const firstPeriod = first.periods ?? first.suggest?.periods;
    const secondPeriod = second.periods ?? second.suggest?.periods;
    const candidate = {
      kind: 'mixed',
      queries: [
        { ...first, periods: firstPeriod ?? secondPeriod, question: firstText },
        { ...second, periods: secondPeriod ?? firstPeriod, question: secondText },
      ],
    };
    const revenue = firstKind === 'revenue' ? first : second;
    if (intent?.kind !== 'revenue' || revenue.type === intent.type) return candidate;
    mixed ??= candidate;
  }
  return mixed ?? intent;
}

export function expenseRow(id, record, classification) {
  const items = Array.isArray(record.items) ? record.items.filter(Boolean) : [];
  const date = dateOnly(items.find(item => item.data)?.data) || dateOnly(record.competencia);
  const title = String(record.fornecedor ?? record.nome ?? 'Despesa');
  const history = items.map(item => String(item.historico ?? '').trim()).filter(Boolean);
  const description = [record.nome, record.fornecedor, record.categoria, record.subcategoria, record.descricao, record.observacoes, ...history].filter(Boolean).join(' · ');
  return { id, date, title, description, amount: cents(record.valorTotal), unit: String(record.unidade ?? 'RJ'), status: status(record.status), classification, sourceAccountCode: String(record.expenseAccountCode || record.classificacaoContabil || '') };
}

export function validClassification(row) {
  const c = row.classification;
  return Boolean(c?.confirmed && c.accountCode && c.accountDre && c.accountDre !== excludedGroup);
}

const inPeriod = (date, periods) => date && (!periods || periods.some(range => date >= range.from && date <= range.to));
const inUnit = (row, unit) => !unit || clean(row.unit) === clean(unit);
export const expenseEligible = row => expenseStatuses.has(row.status);

export function expenseSummary(rows, intent) {
  const eligible = rows.filter(row => expenseEligible(row) && inUnit(row, intent.unit));
  const inRange = eligible.filter(row => inPeriod(row.date, intent.periods));
  const pending = inRange.filter(row => !validClassification(row));
  const matches = row => {
    const c = row.classification;
    if (intent.codes?.length) return intent.codes.some(code => c.accountCode === code || c.accountCode.startsWith(code + '.'));
    if (intent.label) return [c.accountName, c.accountDre].includes(intent.label)
      || expenseAccounts.some(account => account.name === intent.label && (c.accountCode === account.code || c.accountCode.startsWith(account.code + '.')));
    return !intent.alias || intent.alias.codes.includes(c.accountCode);
  };
  const selected = intent.leaves && new Map(intent.leaves.map(account => [account.code, account]));
  const matchedRows = selected ? inRange.flatMap(row => {
    const confirmed = row.classification?.confirmed ? row.classification : null;
    const account = selected.get(confirmed?.accountCode || row.sourceAccountCode);
    if (!account || (intent.basis === 'dre' && !validClassification(row))) return [];
    return [{ ...row, label: account.name }];
  }) : inRange.filter(row => validClassification(row) && matches(row));
  return {
    rows: intent.pendingOnly ? pending : matchedRows, pending,
    undated: eligible.filter(row => !row.date).length,
  };
}

export function revenueRows(record, intent) {
  const type = status(record.tipoRecebimento);
  const origin = clean(record.origem);
  const labor = /\btrabalhist\w*/.test(clean(record.natureza) + ' ' + origin);
  const agreement = type === 'acordo_trabalhista' || (/\bacordo\b/.test(origin) && labor);
  const alvara = !agreement && type !== 'outras_receitas' && /\balvara\b/.test(origin) && Boolean(String(record.processo ?? '').trim() && String(record.reclamante ?? '').trim());
  const source = agreement ? 'acordo' : alvara ? 'alvara' : 'outras';
  if (intent.type && intent.type !== 'todos' && !(intent.type === 'ambos' ? source !== 'outras' : source === intent.type)) return [];
  if (intent.laborOnly && !agreement && !labor) return [];
  if (!receivedStatuses.has(status(record.status))) return [];
  const title = String(record.processo || record.descricaoOrigem || record.origem || 'Receita');
  const unit = String(record.unidade ?? 'RJ');
  if (!inUnit({ unit }, intent.unit)) return [];
  const label = agreement ? 'Acordos trabalhistas' : alvara ? (labor ? 'Alvarás trabalhistas' : 'Alvarás') : 'Outras receitas';
  if (agreement && Array.isArray(record.parcelas) && record.parcelas.length) {
    return record.parcelas.filter(part => part && part.dataRealizada && cents(part.valorParcela) > 0).map(part => {
      const amount = cents(part.valorParcela);
      const fees = cents(part.honorarios) || Math.round(amount * Number(record.percentualHonorarios || 0) / 100);
      return { date: dateOnly(part.dataRealizada), title: `${title} · parcela ${part.numero ?? record.parcelas.indexOf(part) + 1}`, unit, label, amount, fees,
        competenceDate: dateOnly(part.dataContabilizacao) || dateOnly(part.dataRealizada) };
    });
  }
  const fees = cents(record.invoiceValue) || cents(record.components?.find?.(item => item?.nome === 'Honorários do Escritório')?.valor) || cents(record.honorarios);
  return [{
    date: [record.receiptDate, record.creditDate, record.dataCredito, record.data].map(dateOnly).find(Boolean) ?? '',
    competenceDate: [record.competencia, record.data, record.receiptDate].map(dateOnly).find(Boolean) ?? '',
    amount: cents(record.valorAlvara), fees, title, unit, label,
  }];
}

const total = rows => rows.reduce((sum, row) => sum + row.amount, 0);
const totalsBy = (rows, key) => {
  const sums = new Map();
  for (const row of rows) sums.set(key(row), (sums.get(key(row)) ?? 0) + row.amount);
  return sums;
};

export function renderFinancial(intent, rows, pending = [], undated = 0) {
  const revenue = intent.kind === 'revenue';
  const title = intent.leaves && intent.basis === 'account'
    ? (revenue ? (intent.feesOnly ? 'Honorários recebidos por conta contábil' : 'Recebimentos por conta contábil') : 'Despesas por conta contábil')
    : revenue ? (intent.basis === 'dre' ? 'Receitas na DRE por competência' : intent.feesOnly ? 'Honorários recebidos' : 'Recebimentos confirmados')
      : intent.pendingOnly ? 'Despesas sem classificação' : 'Despesas na DRE por competência';
  const scope = intent.periods?.map(range => `${shownDate(range.from)} a ${shownDate(range.to)}`).join(' e ') || 'Todo o período registrado';
  const filter = intent.selection?.entries.map(entry => text(entry.name)).join(' · ') || intent.label || intent.codes?.join(', ') || (intent.alias ? expenseAccounts.filter(account => intent.alias.codes.includes(account.code)).map(account => account.name).join(' e ') : '');
  const lines = [`## ${title}`, '', [scope, intent.unit, filter].filter(Boolean).join(' · '), ''];
  if (revenue && !intent.feesOnly && intent.basis !== 'dre') lines.push('Valores brutos efetivamente recebidos. Os honorários do escritório aparecem à parte.', '');
  lines.push(rows.length ? `**Total: ${money(total(rows))}** · ${rows.length} ${revenue ? 'recebimento(s)' : 'lançamento(s)'}` : 'Nenhum lançamento encontrado para esses critérios.', '');
  if (revenue && !intent.feesOnly && intent.basis !== 'dre' && rows.length) lines.push(`**Honorários registrados: ${money(rows.reduce((sum, row) => sum + row.fees, 0))}**`, '');
  if (revenue || intent.ranking || intent.leaves) {
    const group = row => row.label || text(row.classification?.accountName || row.classification?.accountCode);
    for (const [label, value] of [...totalsBy(rows, group)].sort((a, b) => b[1] - a[1])) lines.push(`- ${label}: ${money(value)}`);
  }
  if (!revenue && !intent.pendingOnly) lines.push('', `**Sem classificação gerencial confirmada em todo o período consultado:** ${pending.length} despesa(s) elegível(is), ${money(total(pending))}.`);
  if (undated) lines.push('', `${undated} registro(s) sem data válida ficaram fora do cálculo.`);
  if (rows.length) {
    const years = [...totalsBy(rows, row => row.date.slice(0, 4))].sort();
    if (years.length > 1) {
      lines.push('', '### Por ano');
      for (const [year, value] of years) lines.push(`- ${year}: ${money(value)}`);
    }
    lines.push('', '### Por mês');
    for (const [month, value] of [...totalsBy(rows, row => row.date.slice(0, 7))].sort()) {
      const [y, m] = month.split('-');
      const byOrigin = revenue && intent.type === 'ambos'
        ? [...totalsBy(rows.filter(row => row.date.startsWith(month)), row => row.label)].map(([origin, amount]) => `${origin}: ${money(amount)}`).join(' · ')
        : '';
      lines.push(`- ${m}/${y}: ${money(value)}${byOrigin ? ' · ' + byOrigin : ''}`);
    }
  }
  lines.push('', revenue && intent.basis === 'dre' ? '[Abrir DRE Gerencial](/dre-gerencial) · [Abrir Receitas](/alvaras)' : revenue ? '[Abrir Receitas](/alvaras)' : '[Abrir DRE Gerencial](/dre-gerencial) · [Abrir Despesas](/despesas)');
  return lines.join('\n');
}

export function financialDetails(rows) {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date)).map(row => ({
    date: shownDate(row.date), title: text(row.title).slice(0, 160), unit: text(row.unit),
    category: text(row.label || row.classification?.accountName || 'Sem classificação'), value: row.amount / 100,
  }));
}

export function classificationTarget(question, chart = officialChartOfAccounts) {
  const q = clean(question);
  const parts = normalizeText(question).split(/\b(?:como|para (?:a )?conta|na conta|em despesa de|em conta)\b/);
  const destination = parts.length > 1 ? parts.at(-1) : '';
  const codes = chartCodes(question, chart);
  if (codes.length > 1) return null;
  const expensePlan = chart.filter(account => account.category === 'Despesa');
  const leaves = expensePlan.filter(account => account.kind === 'account' && account.dre && account.dre !== excludedGroup);
  const named = leaves.filter(account => contains(clean(destination), clean(account.name))).sort((a, b) => b.name.length - a.name.length);
  const alias = aliases.find(item => item.words.test(clean(destination)));
  const resolved = destination && !codes.length ? selectAccounts(destination, leaves, 'Despesa') : null;
  const indicated = named[0]?.code ?? (alias?.codes.length === 1 ? alias.codes[0] : resolved?.entries.length === 1 ? resolved.entries[0].code : '');
  if (codes[0] && indicated && codes[0] !== indicated) return null;
  const account = leaves.find(item => item.code === (codes[0] || indicated));
  const group = [...new Set(expensePlan.map(item => item.dre).filter(Boolean))].find(label => {
    const plural = clean(label);
    const singular = plural.split(' ').map(word => word.length > 4 ? word.replace(/s$/, '') : word).join(' ');
    return contains(q, plural) || contains(q, singular);
  });
  return account && (!group || account.dre === group) ? account : null;
}

export function classificationMatches(rows, question, intent) {
  const source = clean(normalizeText(question).split(/\b(?:como|para (?:a )?conta|na conta|em despesa de|em conta|plano de contas)\b/)[0]);
  const alias = aliases.find(item => item.words.test(source));
  const ignored = new Set(['classifique','classificar','reclassifique','reclassificar','despesas','despesa','referente','referentes','fornecedor','historico','lancamento','lancamentos','escritorio','unidade','passado','passada','mes','ano','hoje','ontem','semana','janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro','conta','administrativa','administrativas','eletrica','energia','luz','light','eletricidade','telefone','telefonia','fixo','fixa','movel','celular','nextel','internet','todas','todos','deste','desse','este','neste','atual']);
  const terms = source.split(' ').filter(word => word.length >= 4 && !ignored.has(word) && !/^\d+$/.test(word));
  if (!alias && !terms.length) return [];
  return rows.filter(row => {
    if (!expenseEligible(row) || !inUnit(row, intent.unit) || (intent.periods && !inPeriod(row.date, intent.periods))) return false;
    const history = clean(row.description);
    return (!alias || alias.history.test(history)) && terms.every(term => contains(history, term));
  });
}

export const sumFinancial = total;
export const filterPeriod = (rows, periods) => rows.filter(row => inPeriod(row.date, periods));
