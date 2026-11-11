import { HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
  classificationMatches, classificationTarget, expenseRow, expenseSummary, filterPeriod, financialDetails,
  readAll, renderFinancial, revenueRows, sumFinancial, validClassification,
} from './financial-query.js';
import { normalizeText, redactSensitive } from './ai-core.js';

const MAX_ATOMIC_CLASSIFICATIONS = 240;
const drePath = '/dre-gerencial';
const revenuePath = '/alvaras';
const format = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const sanitized = (value, length) => redactSensitive(String(value ?? '')).slice(0, length);
const ordered = (db, collection) => db.collection(collection).orderBy(FieldPath.documentId());
const keyOf = id => `expense__${id}`;
const stamp = () => FieldValue.serverTimestamp();

function reply(answer, source, rows) {
  return {
    answer, consultedAt: new Date().toISOString(),
    sources: source ? [{ modulo: source === drePath ? 'DRE Gerencial' : 'Receitas', caminho: source, parcial: false, registros: rows.length }] : [],
    details: financialDetails(rows),
    disclaimer: source ? 'Cálculo feito pelo sistema sobre os registros que atendem aos critérios.' : 'A classificação só é gravada após a sua confirmação.',
  };
}

export async function runFinancial(db, intent) {
  if (intent.periods?.length === 0) return reply('Informe um período válido para a consulta.', null, []);
  if (intent.kind === 'revenue') {
    const docs = await readAll(ordered(db, 'receivables'));
    const all = docs.flatMap(doc => revenueRows(doc.data(), intent));
    const rows = filterPeriod(all, intent.periods).map(row => intent.feesOnly ? { ...row, amount: row.fees } : row);
    return reply(renderFinancial(intent, rows, [], all.filter(row => !row.date).length), revenuePath, rows);
  }

  const [expenses, classes, receivables] = await Promise.all([
    readAll(ordered(db, 'expenses')),
    readAll(ordered(db, 'managerialClassifications')),
    intent.kind === 'dre' ? readAll(ordered(db, 'receivables')) : [],
  ]);
  const classMap = new Map(classes.map(doc => [doc.id, doc.data()]));
  const all = expenses.map(doc => expenseRow(doc.id, doc.data(), classMap.get(keyOf(doc.id))));
  const { rows, pending, undated } = expenseSummary(all, intent);
  if (intent.kind !== 'dre') return reply(renderFinancial(intent, rows, pending, undated), drePath, rows);

  const revenue = receivables.flatMap(doc => {
    const record = doc.data();
    const classification = classMap.get(`revenue__${doc.id}`);
    if (!validClassification({ classification })) return [];
    const isAgreement = normalizeText(record.tipoRecebimento) === 'acordo_trabalhista';
    const amountIsGross = normalizeText(record.tipoRecebimento) === 'outras_receitas' || !String(record.processo ?? '').trim()
      || classification.accountDre === 'Outras Receitas Não Operacionais';
    // A DRE por competência reconhece parcelas realizadas de acordos já enviados à Tesouraria.
    const candidate = isAgreement && record.status === 'enviado_tesouraria' ? { ...record, status: 'recebido_tesouraria' } : record;
    return revenueRows(candidate, intent).map(row => ({
      ...row, date: row.competenceDate, label: classification.accountDre,
      amount: amountIsGross && !isAgreement ? row.amount : row.fees,
    }));
  });
  const income = filterPeriod(revenue, intent.periods);
  const revenues = sumFinancial(income);
  const expensesTotal = sumFinancial(rows);
  const answer = [
    '## Resultado da DRE por competência', '',
    intent.periods?.map(range => `${range.from.split('-').reverse().join('/')} a ${range.to.split('-').reverse().join('/')}`).join(' e ') ?? 'Todo o período registrado',
    '',
    `- Receitas: ${format.format(revenues / 100)}`,
    `- Despesas: ${format.format(expensesTotal / 100)}`,
    `- Resultado: **${format.format((revenues - expensesTotal) / 100)}**`,
    `- Despesas elegíveis sem classificação: ${pending.length} · ${format.format(sumFinancial(pending) / 100)}`,
    ...(undated ? [`- Despesas sem data válida: ${undated}`] : []),
    '', '[Abrir DRE Gerencial](/dre-gerencial)',
  ].join('\n');
  return reply(answer, drePath, [...income, ...rows]);
}

