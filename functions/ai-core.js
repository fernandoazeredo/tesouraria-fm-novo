// Funções determinísticas testáveis sem Firebase ou provedor generativo.
export const MASTER_EMAIL = 'fernandoazeredo64@gmail.com';

export const SCOPES = Object.freeze({
  despesas: { title:'Despesas', collection:'expenses', path:'/despesas', words:['despesa','fornecedor','boleto','pagamento de despesa'] },
  receitas: { title:'Receitas', collection:'receivables', path:'/alvaras', words:['receita','alvara','alvará','honorario','honorário','recebimento','reclamante','processo'] },
  repasses: { title:'Repasse de Alvarás', collection:'alvaraTransfers', path:'/repasse-alvaras', words:['repasse de alvara','repasse de alvará','parcela do cliente'] },
  societario: { title:'Repasse Societário', collection:'societaryTransfers', path:'/repasse-societario', words:['societario','societário','sociedade','ana','flavio','flávio'] },
  notas: { title:'Nota Fiscal', collection:'fiscalNotes', path:'/nota-fiscal', words:['nota fiscal','nfse','nfs-e'] },
  comissoes: { title:'Comissões de Agentes', collection:'agentCommissions', path:'/comissoes-agentes', words:['comissao','comissão','agente'] },
  aprovacoes: { title:'Aprovações', collection:'approvals', path:'/aprovacoes', words:['aprovacao','aprovação','pendencia','pendência','rejeitado'] },
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
  if (/saldo|fluxo de caixa|dashboard|resultado financeiro|calendario financeiro/.test(text)) return [...new Set([...subjects,'receitas','despesas','comissoes','repasses'])].slice(0,4);
  return subjects.slice(0,4);
}
export function isAppQuestion(q) {
  const n=normalizeText(q);
  if (n.length<5 || n.length>500) return false;
  const outside=/\b(clima|temperatura|futebol|receita culinaria|politica partidaria|horoscopo|poema|traduza ingles|cotacao bitcoin)\b/i;
  return !outside.test(n) && (inScope(q).length>0 || /tesouraria|aplicativo|sistema|modulo|regra|financeiro|caixa|calendario/.test(n));
}
export function safeRecord(id, data) {
  const filtered={id};
  for (const key of FINANCIAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data,key)) continue;
    let value=data[key];
    if(value&&typeof value.toDate==='function') value=value.toDate().toISOString();
    if(typeof value==='string') value=value.slice(0,160);
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
  return inScope(q).map(k=>({key:k,...SCOPES[k]}));
}
