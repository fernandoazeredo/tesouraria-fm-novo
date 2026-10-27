import test from 'node:test'
import assert from 'node:assert/strict'
import { effectiveView, canDecideApproval, firestoreViewSupported, defaultRoles } from '../src/lib/permissionCatalog.ts'
const admin='fernandoazeredo64@gmail.com', director='flavio.marques@marquesemuller.adv.br'
const config=(id,ver)=>({schemaVersion:1,modules:{[id]:{ver}}})
test('Master oficial não perde acesso mesmo se desmarcado',()=>{
  assert.equal(effectiveView('auditoria','master',admin,config('auditoria',false),admin,director),true)
  assert.equal(effectiveView('configuracoes','master',admin,config('configuracoes',false),admin,director),true)
})
test('Auditoria e administração não podem ser concedidas a outro perfil',()=>{
  for(const id of ['auditoria','usuarios','utilitarios','configuracoes'])
    assert.equal(effectiveView(id,'diretor',director,config(id,true),admin,director),false)
})
test('Plano de Contas pode ser concedido como consulta a usuários ativos',()=>{
  assert.equal(firestoreViewSupported('plano_contas','operador'),true)
  assert.equal(effectiveView('plano_contas','operador','operador@example.test',config('plano_contas',true),admin,director),true)
  assert.equal(effectiveView('plano_contas','operador','operador@example.test',null,admin,director),false)
})
test('Módulos incompatíveis com Rules não são liberados para operador',()=>{
  for(const id of ['repasse_alvaras','repasse_societario','comissoes','nota_fiscal','contabilidade','calendario','conciliacao']){
    assert.equal(firestoreViewSupported(id,'operador'),false)
    assert.equal(effectiveView(id,'operador','operador@example.test',config(id,true),admin,director),false)
  }
})
test('Fluxo de Caixa permanece restrito às duas contas oficiais',()=>{
  assert.equal(effectiveView('fluxo_caixa','diretor',director,null,admin,director),true)
  assert.equal(effectiveView('fluxo_caixa','diretor','outro@example.test',config('fluxo_caixa',true),admin,director),false)
})
test('Aprovações podem ser decididas apenas por Master e Diretor oficiais',()=>{
  assert.equal(canDecideApproval('master',admin,admin,director),true)
  assert.equal(canDecideApproval('diretor',director,admin,director),true)
  assert.equal(canDecideApproval('tesouraria','socorro@example.test',admin,director),false)
  assert.equal(canDecideApproval('gerente','reinaldo@example.test',admin,director),false)
})
test('Sem configuração, módulo usa padrão do perfil',()=>{
  assert.equal(effectiveView('dre','gerente','g@example.test',null,admin,director),true)
  assert.equal(effectiveView('dre','tesouraria','t@example.test',null,admin,director),false)
  assert.equal(defaultRoles['receitas'].includes('operador'),true)
})

test('Socorro não recebe Plano de Contas nem por concessão explícita',()=>{
  const socorro='socorro@marquesemuller.adv.br'
  assert.equal(effectiveView('plano_contas','tesouraria',socorro,null,admin,director),false)
  assert.equal(effectiveView('plano_contas','tesouraria',socorro,config('plano_contas',true),admin,director),false)
})

test('Reinaldo acessa somente Receitas e Aprovações, sem poder decidir',()=>{
  const email='reinaldo@marquesemuller.adv.br'
  for(const id of Object.keys(defaultRoles)){
    assert.equal(effectiveView(id,'gerente',email,null,admin,director),id==='receitas'||id==='aprovacoes',id)
  }
  assert.equal(effectiveView('despesas','gerente',email,config('despesas',true),admin,director),false)
  assert.equal(canDecideApproval('gerente',email,admin,director),false)
})
test('Aprovações são consultáveis por todos; Socorro não decide',()=>{
  for(const [role,email] of [['tesouraria','socorro@marquesemuller.adv.br'],['gerente','reinaldo@marquesemuller.adv.br'],['operador','operador@example.test']]){
    assert.equal(effectiveView('aprovacoes',role,email,config('aprovacoes',false),admin,director),true)
    assert.equal(canDecideApproval(role,email,admin,director),false)
  }
})
