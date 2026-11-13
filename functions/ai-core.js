// Funções determinísticas testáveis sem Firebase ou provedor generativo.
export const MASTER_EMAIL = 'fernandoazeredo64@gmail.com';

export const SCOPES = Object.freeze({
  despesas: { title:'Despesas', collection:'expenses', path:'/despesas', words:['despesa','fornecedor','boleto','pagamento de despesa'] },
  receitas: { title:'Receitas', collection:'receivables', path:'/alvaras', words:['receita','alvara','alvará','honorario','honorário','recebimento','reclamante','processo'] },
  repasses: { title:'Repasse de Alvarás', collection:'alvaraTransfers', path:'/repasse-alvaras', words:['repasse de alvara','repasse de alvará','parcela do cliente'] },
  societario: { title:'Repasse Societário', collection:'societaryTransfers', path:'/repasse-societario', words:['societario','societário','sociedade','ana','flavio','flávio'] },
  notas: { title:'Nota Fiscal', collection:'fiscalNotes', path:'/nota-fiscal', words:['nota fiscal','nfse','nfs-e'] },
  comissoes: { title:'Comissões de Agentes', collection:'agentCommissions', path:'/comissoes-agentes', words:['comissao','comissão','comissoes','comissões','agente'] },
  aprovacoes: { title:'Aprovações', collection:'approvals', path:'/aprovacoes', virtual:true, words:['aprovacao','aprovação','aprovar','pendencia','pendência','rejeitado','devolvido'] },
  dre: { title:'Classificações DRE', collection:'managerialClassifications', path:'/dre-gerencial', words:['dre','classificacao','classificação'] },
  contas: { title:'Plano de Contas', collection:'chartOfAccounts', path:'/plano-contas', words:['plano de contas','conta contábil','codigo contábil','código contábil'] },
  contabilidade: { title:'Envios à Contabilidade', collection:'accountingDispatches', path:'/contabilidade', words:['contabilidade','pacote contabil','pacote contábil'] },
  banco: { title:'Conciliação Bancária', collection:'bankReconciliations', path:'/conciliacao-bancaria', words:['conciliacao','conciliação','conciliado'] },
  movimentos: { title:'Movimentos Bancários', collection:'bankTransactions', path:'/conciliacao-bancaria', words:['extrato','ofx','movimento bancario','movimentação bancária'] },
  documentos: { title:'Documentos', collection:'documents', path:'/documentos', words:['arquivo de documentos','documentos','comprovante'] },
  usuarios: { title:'Usuários', collection:'users', path:'/usuarios', words:['usuario','usuário','perfil','acesso'] },
  auditoria: { title:'Auditoria', collection:'auditLogs', path:'/auditoria', words:['auditoria','log','quem alterou','quem aprovou'] },
  competencias: { title:'Fechamento Bancário', collection:'bankReconciliationPeriods', path:'/conciliacao-bancaria', words:['fechamento bancario','competencia fechada','competência fechada'] },
});

export const FINANCIAL_FIELDS = [
  'processo','process','reclamante','reclamada','nome','fornecedor','favorecido','beneficiary',
  'agentName','status','unidade','competencia','data','receiptDate','paymentDate','paidDate',
  'createdAt','updatedAt','description','descricao','descricaoOrigem','categoria','natureza','origem',
  'valorAlvara','valorTotal','officeFees','honorarios','agentCommissionValue','transferValue',
  'paidValue','value','amount','amountPaid','total','netValue','paidTotal','balance',
  'totalAmount','remainingAmount','percent','sourceReceivableId','receivableId','sourceId',
  'type','sourceType','accountCode','accountName','accountDre','dueDate','installments','period',
  'month','bankAccountId','transactionCount','reconciledCount','probableCount',
  'unmatchedBankCount','unmatchedSystemCount','approvedByName','closedByName','closedAt',
  'userName','userEmail','module','action','detail','displayName','role','lastLoginAt',
  'code','category','dre','name','parentCode','documentCount','expenseCount','receivableCount',
  'commissionCount','transferCount','societaryCount','expenseTotal','revenueTotal',
];

