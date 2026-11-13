import test from 'node:test'
import assert from 'node:assert/strict'
import { effectiveView, canDecideApproval, firestoreViewSupported, defaultRoles } from '../src/lib/permissionCatalog.ts'
const admin='fernandoazeredo64@gmail.com', director='flavio.marques@marquesemuller.adv.br'
const config=(id,ver)=>({schemaVersion:1,modules:{[id]:{ver}}})
test('Master oficial não perde acesso mesmo se desmarcado',()=>{
  assert.equal(effectiveView('auditoria','master',admin,config('auditoria',false),admin,director),true)
  assert.equal(effectiveView('configuracoes','master',admin,config('configuracoes',false),admin,director),true)
})
test('Administração: padrão só do Fernando, mas ele pode liberar',()=>{
  for(const id of ['auditoria','usuarios','utilitarios','configuracoes']){
    assert.equal(effectiveView(id,'diretor',director,null,admin,director),false)
    assert.equal(effectiveView(id,'diretor',director,config(id,true),admin,director),true)
  }
})
test('Plano de Contas pode ser concedido como consulta a usuários ativos',()=>{
  assert.equal(firestoreViewSupported('plano_contas','operador'),true)
  assert.equal(effectiveView('plano_contas','operador','operador@example.test',config('plano_contas',true),admin,director),true)
  assert.equal(effectiveView('plano_contas','operador','operador@example.test',null,admin,director),false)
})
test('Operador: módulos fora do padrão ficam trancados, mas o Fernando pode liberar',()=>{
  for(const id of ['repasse_alvaras','repasse_societario','comissoes','nota_fiscal','contabilidade','calendario','conciliacao']){
    assert.equal(firestoreViewSupported(id,'operador'),true)
    assert.equal(effectiveView(id,'operador','operador@example.test',null,admin,director),false)
    assert.equal(effectiveView(id,'operador','operador@example.test',config(id,true),admin,director),true)
  }
})
test('Fluxo de Caixa: padrão Fernando e Flávio, Fernando pode liberar',()=>{
  assert.equal(effectiveView('fluxo_caixa','diretor',director,null,admin,director),true)
  assert.equal(effectiveView('fluxo_caixa','gerente','reinaldo@marquesemuller.adv.br',null,admin,director),false)
  assert.equal(effectiveView('fluxo_caixa','tesouraria','socorro@marquesemuller.adv.br',config('fluxo_caixa',true),admin,director),true,'Fernando decide')
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

test('Socorro sem Plano de Contas por padrão; Fernando pode liberar',()=>{
  const socorro='socorro@marquesemuller.adv.br'
  assert.equal(effectiveView('plano_contas','tesouraria',socorro,null,admin,director),false)
  assert.equal(effectiveView('plano_contas','tesouraria',socorro,config('plano_contas',true),admin,director),true,'Fernando pode liberar')
})

test('Reinaldo acessa somente Receitas, Repasse de Alvarás, Comissões e Aprovações, sem poder decidir',()=>{
  const email='reinaldo@marquesemuller.adv.br'
  for(const id of Object.keys(defaultRoles)){
    assert.equal(effectiveView(id,'gerente',email,null,admin,director),['receitas','repasse_alvaras','comissoes','aprovacoes'].includes(id),id)
  }
  assert.equal(effectiveView('despesas','gerente',email,config('despesas',true),admin,director),true,'Fernando pode liberar')
  assert.equal(canDecideApproval('gerente',email,admin,director),false)
})
test('Aprovações são consultáveis por todos; Socorro não decide',()=>{
  for(const [role,email] of [['tesouraria','socorro@marquesemuller.adv.br'],['gerente','reinaldo@marquesemuller.adv.br'],['operador','operador@example.test']]){
    assert.equal(effectiveView('aprovacoes',role,email,null,admin,director),true)
    assert.equal(effectiveView('aprovacoes',role,email,config('aprovacoes',false),admin,director),false,'Fernando pode trancar')
    assert.equal(canDecideApproval(role,email,admin,director),false)
  }
})

test('Flávio vê tudo, exceto DRE, Plano de Contas, Contabilidade, administração, Documentos e Conciliação',()=>{
  const blocked=['ia','dre','plano_contas','contabilidade','usuarios','auditoria','utilitarios','configuracoes','documentos','conciliacao']
  for(const id of Object.keys(defaultRoles)){
    assert.equal(effectiveView(id,'diretor',director,null,admin,director),!blocked.includes(id),id)
  }
  assert.equal(effectiveView('dre','diretor',director,config('dre',true),admin,director),true,'Fernando pode liberar')
})

test('Permissões pré-login são gravadas por e-mail',async()=>{
  const { pendingPermissionDocId } = await import('../src/lib/permissionCatalog.ts')
  assert.equal(pendingPermissionDocId(' Reinaldo@MarquesEMuller.adv.br '),'email:reinaldo@marquesemuller.adv.br')
})

test('IA Executiva só do Fernando por padrão; Fernando pode liberar para qualquer perfil',()=>{
  assert.equal(effectiveView('ia','master',admin,null,admin,director),true)
  assert.equal(effectiveView('ia','tesouraria','socorro@marquesemuller.adv.br',null,admin,director),false)
  assert.equal(effectiveView('ia','tesouraria','socorro@marquesemuller.adv.br',config('ia',true),admin,director),true)
})
