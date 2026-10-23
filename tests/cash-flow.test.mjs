import test from 'node:test'
import assert from 'node:assert/strict'
import { movements, validatePlan } from '../src/lib/cashFlowMovements.ts'

const calc = ({receivables=[],expenses=[],alvaraTransfers=[],agentCommissions=[],societaryTransfers=[]}={}) =>
  movements(receivables,expenses,alvaraTransfers,agentCommissions,societaryTransfers)

test('receita rascunho e devolvida nao entram no previsto', () => {
  assert.equal(calc({receivables:[
    {id:'a',status:'rascunho',valorAlvara:100000,dataPrevista:'2026-10-25',receivingBankAccountId:'itau'},
    {id:'b',status:'devolvido',valorAlvara:20000,dataPrevista:'2026-10-25',receivingBankAccountId:'itau'}
  ]}).length,0)
})
test('acordo com parcela realizada e futura: contabiliza apenas parcelas, nunca valorAlvara', () => {
  const receivables=[{id:'acordo',tipoRecebimento:'acordo_trabalhista',status:'recebido_tesouraria',valorAlvara:100000,receivingBankAccountId:'itau',parcelas:[
    {valorParcela:70000,dataPrevista:'2026-10-10',dataRealizada:'2026-10-11'},
    {valorParcela:30000,dataPrevista:'2026-11-10',dataRealizada:''}
  ]}]
  const rows=calc({receivables})
  assert.equal(rows.length,2)
  assert.equal(rows.filter(x=>x.stage==='realizado').reduce((v,x)=>v+x.value,0),70000)
  assert.equal(rows.filter(x=>x.stage==='previsto').reduce((v,x)=>v+x.value,0),30000)
})
test('acordo enviado tesouraria: mesmo parcela com dataRealizada e prevista', () => {
  const rows=calc({receivables:[{id:'ac',tipoRecebimento:'acordo_trabalhista',status:'enviado_tesouraria',parcelas:[{valorParcela:100,dataRealizada:'2026-10-10',dataPrevista:'2026-11-10'}]}]})
  assert.equal(rows[0].stage,'previsto')
  assert.equal(rows[0].date,'2026-11-10')
})
test('acordo em rascunho ou devolvido nao aparece', () => {
  for(const status of ['rascunho','devolvido']){
    assert.equal(calc({receivables:[{id:'ac',tipoRecebimento:'acordo_trabalhista',status,parcelas:[{valorParcela:100,dataRealizada:'2026-10-10',dataPrevista:'2026-11-10'}]}]}).length,0)
  }
})
test('plano parcialmente pago conserva previsto e realizado', () => {
  const plan={id:'plan',status:'parcialmente_pago',amountDue:100000,paidValue:70000,installments:[
    {value:70000,paid:true,paidDate:'2026-10-20'},
    {value:30000,paid:false,dueDate:'2026-11-20'}
  ]}
  const rows=calc({alvaraTransfers:[plan]})
  assert.deepEqual(rows.map(x=>[x.stage,x.value]),[['realizado',70000],['previsto',30000]])
  assert.deepEqual(validatePlan(plan),[])
})
test('repasse societario aprovado sem data permanece fora dos meses', () => {
  const rows=calc({societaryTransfers:[{id:'s',status:'aprovado',transferValue:12000}]})
  assert.equal(rows.length,1)
  assert.equal(rows[0].date,'')
  assert.equal(rows.filter(x=>x.date.startsWith('2026-10')).length,0)
})
test('conta pessoa fisica separada de Itau PJ', () => {
  const rows=calc({receivables:[{id:'pf',status:'recebido_tesouraria',valorAlvara:100,receiptDate:'2026-10-22',receivingBankAccountId:'bb-pf'}]})
  assert.equal(rows[0].bank,'outro')
  assert.equal(rows.filter(x=>x.bank==='itau').length,0)
})
test('testes de consistencia acusam diferenca de soma ou pagos', () => {
  const result=validatePlan({id:'divergente',amountDue:100000,paidValue:60000,installments:[{value:70000,paid:true},{value:20000,paid:false}]})
  assert.equal(result.length,2)
})

// ===== Testes adicionais (homologação Claude) =====
test('100 mil recebidos, 70 mil repassados: honorarios de 30 mil nao viram lancamento', () => {
  const rows = calc({
    receivables:[{id:'r1',status:'recebido_tesouraria',valorAlvara:100000,valorLiquidoCliente:70000,invoiceValue:30000,receiptDate:'2026-10-05',receivingBankAccountId:'itau'}],
    alvaraTransfers:[{id:'r1',status:'pago',amountDue:70000,paidValue:70000,installments:[{value:70000,paid:true,paidDate:'2026-10-10'}]}],
  })
  assert.equal(rows.length,2)
  assert.equal(rows.filter(r=>r.direction==='entrada').reduce((s,r)=>s+r.value,0),100000)
  assert.equal(rows.filter(r=>r.direction==='saida').reduce((s,r)=>s+r.value,0),70000)
  assert.equal(rows.find(r=>r.direction==='saida').bank,'indefinido')
})
test('comissao sem conta nunca vai para o Itau', () => {
  const rows = calc({agentCommissions:[{id:'c',status:'aprovado',installments:[{value:500,paid:false,dueDate:'2026-10-30'}]}]})
  assert.equal(rows[0].bank,'indefinido')
})
test('plano aguardando aprovacao nao gera previsto', () => {
  assert.equal(calc({alvaraTransfers:[{id:'p',status:'aguardando_aprovacao',installments:[{value:1,paid:false,dueDate:'2026-10-30'}]}]}).length,0)
})
test('despesa enviada para aprovacao nao entra; aprovada entra como previsto', () => {
  const rows = calc({expenses:[
    {id:'e1',status:'enviado_aprovacao',valorTotal:10,paymentDate:'2026-10-30',paymentBankAccountId:'itau'},
    {id:'e2',status:'aprovado',valorTotal:20,paymentDate:'2026-10-30',paymentBankAccountId:'itau'},
  ]})
  assert.deepEqual(rows.map(r=>[r.id,r.stage]),[['despesa-e2','previsto']])
})
test('despesa sem conta fica indefinida (nao presume Itau)', () => {
  assert.equal(calc({expenses:[{id:'e',status:'pago',valorTotal:5,paymentDate:'2026-10-01'}]})[0].bank,'indefinido')
})
test('receita realizada sem receiptDate usa data alternativa marcada', () => {
  const r = calc({receivables:[{id:'x',status:'recebido_tesouraria',valorAlvara:9,data:'2026-10-02'}]})[0]
  assert.equal(r.date,'2026-10-02')
  assert.equal(r.alternativeDate,true)
})
test('chaves unicas entre receita, repasse, comissao e societario do mesmo processo', () => {
  const rows = calc({
    receivables:[{id:'r',status:'recebido_tesouraria',valorAlvara:1,receiptDate:'2026-10-01'}],
    alvaraTransfers:[{id:'r',status:'aprovado',installments:[{value:1,dueDate:'2026-10-02'},{value:1,dueDate:'2026-10-03'}]}],
    agentCommissions:[{id:'r',status:'aprovado',installments:[{value:1,dueDate:'2026-10-02'}]}],
    societaryTransfers:[{id:'r',status:'pago',paidValue:1,paymentDate:'2026-10-04'}],
  })
  assert.equal(new Set(rows.map(r=>r.id)).size, rows.length)
})
