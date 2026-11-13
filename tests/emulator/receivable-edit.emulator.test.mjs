// Teste de integração das regras reais (firestore.rules) no Firestore Emulator.
// Reproduz as gravações do ReceivableModal em modo edição (updateDoc no mesmo ID).
// Não faz parte do npm test. Para rodar localmente:
//   npm i -D --legacy-peer-deps firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project demo-tesouraria-fm \
//     "node --experimental-strip-types --test tests/emulator/receivable-edit.emulator.test.mjs"
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { addDoc, arrayUnion, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { stripImmutableFields, receivableAuditAction } from '../../src/lib/receivableEditing.ts'

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
let env

const users = {
  operador: { uid: 'op1', email: 'operador.teste@example.test', role: 'operador' },
  gerente: { uid: 'ge1', email: 'gerente.teste@example.test', role: 'gerente' },
  tesouraria: { uid: 'te1', email: 'tesouraria.teste@example.test', role: 'tesouraria' },
}
const createdAt = Timestamp.fromDate(new Date('2026-10-28T12:43:00-03:00'))

const draft = {
  unidade: 'RJ', data: '2026-10-28', natureza: 'Trabalhista', processo: 'TESTE-COMISSAO-2026-001',
  reclamada: 'RECLAMADA FICTÍCIA — TESTE', reclamante: 'CLIENTE FICTÍCIO — TESTE', origem: 'Alvará',
  valorAlvara: 10000, baseCalculo: 10000, valorLiquidoCliente: 6700, totalDeducoes: 3300,
  components: [
    { nome: 'Honorários do Escritório', percentual: 30, valor: 3000 },
    { nome: 'Outras Deduções / Participações', percentual: 3, valor: 300, detalhe: 'AGENTE FICTÍCIO — TESTE' },
  ],
  agentName: 'AGENTE FICTÍCIO — TESTE', agentCommissionValue: 300, invoiceValue: 3000,
  banco: '', agencia: '', conta: '', titular: '', cpf: '', status: 'rascunho', attachments: [], attachmentCount: 0,
  createdBy: 'op1', createdByName: 'Operador Teste', createdAt,
}

const dbAs = (u) => env.authenticatedContext(u.uid, { email: u.email }).firestore()

async function seed(id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'receivables', id), data) })
}

async function appEdit(db, id, fromStatus, toStatus, changes = {}) {
  const payload = { ...draft, ...changes, status: toStatus, createdAt: 'NAO-DEVE-GRAVAR', createdBy: 'NAO', createdByName: 'NAO' }
  const action = receivableAuditAction(fromStatus === 'rascunho' ? 'draft' : 'returned', toStatus)
  await updateDoc(doc(db, 'receivables', id), {
    ...stripImmutableFields(payload),
    updatedAt: serverTimestamp(), updatedBy: 'op1', updatedByName: 'Operador Teste',
    editHistory: arrayUnion({ action, fromStatus, toStatus, at: new Date().toISOString(), by: 'op1', byName: 'Operador Teste' }),
  })
  await addDoc(collection(db, 'auditLogs'), { action, module: 'Recebimento de Alvarás', detail: `Documento ${id}`, entityId: id, userId: 'op1', createdAt: serverTimestamp() })
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tesouraria-fm', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } })
})
after(async () => { await env?.cleanup() })

test.beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const u of Object.values(users)) await setDoc(doc(ctx.firestore(), 'users', u.uid), { uid: u.uid, email: u.email, role: u.role, status: 'active', displayName: u.role })
  })
})

