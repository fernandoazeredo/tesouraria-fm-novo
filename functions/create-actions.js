// Preparação de lançamentos pela IA: cria RASCUNHO de despesa ou de receita de alvará, sempre com confirmação do Master.
// O envio para aprovação/Tesouraria continua sendo feito na tela, depois de conferir e anexar documentos.
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeText, redactSensitive } from './ai-core.js';

const CREATE_VERBS = /\b(?:crie|criar|cria|lance|lancar|lanca|cadastre|cadastrar|registre|registrar|inclua|incluir|prepare|preparar|faca um rascunho|gere um rascunho)\b/;
const CREATE_TARGET = /\b(?:despesa|despesas|receita|receitas|alvara|alvaras|rascunho|lancamento|acordo|conta de)\b/;
export function isCreateRequest(q) {
  const n = normalizeText(q);
  if (/^como\b|\bcomo (?:eu )?(?:faco|posso|devo|lanco|cadastro)\b/.test(n)) return false;
  return CREATE_VERBS.test(n) && CREATE_TARGET.test(n);
}

const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const txt = (v, n = 160) => redactSensitive(String(v ?? '').trim()).slice(0, n);
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const isoMonth = v => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const br = iso => (iso ? iso.split('-').reverse().join('/') : '—');
const INITIAL_BANKS = [
  { id: 'itau', bank: 'Itaú', agency: '8548', account: '26486-3', holder: '', holderType: 'PJ', active: true },
];

async function defaultBank(db) {
  const snap = await db.collection('appConfig').doc('bankAccounts').get();
  const list = snap.exists && Array.isArray(snap.data().accounts) ? snap.data().accounts : INITIAL_BANKS;
  return list.find(a => a && a.id === 'itau' && a.active !== false) || list.find(a => a && a.active !== false) || INITIAL_BANKS[0];
}
async function companyName(db) {
  const snap = await db.collection('appConfig').doc('institutional').get();
  return String(snap.exists && snap.data().razaoSocial || 'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS');
}

