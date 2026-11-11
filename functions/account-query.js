import { normalizeText, redactSensitive } from './ai-core.js';
import { officialChartOfAccounts } from './chart-of-accounts.js';

export const excludedDreGroup = 'Não mostrar no DRE Gerencial';
const categories = { '3': 'Receita', '4': 'Despesa', '5': 'Patrimonial / Dívida' };
const words = value => normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
const hasPhrase = (value, phrase) => ` ${value} `.includes(` ${phrase} `);
const display = value => redactSensitive(String(value ?? '')).replace(/[\r\n\[\]*`]/g, ' ').trim();

export function activeChart(records) {
  const entries = new Map();
  for (const item of records) {
    const code = String(item.code ?? '').trim();
    const name = String(item.name ?? '').trim();
    if (!/^\d+(?:\.\d+)+$/.test(code) || !name) continue;
    const category = Object.values(categories).includes(item.category) ? item.category : categories[code.split('.')[0]] ?? categories['5'];
    entries.set(code, {
      code, name, category, kind: item.kind === 'group' ? 'group' : 'account',
      dre: String(item.dre ?? '').trim() || null,
      parentCode: String(item.parentCode ?? '').trim() || null,
    });
  }
  return entries.size ? [...entries.values()].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })) : officialChartOfAccounts;
}

export function chartCodes(question, chart) {
  const known = new Set(chart.map(account => account.code));
  const explicit = /\b(?:contas?|codigos?|plano|classifica\w*)\b/.test(words(question));
  return [...new Set((question.match(/(?<![\d.,/])\d+(?:\.\d+)+(?![\d./])/g) ?? [])
    .filter(code => known.has(code) || (explicit && /^[345](?:\.\d{2})+$/.test(code))))];
}

const stop = new Set('a as o os ao aos um uma de da do das dos e com em para por na no nas nos s sobre quanto quantas qual quais que foi foram nosso nossas este ano mes total valor valores despesa despesas receitas receita recebimento recebimentos recebemos gasto gastos gastamos gastei pagamos conta contas codigo codigos grupo plano dre classificacao contabil gerencial lista liste mostre consulte unidade escritorio rj sp jan fev mar abr mai jun jul ago set out nov dez janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro trabalhista trabalhistas acordo acordos alvara alvaras'.split(' '));
// Singular aproximado do português: materiais→material, papéis→papel, serviços→serviço, emissões→emissão.
const token = word => {
  if (word.length <= 4) return word;
  if (/ais$/.test(word)) return word.slice(0, -3) + 'al';
  if (/eis$/.test(word)) return word.slice(0, -3) + 'el';
  if (/(?:oes|aes)$/.test(word)) return word.slice(0, -3) + 'ao';
  if (/ns$/.test(word)) return word.slice(0, -2) + 'm';
  return word.replace(/s$/, '');
};
const contentWords = text => [...new Set(words(text).split(' ').filter(word => /^[a-z]{3,}$/.test(word) && !stop.has(word)).map(token))];

export function selectAccounts(question, chart, category = '', { partial = true } = {}) {
  const q = words(question);
  const explicitCodes = chartCodes(question, chart);
  const knownCodes = new Map(chart.map(account => [account.code, account]));
  if (explicitCodes.length) return {
    entries: explicitCodes.map(code => knownCodes.get(code)).filter(Boolean),
    unknown: explicitCodes.filter(code => !knownCodes.has(code)),
    ambiguous: false,
  };

  const available = chart.filter(account => !category || account.category === category);
  const groups = [...new Set(available.map(account => account.dre).filter(label => label && label !== excludedDreGroup))];
  const exact = available.filter(account => hasPhrase(q, words(account.name)));
  const namedGroups = groups.filter(name => hasPhrase(q, words(name)))
    .map(name => ({ name, kind: 'dre-group', category: available.find(account => account.dre === name).category }));
  const found = [...exact, ...namedGroups].filter(item => !exact.some(other =>
    other !== item && words(other.name) !== words(item.name) && hasPhrase(words(other.name), words(item.name))));
  if (found.length || !partial) return { entries: found, unknown: [], ambiguous: false };

  const terms = contentWords(question);
  if (!terms.length) return { entries: [], unknown: [], ambiguous: false };
  const candidates = available.map(account => {
    const nameTerms = contentWords(account.name);
    const hits = terms.filter(term => nameTerms.includes(term)).length;
    return { account, hits, coverage: hits / Math.max(1, nameTerms.length) };
  }).filter(match => match.hits && (match.hits === terms.length || match.coverage === 1));
  candidates.sort((a, b) => b.hits - a.hits || b.coverage - a.coverage);
  const top = candidates[0];
  const best = top ? candidates.filter(match => match.hits === top.hits && match.coverage === top.coverage).map(match => match.account) : [];
  return { entries: best, unknown: [], ambiguous: best.length > 1 };
}

export function selectedLeaves(chart, entries) {
  return chart.filter(account => account.kind === 'account' && entries.some(entry => {
    if (entry.kind === 'dre-group') return entry.name === account.dre;
    if (entry.kind === 'group') return account.code.startsWith(entry.code + '.');
    return entry.code === account.code;
  }));
}

export function planAnswer(chart, entries, { unknown = [], ambiguous = false, listing = false, countOnly = false } = {}) {
  if (unknown.length) return `Não encontrei no Plano de Contas vigente: **${unknown.join(', ')}**. Confira o código no [Plano de Contas](/plano-contas).`;
  if (countOnly) {
    const groups = chart.filter(row => row.kind === 'group').length;
    const counts = Object.values(categories).map(category => `${category}: ${chart.filter(row => row.kind === 'account' && row.category === category).length}`);
    return `**${chart.length} códigos** · ${groups} grupos e ${chart.length - groups} contas finais.\n\n${counts.join(' · ')}.\n\n[Abrir Plano de Contas](/plano-contas)`;
  }
  if (!entries.length && !listing) return 'Informe um nome ou código para eu localizar a conta no [Plano de Contas](/plano-contas).';
  const title = ambiguous ? 'Encontrei mais de uma conta possível. Informe o código desejado.' : 'Plano de Contas vigente';
  const rows = listing ? entries.flatMap(entry => entry.kind === 'account'
    ? [entry]
    : [entry, ...selectedLeaves(chart, [entry])]) : entries;
  const lines = [`## ${title}`, '', `O cadastro contém **${chart.length} entradas**, entre grupos e contas.`, ''];
  const unique = [...new Map(rows.map(row => [row.code ?? row.name, row])).values()]
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'pt-BR', { numeric: true }));
  for (const row of unique) {
    const code = row.code ? `${row.code} — ` : '';
    const label = row.kind === 'account' ? row.dre || 'Sem grupo DRE cadastrado' : row.kind === 'dre-group' ? 'Grupo da DRE' : 'Grupo do Plano de Contas';
    lines.push(`- **${code}${display(row.name)}** · ${row.category} · ${display(label)}`);
  }
  lines.push('', '[Abrir Plano de Contas](/plano-contas)');
  return lines.join('\n');
}

export function modelAccountSelection(result, chart, category) {
  if (!Array.isArray(result?.codes)) return null;
  const codes = [...new Set(result.codes)];
  if (!codes.length || codes.length > 5 || codes.some(code => typeof code !== 'string')) return null;
  const entries = codes.map(code => chart.find(account => account.code === code && (!category || account.category === category)));
  if (entries.some(entry => !entry)) return null;
  return { entries, unknown: [], ambiguous: result.certain !== true || entries.length !== 1 };
}