export function normalizeText(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
export function inScope(q) {
  const text=normalizeText(q);
  const subjects=Object.entries(SCOPES)
    .filter(([,v])=>v.words.some(w=>text.includes(normalizeText(w))))
    .map(([k])=>k);
  if (/como (faco|funciona|uso)|onde (fica|encontro)|regra|permissao/.test(text) && subjects.length===0) return ['receitas'];
  if (/resumo|visao geral|panorama|situacao financeira|como estamos|como esta o (escritorio|financeiro)|pendencias de hoje|o que esta pendente/.test(text)) return [...new Set([...subjects,'receitas','despesas','aprovacoes','comissoes','repasses','societario'])].slice(0,6);
  if (/saldo|fluxo de caixa|dashboard|resultado financeiro|calendario financeiro|\bhoje\b|\bsemana\b|\bmes\b|mensal|semanal/.test(text)) return [...new Set([...subjects,'receitas','despesas','comissoes','repasses'])].slice(0,5);
  return subjects.slice(0,4);
}
export function isAppQuestion(q) {
  const n=normalizeText(q);
  if (n.length<5 || n.length>500) return false;
  const outside=/\b(clima|temperatura|futebol|receita culinaria|politica partidaria|horoscopo|poema|traduza ingles|cotacao bitcoin)\b/i;
  return !outside.test(n) && (inScope(q).length>0 || isChangeRequest(q) || isDeleteRequest(q) || /tesouraria|aplicativo|sistema|modulo|regra|financeiro|caixa|calendario|lancamento|resumo|situacao financeira|panorama|visao geral|pendencia/.test(n));
}
export function redactSensitive(value) {
  return String(value).replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,'[CPF oculto]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,'[CNPJ oculto]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[e-mail oculto]');
}
export function safeRecord(id, data) {
  const filtered={id};
  for (const key of FINANCIAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data,key)) continue;
    let value=data[key];
    if(value&&typeof value.toDate==='function') value=value.toDate().toISOString();
    if(typeof value==='string') value=redactSensitive(value.slice(0,160));
    if(typeof value==='number' && !Number.isFinite(value)) continue;
    if(typeof value==='string'||typeof value==='number'||typeof value==='boolean') filtered[key]=value;
  }
  return filtered;
}
export function isMasterClaim(token, profile) {
  return !!token && normalizeText(token.email)===MASTER_EMAIL &&
    token.email_verified===true &&
    !!profile && normalizeText(profile.email)===MASTER_EMAIL &&
    profile.role==='master' && profile.status==='active';
}
export function selectedCollections(q) {
  let keys=inScope(q);
  if (isDeleteRequest(q)) return ['despesas','receitas'].filter(k=>keys.length===0||keys.includes(k)||!keys.some(x=>x==='despesas'||x==='receitas')).map(k=>({key:k,...SCOPES[k]}));
  if (isChangeRequest(q)) {
    // Para alterar é preciso ler o documento real (nomes de campo exatos), não só a fila calculada.
    if (keys.length===0 || keys.includes('aprovacoes')) keys=[...new Set([...keys.filter(k=>k!=='aprovacoes'),'despesas','receitas','comissoes','repasses','societario'])];
    keys=keys.slice(0,5);
  }
  return keys.map(k=>({key:k,...SCOPES[k]}));
}