/** Valida o rascunho sugerido pela IA e monta o documento no mesmo formato da tela. */
export function buildDraft(draft, { chart, today, bank, company }) {
  const tipo = String(draft?.tipo || '');
  const valor = Math.round((Number(draft?.valor) || 0) * 100) / 100;
  const unidade = draft?.unidade === 'SP' ? 'SP' : 'RJ';
  if (!(valor > 0)) return { error: 'Informe o valor do lançamento.' };
  if (tipo === 'despesa') {
    const fornecedor = txt(draft.fornecedor, 120);
    const historico = txt(draft.historico, 200);
    if (!fornecedor || !historico) return { error: 'Para a despesa, informe o fornecedor/favorecido e o histórico (do que se trata).' };
    const account = chart.find(a => a.code === String(draft.contaCodigo || '') && a.kind === 'account' && a.category === 'Despesa') || null;
    const competencia = isoMonth(draft.competencia) || today.slice(0, 7);
    const vencimento = isoDate(draft.vencimento);
    const data = isoDate(draft.dataItem) || today;
    const payload = {
      unidade, nome: company, competencia, fornecedor, documento: '',
      categoria: account ? `${account.code} - ${account.name}` : '', subcategoria: '',
      classificacaoContabil: account?.code || null, expenseAccountCode: account?.code || null, expenseAccountName: account?.name || null, expenseAccountDre: account?.dre || null,
      planoConta: account ? { code: account.code, name: account.name, dre: account.dre, category: 'Despesa' } : null,
      paymentBankAccountId: bank.id, paymentBankAccount: bank, paymentDate: vencimento, paymentMethod: '',
      observacoes: 'Rascunho preparado pela IA Executiva — conferir, anexar documentos e enviar para aprovação.',
      items: [{ data, historico, valor }], valorTotal: valor,
      status: 'rascunho', attachments: [], attachmentCount: 0, storageStatus: 'active', createdVia: 'executive-ai',
    };
    const itens = [
      ['Módulo', 'Despesas'], ['Fornecedor / favorecido', fornecedor], ['Histórico', historico], ['Competência', competencia.split('-').reverse().join('/')],
      ['Unidade', unidade], ['Valor', brl(valor)], ['Data prevista de pagamento', br(vencimento)],
      ['Conta do Plano de Contas', account ? `${account.code} — ${account.name}` : 'Não definida (escolha ao editar)'], ['Conta de pagamento', `${bank.bank} — Ag. ${bank.agency} — C/C ${bank.account}`],
      ['Situação', 'Rascunho'],
    ];
    return { collection: 'expenses', payload, itens: itens.map(([label, value]) => ({ label, value })), modulo: 'Despesas', path: '/despesas' };
  }
  if (tipo === 'alvara') {
    const processo = txt(draft.processo, 60);
    const reclamante = txt(draft.reclamante, 120);
    if (!processo || !reclamante) return { error: 'Para a receita de alvará, informe o número do processo e o reclamante (cliente).' };
    const reclamada = txt(draft.reclamada, 120);
    const dataPrevista = isoDate(draft.vencimento);
    const payload = {
      unidade, data: today, natureza: 'Trabalhista', processo, reclamada, reclamante, origem: 'Alvará', formaRecebimento: '', dataPrevista,
      receivingBankAccountId: bank.id, receivingBankAccount: bank, receiptDate: today,
      valorAlvara: valor, baseCalculo: 0, valorLiquidoCliente: valor, totalDeducoes: 0, components: [],
      agentName: '', agentCommissionValue: 0, invoiceValue: 0,
      banco: '', agencia: '', conta: '', titular: '', cpf: '', pix: '', emailNf: '', enderecoNf: '',
      status: 'rascunho', attachments: [], attachmentCount: 0, storageStatus: 'active', createdVia: 'executive-ai',
    };
    const itens = [
      ['Módulo', 'Receitas — Alvará'], ['Processo', processo], ['Reclamante (cliente)', reclamante], ['Reclamada', reclamada || '—'],
      ['Unidade', unidade], ['Valor do alvará', brl(valor)], ['Data prevista de recebimento', br(dataPrevista)],
      ['Conta de recebimento', `${bank.bank} — Ag. ${bank.agency} — C/C ${bank.account}`], ['Situação', 'Rascunho'],
    ];
    return { collection: 'receivables', payload, itens: itens.map(([label, value]) => ({ label, value })), modulo: 'Receitas', path: '/alvaras' };
  }
  if (tipo === 'acordo' || tipo === 'outra') return { error: 'Acordo Trabalhista e Outras Receitas têm formulário próprio e precisam ser lançados pela tela (Receitas → Nova Receita). Pela IA, eu preparo rascunho de despesa ou de receita de alvará.' };
  return { error: 'Não identifiquei se é despesa ou receita de alvará. Diga, por exemplo: "Crie um rascunho de despesa do fornecedor X, R$ 100,00, vence em 20/11".' };
}