export async function proposeClassification(db, { question, intent, uid, expiresAtMs }) {
  const message = answer => reply(answer, null, []);
  if (intent.periods?.length === 0) return message('Informe um período válido para classificar.');
  const account = classificationTarget(question);
  if (!account) return message('Informe uma única conta válida do Plano de Contas, pelo nome ou código. Se informar também o grupo da DRE, ele deve corresponder à conta.');
  const docs = await readAll(ordered(db, 'expenses'));
  const byId = new Map(docs.map(doc => [doc.id, doc]));
  const rows = classificationMatches(docs.map(doc => expenseRow(doc.id, doc.data())), question, intent);
  if (!rows.length) return message('Não encontrei uma despesa elegível que corresponda ao pedido. Informe o fornecedor ou histórico e, se possível, a competência e a unidade.');
  if (rows.length > 1 && !/\b(?:despesas|lancamentos|todas|todos)\b/.test(normalizeText(question))) {
    return message(`Encontrei ${rows.length} despesas. Informe o fornecedor ou a competência para identificar o lançamento, ou peça expressamente todas as despesas correspondentes.`);
  }
  const classMap = new Map();
  for (let index = 0; index < rows.length; index += MAX_ATOMIC_CLASSIFICATIONS) {
    const batch = rows.slice(index, index + MAX_ATOMIC_CLASSIFICATIONS);
    const docs = await db.getAll(...batch.map(row => db.collection('managerialClassifications').doc(keyOf(row.id))));
    for (const doc of docs) classMap.set(doc.id, doc);
  }
  const changes = rows.flatMap(row => {
    const snapshot = classMap.get(keyOf(row.id));
    const current = snapshot.data();
    if (validClassification({ classification: current }) && current.accountCode === account.code && current.accountDre === account.dre) return [];
    return [{ row, snapshot, current }];
  });
  if (!changes.length) return message('As despesas encontradas já estão classificadas na conta solicitada.');
  if (changes.length > MAX_ATOMIC_CLASSIFICATIONS) return message(`Encontrei ${changes.length} despesas a classificar. Divida o pedido por mês ou unidade para que cada confirmação e seu desfazimento sejam gravados integralmente.`);
  const proposal = await db.collection('executiveAiProposals').add({
    kind: 'classificacao', uid, account, status: 'pendente', createdAt: stamp(), expiresAtMs,
    targets: changes.map(({ row, snapshot }) => ({
      sourceId: row.id, sourceVersion: byId.get(row.id).updateTime, classificationVersion: snapshot.updateTime ?? null,
    })),
  });
  const name = `${account.code} — ${account.name}`;
  return {
    ...message('Confira os lançamentos e a conta de destino. Cada classificação se aplica ao valor integral da despesa exibida.'),
    proposal: {
      id: proposal.id, kind: 'classificacao', modulo: 'DRE Gerencial', conta: name, grupo: account.dre,
      summary: `Classificar despesas em ${name}`, expiresAtMs,
      total: sumFinancial(changes.map(change => change.row)) / 100,
      itens: changes.map(({ row, current }) => ({
        tipo: 'Despesa', titulo: sanitized(row.title, 150), descricao: sanitized(row.description, 600),
        competencia: row.date.slice(0, 7), unidade: sanitized(row.unit, 50), valor: row.amount / 100,
        antes: validClassification({ classification: current }) ? sanitized(current.accountName || current.accountCode, 150) : 'Sem classificação confirmada',
      })),
    },
  };
}

export async function changeClassification(db, tx, proposalSnap, proposal, profile, action) {
  const ref = proposalSnap.ref;
  const before = ref.collection('anteriores');
  const classifications = proposal.targets.map(target => db.collection('managerialClassifications').doc(keyOf(target.sourceId)));
  const sources = proposal.targets.map(target => db.collection('expenses').doc(target.sourceId));
  const backups = proposal.targets.map(target => before.doc(target.sourceId));
  const applying = action === 'apply';
  const snapshots = await tx.getAll(...classifications, ...(applying ? sources : backups));
  const { account, targets, uid } = proposal;
  for (const [index, target] of targets.entries()) {
    const classification = snapshots[index];
    const other = snapshots[index + targets.length];
    const cVersion = target.classificationVersion;
    if (applying) {
      if (!target.sourceVersion?.isEqual(other.updateTime) || (cVersion ? !cVersion.isEqual(classification.updateTime) : classification.exists)) {
        throw new HttpsError('aborted', 'A despesa ou a classificação mudou depois da proposta. Peça novamente.');
      }
    } else if (!classification.updateTime?.isEqual(proposalSnap.updateTime) || !other.exists) {
      throw new HttpsError('aborted', 'A classificação mudou depois da confirmação. Confira a DRE Gerencial.');
    }
  }
  for (const [index, target] of targets.entries()) {
    const current = snapshots[index].data();
    const other = snapshots[index + targets.length];
    const ref = classifications[index];
    if (applying) {
      const row = expenseRow(target.sourceId, other.data());
      tx.set(backups[index], { existed: Boolean(current), data: current ?? null });
      tx.set(ref, {
        sourceType: 'expense', sourceId: row.id, sourceDate: row.date || null, sourceCompetence: row.date.slice(0, 7) || null,
        sourceUnit: row.unit, sourceTitle: row.title, sourceDescription: row.description, sourceCounterparty: row.title,
        sourceAmount: row.amount / 100, sourceStatus: row.status,
        accountCode: account.code, accountName: account.name, accountDre: account.dre, accountCategory: account.category,
        confirmed: true, suggestionConfidence: 0, suggestionReason: 'Conta escolhida pelo Master na IA Executiva',
        confirmedBy: uid, confirmedByName: profile.displayName || profile.email || null, confirmedAt: stamp(), updatedAt: stamp(),
      }, { merge: true });
    } else {
      const previous = other.data();
      if (previous.existed) tx.set(ref, previous.data);
      else tx.delete(ref);
      tx.delete(backups[index]);
    }
  }
  tx.update(ref, applying ? { status: 'aplicada', appliedAt: stamp() } : { status: 'desfeita', undoneAt: stamp() });
  tx.create(db.collection('auditLogs').doc(), {
    action: applying ? 'IA Executiva: classificação gerencial aplicada' : 'IA Executiva: classificação gerencial desfeita',
    module: 'DRE Gerencial', detail: `${targets.length} despesa(s) · ${account.code} — ${account.name}`,
    entityId: ref.id, userId: uid, userName: profile.displayName || profile.name || 'Administrador Master',
    userEmail: profile.email || '', source: 'executive-ai', createdAt: stamp(),
  });
}
