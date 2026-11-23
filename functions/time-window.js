// Janela padrão de dados enviados à IA: últimos 12 meses.
// Registros mais antigos só entram quando a pergunta cita um ano ou pede o histórico.
// Lançamentos ainda em aberto entram sempre, qualquer que seja a data.

export const WINDOW_MONTHS = 12;

const FULL_HISTORY = [
  /\b(19|20)\d{2}\b/,                       // cita um ano: "2024", "março de 2025"
  /hist[oó]ric/i,                            // "histórico"
  /todo[s]? o[s]? (per[ií]odo|anos|tempo|lan[cç]amentos)/i,
  /desde (o )?(in[ií]cio|sempre|come[cç]o)/i,
  /\bano passado\b|\banos? anteriores?\b|[uú]ltimos \d+ anos/i,
  /\bsempre\b/i,
];

const CLOSED = new Set(['pago', 'arquivado', 'encerrado', 'rejeitado']);

const DATE_FIELDS = ['competencia', 'paymentDate', 'paidAt', 'dataRecebimento', 'receivedAt', 'data', 'date', 'dueDate', 'createdAt', 'updatedAt'];

export function wantsFullHistory(question) {
  const text = String(question || '');
  return FULL_HISTORY.some(re => re.test(text));
}

function toIsoDay(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString().slice(0, 10);
  const text = String(value);
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

/** Data de referência do registro: a primeira data reconhecível na ordem de DATE_FIELDS. */
export function recordDay(data) {
  for (const field of DATE_FIELDS) {
    const day = toIsoDay(data?.[field]);
    if (day) return day;
  }
  return null;
}

export function cutoffDay(now = new Date(), months = WINDOW_MONTHS) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Mantém registros dos últimos 12 meses, os sem data e os ainda em aberto. */
export function keepInWindow(data, cutoff) {
  if (!CLOSED.has(String(data?.status || ''))) return true;
  const day = recordDay(data);
  return !day || day >= cutoff;
}

/**
 * Aplica a janela a uma lista. `getData` extrai os campos do item (padrão: o próprio item).
 * Retorna { items, excluded, cutoff, full }.
 */
export function applyWindow(items, question, { now = new Date(), getData = item => item } = {}) {
  if (wantsFullHistory(question)) return { items, excluded: 0, cutoff: null, full: true };
  const cutoff = cutoffDay(now);
  const kept = items.filter(item => keepInWindow(getData(item), cutoff));
  return { items: kept, excluded: items.length - kept.length, cutoff, full: false };
}
