// Exclusão de lançamentos (Despesas e Receitas) pela IA Executiva.
// Fluxo: propor → confirmação expressa do Master (digitar EXCLUIR) → excluir → Auditoria → (desfazer).
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { DELETABLE_COLLECTIONS, redactSensitive } from './ai-core.js';

const LINKED = ['alvaraTransfers', 'agentCommissions', 'fiscalNotes', 'societaryTransfers'];
const LINKED_TITLE = { alvaraTransfers: 'Repasse de Alvarás', agentCommissions: 'Comissões de Agentes', fiscalNotes: 'Nota Fiscal', societaryTransfers: 'Repasse Societário' };
const FINAL = ['pago', 'paga', 'arquivado', 'recebido_tesouraria', 'confirmado', 'recebido', 'encerrado'];
const STATUS_PT = {
  rascunho: 'Rascunho', enviado_aprovacao: 'Aguardando aprovação', em_analise: 'Em análise', aprovado: 'Aprovado',
  pago: 'Pago', paga: 'Pago', arquivado: 'Arquivado', devolvido: 'Devolvido para correção', rejeitado: 'Rejeitado',
  enviado_tesouraria: 'Aguardando a Tesouraria', recebido_tesouraria: 'Recebido', confirmado: 'Recebido', recebido: 'Recebido', encerrado: 'Encerrado',
};
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const txt = (v, n = 120) => redactSensitive(String(v ?? '').trim()).slice(0, n);
const dateOf = v => (v && typeof v.toDate === 'function' ? v.toDate().toISOString().slice(0, 10) : (typeof v === 'string' ? v.slice(0, 10) : ''));
const classKey = (collection, id) => `${collection === 'expenses' ? 'expense' : 'revenue'}__${id}`;

/** Campos que o Master vê antes de confirmar (sem dados bancários ou documentos pessoais). */
export function describeRecord(collection, data) {
  const status = String(data.status || '');
  const rows = collection === 'expenses'
    ? [
      ['Módulo', 'Despesas'],
      ['Fornecedor / favorecido', txt(data.fornecedor || data.nome || data.favorecido) || '—'],
      ['Histórico', txt(data.historico || (Array.isArray(data.items) ? data.items.map(i => i?.historico).filter(Boolean).join('; ') : '') || data.descricao || data.detalhamento) || '—'],
      ['Competência', txt(data.competencia) || dateOf(data.dataPrevista) || '—'],
      ['Unidade', txt(data.unidade) || '—'],
      ['Valor', brl(data.valorTotal)],
      ['Situação', STATUS_PT[status] || status || '—'],
      ['Lançado por', txt(data.createdByName) || '—'],
    ]
    : [
      ['Módulo', 'Receitas'],
      ['Tipo', txt(data.natureza || data.tipoReceita || data.categoriaReceita || data.origem) || '—'],
      ['Processo', txt(data.processo) || '—'],
      ['Cliente / descrição', txt(data.reclamante || data.descricaoOrigem || data.descricao) || '—'],
      ['Data', dateOf(data.receiptDate) || dateOf(data.dataRecebimento) || txt(data.competencia) || '—'],
      ['Valor', brl(data.valorAlvara ?? data.valorTotal)],
      ['Situação', STATUS_PT[status] || status || '—'],
      ['Lançado por', txt(data.createdByName) || '—'],
    ];
  const attachments = Array.isArray(data.attachments) ? data.attachments.length : Number(data.attachmentCount) || 0;
  const avisos = [];
  if (FINAL.includes(status)) avisos.push('Lançamento já finalizado: ele sai dos relatórios, da DRE, do Fluxo de Caixa e da Contabilidade.');
  if (attachments) avisos.push(`${attachments} anexo(s) ficam guardados no armazenamento para permitir desfazer.`);
  return { itens: rows.map(([label, value]) => ({ label, value })), avisos, status };
}

/** Conciliações bancárias do lançamento. Mês com conciliação fechada bloqueia a exclusão. */
export async function reconciliationsOf(db, collection, id) {
  const q = await db.collection('bankReconciliations').where('sourceId', '==', id).get();
  const list = q.docs.filter(d => !d.data().sourceCollection || d.data().sourceCollection === collection);
  const closed = [];
  for (const d of list) {
    const periodId = String(d.data().periodId || '');
    if (!periodId) continue;
    const period = await db.collection('bankReconciliationPeriods').doc(periodId).get();
    if (period.exists && period.data().status === 'fechada') closed.push(String(d.data().competence || periodId.split('__')[0]));
  }
  return { ids: list.map(d => d.id), closed: [...new Set(closed)] };
}