export async function proposeCreate(db, { key, model, question, uid, chart, todayBR, today, ttlMs }) {
  const base = { consultedAt: new Date().toISOString(), sources: [], disclaimer: 'Nada é gravado sem a sua confirmação. O rascunho não vai para aprovação sozinho.' };
  const accounts = chart.filter(a => a.kind === 'account' && a.category === 'Despesa').map(a => `${a.code} — ${a.name}`).join('\n');
  const schema = { type: 'OBJECT', properties: {
    answer: { type: 'STRING' },
    draft: { type: 'OBJECT', nullable: true, properties: {
      tipo: { type: 'STRING', enum: ['despesa', 'alvara', 'acordo', 'outra'] },
      fornecedor: { type: 'STRING' }, historico: { type: 'STRING' }, valor: { type: 'NUMBER' },
      competencia: { type: 'STRING' }, unidade: { type: 'STRING', enum: ['RJ', 'SP'] }, vencimento: { type: 'STRING' }, dataItem: { type: 'STRING' },
      contaCodigo: { type: 'STRING' }, processo: { type: 'STRING' }, reclamante: { type: 'STRING' }, reclamada: { type: 'STRING' },
    }, required: ['tipo'] },
  }, required: ['answer'] };
  const rules = [
    'Você prepara RASCUNHOS de lançamentos do TESOURARIA FM NOVO a partir do pedido do Master. Nada é enviado para aprovação.',
    'tipo: despesa (pagamento do escritório), alvara (recebimento de alvará judicial), acordo (acordo trabalhista) ou outra (outras receitas).',
    'Use somente o que está no pedido. Não invente fornecedor, processo, valores ou datas. Campos ausentes ficam vazios.',
    'valor em número com ponto decimal (ex.: 1500.5). Datas no formato AAAA-MM-DD; competência AAAA-MM. Ano não informado = ano atual.',
    'vencimento = data prevista de pagamento (despesa) ou de recebimento (alvará). dataItem = data do histórico da despesa, se informada.',
    'contaCodigo: escolha a conta de despesa mais adequada DA LISTA abaixo somente se o pedido deixar claro (ex.: luz → Energia Elétrica); senão deixe vazio.',
    'answer: uma frase curta em português dizendo o que será criado, sem códigos técnicos.',
    `Contas de despesa disponíveis:\n${accounts}`,
  ].join('\n');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: rules }] },
      contents: [{ role: 'user', parts: [{ text: `Data de hoje (America/Sao_Paulo): ${todayBR()} (${today}).\nPedido: ${question}` }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: schema } }),
    signal: AbortSignal.timeout(45000) });
  if (!response.ok) { console.error('IA provider HTTP', response.status); throw new HttpsError('unavailable', 'Não foi possível consultar o serviço de IA neste momento.'); }
  const json = await response.json();
  let parsed;
  try { parsed = JSON.parse((json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')); }
  catch { throw new HttpsError('unavailable', 'A IA não retornou um rascunho válido. Reformule o pedido.'); }
  const [bank, company] = await Promise.all([defaultBank(db), companyName(db)]);
  const built = buildDraft(parsed?.draft, { chart, today, bank, company });
  if (built.error) return { ...base, answer: built.error };
  const expiresAtMs = Date.now() + ttlMs;
  const prop = await db.collection('executiveAiProposals').add({
    kind: 'criacao', uid, question: question.slice(0, 500), collection: built.collection, payload: built.payload, display: built.itens,
    status: 'pendente', createdAt: FieldValue.serverTimestamp(), expiresAtMs,
  });
  return { ...base,
    answer: `Preparei o rascunho abaixo em **${built.modulo}**. Ele só é criado depois que você clicar em **Criar rascunho**. Depois, abra em [${built.modulo}](${built.path}), confira, anexe os documentos e envie.`,
    proposal: { id: prop.id, kind: 'criacao', modulo: built.modulo, collection: built.collection, summary: 'Rascunho proposto', itens: built.itens, avisos: [], expiresAtMs } };
}

/** Cria o rascunho dentro da transação de aplicar. */
export function applyCreate(db, tx, pRef, p, profile, uid) {
  const ref = db.collection(p.collection).doc();
  tx.set(ref, { ...p.payload, createdBy: uid, createdByName: profile.displayName || profile.name || 'Administrador Master', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  tx.update(pRef, { status: 'aplicada', appliedAt: FieldValue.serverTimestamp(), createdId: ref.id });
  return { id: ref.id, detail: `${p.collection === 'expenses' ? 'Despesas' : 'Receitas'} ${ref.id} — rascunho criado: ${(p.display || []).filter(r => r.label !== 'Módulo').map(r => `${r.label}: ${r.value}`).join(' · ')} · Pedido: ${p.question}` };
}

/** Desfaz: apaga o rascunho criado, desde que continue em rascunho. */
export async function undoCreate(db, tx, pRef, p) {
  const ref = db.collection(p.collection).doc(String(p.createdId || ''));
  const cur = await tx.get(ref);
  if (!cur.exists) throw new HttpsError('not-found', 'O rascunho não existe mais.');
  if (cur.data().status !== 'rascunho') throw new HttpsError('failed-precondition', 'O lançamento já saiu de rascunho. Exclua ou ajuste pela tela.');
  tx.delete(ref);
  tx.update(pRef, { status: 'desfeita', undoneAt: FieldValue.serverTimestamp() });
  return { id: ref.id, detail: `${p.collection === 'expenses' ? 'Despesas' : 'Receitas'} ${ref.id} — rascunho criado pela IA foi removido (desfazer).` };
}