// ===== Fila de Aprovações (mesma regra da tela /aprovacoes) =====
export const APPROVAL_DECIDED = ['aprovado','pago','paga','devolvido','rejeitado'];
export const APPROVAL_SOURCES = Object.freeze([
  { collection:'expenses', type:'Despesa', statuses:['enviado_aprovacao','em_analise'], value:['valorTotal'], title:['fornecedor','favorecido','nomeFornecedor','nomeFavorecido','nome'] },
  { collection:'agentCommissions', type:'Comissão de Agente', statuses:['aguardando_aprovacao'], value:['netAmountDue','amountDue'], title:['beneficiary'] },
  { collection:'alvaraTransfers', type:'Repasse de Alvará', statuses:['aguardando_aprovacao'], value:['amountDue'], title:['beneficiary'] },
  { collection:'societaryTransfers', type:'Repasse Societário', statuses:['aguardando_aprovacao'], value:['approvedValue','transferValue'], title:['beneficiary'] },
]);
const DECISION_LABEL={aprovado:'Aprovado',pago:'Aprovado e pago',paga:'Aprovado e pago',devolvido:'Devolvido para correção',rejeitado:'Rejeitado'};
function firstOf(data, keys) { for (const k of keys) { const v=data?.[k]; if (v!==undefined && v!==null && v!=='') return v; } return null; }
function toNum(v) { if (typeof v==='number') return v; const n=Number(String(v ?? '').replace(/\./g,'').replace(',','.')); return Number.isFinite(n)?n:0; }
function toIso(v) { if (!v) return null; if (typeof v.toDate==='function') return v.toDate().toISOString(); if (typeof v==='string') return v; if (typeof v.seconds==='number') return new Date(v.seconds*1000).toISOString(); return null; }
export function dateSP(iso) { return iso ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(iso)) : null; }
export function approvalQueueItem(source, id, data) {
  const status=String(data?.status||'');
  const pending=source.statuses.includes(status);
  const decidedAt=pending?null:toIso(firstOf(data,['approvedAt','decisionAt','paidAt','updatedAt']));
  return {
    id, colecao:source.collection, tipo:source.type,
    situacao: pending ? 'Aguardando aprovação' : (DECISION_LABEL[status]||status),
    titulo:redactSensitive(String(firstOf(data, source.title) || source.type).slice(0,160)),
    processo:data?.processo ? redactSensitive(String(data.processo).slice(0,80)) : undefined,
    competencia:data?.competencia || undefined,
    valor:toNum(firstOf(data, source.value)),
    dataDecisao: decidedAt ? dateSP(decidedAt) : undefined,
  };
}
export function buildApprovalQueue(bySource) {
  const rows=[];
  for (const source of APPROVAL_SOURCES) {
    for (const {id,data} of (bySource[source.collection] || [])) {
      const st=String(data?.status||'');
      if (source.statuses.includes(st) || APPROVAL_DECIDED.includes(st)) rows.push(approvalQueueItem(source,id,data));
    }
  }
  return rows;
}
export function approvalTotals(rows, todaySP) {
  const sum=f=>rows.filter(f).reduce((a,r)=>a+(Number(r.valor)||0),0);
  const pend=r=>r.situacao==='Aguardando aprovação';
  return {
    hoje: todaySP,
    pendentes_quantidade: rows.filter(pend).length,
    pendentes_valor: sum(pend),
    aprovados_hoje_quantidade: rows.filter(r=>/^Aprovado/.test(r.situacao)&&r.dataDecisao===todaySP).length,
    aprovados_hoje_valor: sum(r=>/^Aprovado/.test(r.situacao)&&r.dataDecisao===todaySP),
    aprovados_mes_valor: sum(r=>/^Aprovado/.test(r.situacao)&&r.dataDecisao&&r.dataDecisao.slice(0,7)===todaySP.slice(0,7)),
    devolvidos_ou_rejeitados_hoje: rows.filter(r=>/Devolvido|Rejeitado/.test(r.situacao)&&r.dataDecisao===todaySP).length,
  };
}