test('editar e salvar rascunho atualiza o mesmo documento, sem duplicar e preservando createdAt/createdBy', async () => {
  await seed('rec1', draft)
  const db = dbAs(users.operador)
  await assertSucceeds(appEdit(db, 'rec1', 'rascunho', 'rascunho', { formaRecebimento: 'TED (teste)' }))
  const all = await env.withSecurityRulesDisabled(async (ctx) => (await getDocs(collection(ctx.firestore(), 'receivables'))).docs)
  assert.equal(all.length, 1)
  const data = all[0].data()
  assert.equal(all[0].id, 'rec1')
  assert.equal(data.formaRecebimento, 'TED (teste)')
  assert.equal(data.createdBy, 'op1')
  assert.equal(data.createdByName, 'Operador Teste')
  assert.ok(data.createdAt.isEqual(createdAt))
  assert.equal(data.agentCommissionValue, 300)
  assert.equal(data.components.find((c) => c.nome === 'Outras Deduções / Participações').valor, 300)
  assert.equal(data.valorLiquidoCliente, 6700)
  assert.equal(data.editHistory.length, 1)
  assert.equal(data.editHistory[0].action, 'Rascunho de receita editado')
})

test('persistência: nova leitura (equivalente a atualizar a página) traz os dados editados', async () => {
  await seed('rec1', draft)
  await appEdit(dbAs(users.operador), 'rec1', 'rascunho', 'rascunho', { reclamada: 'RECLAMADA EDITADA — TESTE' })
  const fresh = await getDoc(doc(dbAs(users.gerente), 'receivables', 'rec1'))
  assert.equal(fresh.data().reclamada, 'RECLAMADA EDITADA — TESTE')
})

test('rascunho pode ser enviado à Tesouraria pelo mesmo documento', async () => {
  await seed('rec1', draft)
  await assertSucceeds(appEdit(dbAs(users.operador), 'rec1', 'rascunho', 'enviado_tesouraria', { banco: 'BANCO FICTÍCIO', agencia: '0000', conta: '00000-0', titular: 'CLIENTE FICTÍCIO — TESTE', cpf: 'FICTICIO' }))
  const data = (await getDoc(doc(dbAs(users.gerente), 'receivables', 'rec1'))).data()
  assert.equal(data.status, 'enviado_tesouraria')
})

test('corrigir e reenviar receita devolvida', async () => {
  await seed('rec2', { ...draft, status: 'devolvido' })
  const db = dbAs(users.operador)
  await assertSucceeds(appEdit(db, 'rec2', 'devolvido', 'devolvido', { formaRecebimento: 'corrigido' }))
  await assertSucceeds(appEdit(db, 'rec2', 'devolvido', 'enviado_tesouraria'))
  const data = (await getDoc(doc(db, 'receivables', 'rec2'))).data()
  assert.equal(data.status, 'enviado_tesouraria')
  assert.deepEqual(data.editHistory.map((h) => h.action), ['Receita devolvida corrigida', 'Receita corrigida reenviada à Tesouraria'])
})

test('regras bloqueiam edição de receitas enviadas, recebidas ou encerradas pela origem', async () => {
  for (const status of ['enviado_tesouraria', 'recebido_tesouraria', 'encerrado']) {
    await seed(`r-${status}`, { ...draft, status })
    await assertFails(appEdit(dbAs(users.operador), `r-${status}`, 'rascunho', 'rascunho'))
    await assertFails(appEdit(dbAs(users.operador), `r-${status}`, 'rascunho', 'enviado_tesouraria'))
  }
})

test('regras continuam bloqueando transições não autorizadas e perfis sem permissão', async () => {
  await seed('rec3', draft)
  await assertFails(appEdit(dbAs(users.operador), 'rec3', 'rascunho', 'recebido_tesouraria'))
  await assertFails(appEdit(dbAs(users.operador), 'rec3', 'rascunho', 'devolvido'))
  await assertFails(appEdit(dbAs(users.tesouraria), 'rec3', 'rascunho', 'rascunho'))
  const data = (await getDoc(doc(dbAs(users.gerente), 'receivables', 'rec3'))).data()
  assert.equal(data.status, 'rascunho')
  assert.equal(data.editHistory, undefined)
})
