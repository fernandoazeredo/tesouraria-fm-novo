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