// ===== Alterações assistidas (somente Master, com confirmação expressa) =====
export const WRITABLE_COLLECTIONS = Object.freeze(
  Object.values(SCOPES).filter(s=>!s.virtual && !['users','auditLogs'].includes(s.collection)).map(s=>s.collection)
);
export const PROTECTED_FIELDS = new Set([
  'id','uid','userId','userEmail','userName','email','role','createdAt','createdBy','createdByName','createdByEmail',
  'updatedAt','approvedBy','approvedByName','approvedByEmail','decisionBy','decisionByName','decisionByEmail',
  'closedBy','closedByName','lastAiChangeAt','lastAiChangeId',
]);
const SENSITIVE_FIELD=/cpf|cnpj|agencia|agência|conta(?!b)|account(number|digit)|pix|senha|password|token/i;
const CHANGE_VERBS=/\b(alter[ae]r?|alteracao|mud[ae]r?|corrij[ao]|corrigir|atualiz[ae]r?|troc[ae]r?|ajust[ae]r?|marqu[ae]|marcar|defin[ae]|definir|edit[ae]r?|substitu[ai]r?|coloqu[ae]|colocar|muda)\b/;
export function isChangeRequest(q) { return CHANGE_VERBS.test(normalizeText(q)); }
// Exclusão de lançamento (somente Despesas e Receitas, com confirmação expressa do Master).
export const DELETABLE_COLLECTIONS = Object.freeze(['expenses','receivables']);
const DELETE_VERBS=/\b(exclu(a|am|ir|ia)|exclusao|apag(ue|uem|ar)|delet(e|ar)|remov(a|er))\b/;
const DELETE_TARGET=/\b(lancamento|lancamentos|despesa|despesas|receita|receitas|alvara|alvaras|acordo|acordos|recebimento|recebimentos)\b/;
export function isDeleteRequest(q) { const n=normalizeText(q); return DELETE_VERBS.test(n) && DELETE_TARGET.test(n) && !/classific|\bdre\b|anexo|arquivo/.test(n); }
export function coerceValue(type, raw) {
  if (type==='null') return null;
  if (type==='boolean') { const t=normalizeText(raw); if (['true','sim','verdadeiro'].includes(t)) return true; if (['false','nao','falso'].includes(t)) return false; throw new Error('Valor booleano inválido.'); }
  if (type==='number') { const n=toNum(raw); if (!Number.isFinite(n) || String(raw).trim()==='') throw new Error('Valor numérico inválido.'); return n; }
  const s=String(raw ?? ''); if (s.length>500) throw new Error('Texto acima de 500 caracteres.'); return s;
}
export function validateProposal(p) {
  if (!p || typeof p!=='object') throw new Error('Proposta ausente.');
  const collection=String(p.collection||'');
  if (!WRITABLE_COLLECTIONS.includes(collection)) throw new Error(`Coleção não permitida para alteração: ${collection || '(vazia)'}.`);
  const docId=String(p.docId||'');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(docId)) throw new Error('Identificador do lançamento inválido.');
  const list=Array.isArray(p.changes)?p.changes:[];
  if (list.length===0) throw new Error('Nenhum campo a alterar.');
  if (list.length>15) throw new Error('Máximo de 15 campos por alteração.');
  const changes={};
  for (const c of list) {
    const field=String(c?.field||'');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(field)) throw new Error(`Campo inválido: ${field}.`);
    if (PROTECTED_FIELDS.has(field) || field.startsWith('executiveAi')) throw new Error(`Campo protegido: ${field}.`);
    if (SENSITIVE_FIELD.test(field)) throw new Error(`Campo sensível não pode ser alterado pela IA: ${field}.`);
    if (Object.prototype.hasOwnProperty.call(changes,field)) throw new Error(`Campo repetido: ${field}.`);
    changes[field]=coerceValue(String(c?.type||'string'), c?.value);
  }
  return { collection, docId, changes, summary:String(p.summary||'').slice(0,400) };
}
export function isPrimitive(v) { return v===null || ['string','number','boolean'].includes(typeof v); }
export function buildDiff(current, changes) {
  const before={}, missing=[], diff=[];
  for (const [field,after] of Object.entries(changes)) {
    const has=current && Object.prototype.hasOwnProperty.call(current,field);
    const value=has?current[field]:undefined;
    if (has && !isPrimitive(value)) throw new Error(`O campo ${field} tem estrutura complexa e não pode ser alterado pela IA.`);
    if (has) before[field]=value; else missing.push(field);
    diff.push({ field, before: has?value:null, after });
  }
  if (diff.every(d=>d.before===d.after && !missing.includes(d.field))) throw new Error('Os valores pedidos já são os atuais. Nada a alterar.');
  return { before, missing, diff };
}
export function sameValues(current, expected, missing=[]) {
  for (const [k,v] of Object.entries(expected)) if (current?.[k]!==v) return false;
  for (const k of missing) if (current && Object.prototype.hasOwnProperty.call(current,k)) return false;
  return true;
}