/** Registros que dependem de uma receita (mesmo id ou campo de origem). */
export async function linkedRecords(db, id) {
  const found = [];
  for (const name of LINKED) {
    const same = await db.collection(name).doc(id).get();
    if (same.exists) { found.push(LINKED_TITLE[name]); continue; }
    for (const field of ['sourceReceivableId', 'sourceId']) {
      const q = await db.collection(name).where(field, '==', id).limit(1).get();
      if (!q.empty) { found.push(LINKED_TITLE[name]); break; }
    }
  }
  return found;
}

export async function proposeDelete(db, { key, model, question, evidence, uid, instructions, todayBR, ttlMs }) {
  const base = { consultedAt: new Date().toISOString(), sources: [], disclaimer: 'Nada é excluído sem a sua confirmação expressa.' };
  const schema = { type: 'OBJECT', properties: {
    answer: { type: 'STRING' },
    proposal: { type: 'OBJECT', nullable: true, properties: {
      collection: { type: 'STRING', enum: [...DELETABLE_COLLECTIONS] }, docId: { type: 'STRING' }, summary: { type: 'STRING' },
    }, required: ['collection', 'docId', 'summary'] },
  }, required: ['answer'] };
  const rules = [instructions,
    'MODO EXCLUSÃO: o Master pediu expressamente para excluir um lançamento de Despesas ou de Receitas.',
    'Identifique UM único lançamento pelo ID presente nas evidências (coleção expenses = Despesas, receivables = Receitas).',
    'Se houver mais de um candidato, ou nenhum, NÃO proponha: em answer liste os candidatos (fornecedor/processo, data e valor, sem IDs) e peça para o Master especificar.',
    'Nunca proponha excluir mais de um lançamento por vez. Nunca proponha excluir outros módulos.',
    'answer: português simples, sem IDs nem nomes técnicos, lembrando que a exclusão só ocorre depois da confirmação.',
  ].join('\n');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: rules }] },
      contents: [{ role: 'user', parts: [{ text: `Data de hoje (America/Sao_Paulo): ${todayBR()}.\nPedido: ${question}\n\nEvidências (registros atuais):\n${evidence}` }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: schema } }),
    signal: AbortSignal.timeout(45000) });
  if (!response.ok) { console.error('IA provider HTTP', response.status); throw new HttpsError('unavailable', 'Não foi possível consultar o serviço de IA neste momento.'); }
  const json = await response.json();
  let parsed;
  try { parsed = JSON.parse((json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')); }
  catch { throw new HttpsError('unavailable', 'A IA não retornou uma proposta válida. Reformule o pedido.'); }
  if (!parsed?.proposal) return { ...base, answer: String(parsed?.answer || 'Não identifiquei com segurança qual lançamento excluir. Informe fornecedor/processo, data e valor.').slice(0, 4000) };
  const collection = String(parsed.proposal.collection || '');
  const docId = String(parsed.proposal.docId || '');
  if (!DELETABLE_COLLECTIONS.includes(collection) || !/^[A-Za-z0-9_-]{1,128}$/.test(docId)) return { ...base, answer: 'Só posso excluir lançamentos de Despesas ou de Receitas. Nada foi excluído.' };
  const ref = db.collection(collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return { ...base, answer: 'Não encontrei esse lançamento. Nada foi excluído.' };
  const data = snap.data();
  if (collection === 'receivables') {
    const linked = await linkedRecords(db, docId);
    if (linked.length) return { ...base, answer: `Não posso excluir esta receita porque ela já gerou registros em: **${linked.join(', ')}**. Exclua ou ajuste esses registros primeiro no respectivo menu. Nada foi excluído.` };
  }
  const recon = await reconciliationsOf(db, collection, docId);
  if (recon.closed.length) return { ...base, answer: `Não posso excluir este lançamento porque ele está conciliado no banco em mês com **conciliação fechada** (${recon.closed.join(', ')}). Reabra a conciliação desse mês, se for o caso, e peça novamente. Nada foi excluído.` };
  const view = describeRecord(collection, data);
  const classRef = db.collection('managerialClassifications').doc(classKey(collection, docId));
  const classSnap = await classRef.get();
  const expiresAtMs = Date.now() + ttlMs;
  const prop = await db.collection('executiveAiProposals').add({
    kind: 'exclusao', uid, question: question.slice(0, 500), collection, docId, summary: String(parsed.proposal.summary || '').slice(0, 400),
    snapshot: data, updateTimeMs: snap.updateTime.toMillis(),
    classification: classSnap.exists ? { id: classSnap.id, data: classSnap.data() } : null,
    reconciliationIds: recon.ids,
    display: view.itens, status: 'pendente', createdAt: FieldValue.serverTimestamp(), expiresAtMs,
  });
  const modulo = collection === 'expenses' ? 'Despesas' : 'Receitas';
  return { ...base,
    answer: `Encontrei o lançamento abaixo em **${modulo}**. A exclusão só acontece depois que você clicar em **Confirmar exclusão** e digitar **EXCLUIR**. Fica registrada na Auditoria e pode ser desfeita.`,
    proposal: { id: prop.id, kind: 'exclusao', modulo, collection, docId, summary: String(parsed.proposal.summary || '').slice(0, 400), itens: view.itens, avisos: [...view.avisos, ...(classSnap.exists ? ['A classificação deste lançamento na DRE também será removida (volta se desfizer).'] : []), ...(recon.ids.length ? ['A conciliação bancária deste lançamento (mês ainda aberto) será desfeita junto (volta se desfizer).'] : [])], expiresAtMs } };
}

/** Executa a exclusão dentro da transação de aplicar. Retorna o texto para a Auditoria. */
export async function applyDelete(db, tx, pRef, p, confirmText) {
  if (String(confirmText || '').trim().toUpperCase() !== 'EXCLUIR') throw new HttpsError('failed-precondition', 'Confirmação expressa ausente. Digite EXCLUIR para confirmar.');
  if (!DELETABLE_COLLECTIONS.includes(p.collection)) throw new HttpsError('permission-denied', 'Módulo não permitido para exclusão.');
  const ref = db.collection(p.collection).doc(p.docId);
  const cur = await tx.get(ref);
  if (!cur.exists) throw new HttpsError('not-found', 'O lançamento não existe mais.');
  if (cur.updateTime.toMillis() !== p.updateTimeMs) { tx.update(pRef, { status: 'conflito' }); throw new HttpsError('aborted', 'O lançamento foi alterado depois da proposta. Nada foi excluído; peça novamente.'); }
  const classRef = db.collection('managerialClassifications').doc(classKey(p.collection, p.docId));
  const cls = await tx.get(classRef);
  const recons = [];
  for (const id of p.reconciliationIds || []) {
    const r = await tx.get(db.collection('bankReconciliations').doc(id));
    if (!r.exists) continue;
    const periodId = String(r.data().periodId || '');
    const period = periodId ? await tx.get(db.collection('bankReconciliationPeriods').doc(periodId)) : null;
    if (period?.exists && period.data().status === 'fechada') throw new HttpsError('failed-precondition', 'A conciliação bancária deste mês foi fechada depois da proposta. Nada foi excluído.');
    recons.push({ id: r.id, data: r.data() });
  }
  tx.delete(ref);
  if (cls.exists) tx.delete(classRef);
  for (const r of recons) tx.delete(db.collection('bankReconciliations').doc(r.id));
  tx.update(pRef, { status: 'aplicada', appliedAt: FieldValue.serverTimestamp(), classification: cls.exists ? { id: cls.id, data: cls.data() } : null, reconciliations: recons });
  return `${p.collection === 'expenses' ? 'Despesas' : 'Receitas'} ${p.docId} excluído${recons.length ? ` (e ${recons.length} conciliação(ões) bancária(s) desfeita(s))` : ''}: ${(p.display || []).filter(r => r.label !== 'Módulo').map(r => `${r.label}: ${r.value}`).join(' · ')} · Pedido: ${p.question}`;
}

/** Restaura o lançamento excluído (e sua classificação na DRE). */
export async function undoDelete(db, tx, pRef, p) {
  const ref = db.collection(p.collection).doc(p.docId);
  const cur = await tx.get(ref);
  if (cur.exists) throw new HttpsError('aborted', 'Já existe um lançamento com este identificador. Nada foi restaurado.');
  const cls = p.classification ? await tx.get(db.collection('managerialClassifications').doc(p.classification.id)) : null;
  const recons = [];
  for (const r of p.reconciliations || []) { const cur = await tx.get(db.collection('bankReconciliations').doc(r.id)); if (!cur.exists) recons.push(r); }
  tx.set(ref, p.snapshot);
  for (const r of recons) tx.set(db.collection('bankReconciliations').doc(r.id), r.data);
  if (p.classification && !cls.exists) tx.set(db.collection('managerialClassifications').doc(p.classification.id), p.classification.data);
  tx.update(pRef, { status: 'desfeita', undoneAt: FieldValue.serverTimestamp() });
  return `${p.collection === 'expenses' ? 'Despesas' : 'Receitas'} ${p.docId} restaurado (exclusão desfeita).`;
}
