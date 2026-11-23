// Testes das correções de segurança em firestore.rules (auditoria de 21/11/2026).
// Não faz parte do npm test. Para rodar localmente:
//   npm i -D --legacy-peer-deps firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project demo-tesouraria-fm \
//     "node --experimental-strip-types --test --test-concurrency=1 tests/emulator/"
import test, { after, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
let env

const users = {
  operador: { uid: 'op1', email: 'operador.teste@example.test', role: 'operador' },
  operador2: { uid: 'op2', email: 'operador2.teste@example.test', role: 'operador' },
  gerente: { uid: 'ge1', email: 'gerente.teste@example.test', role: 'gerente' },
  tesouraria: { uid: 'te1', email: 'tesouraria.teste@example.test', role: 'tesouraria' },
}
const dbAs = (u, extra = {}) => env.authenticatedContext(u.uid, { email: u.email, ...extra }).firestore()

async function seed(path, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path, id), data) })
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tesouraria-fm-seguranca', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } })
})
after(async () => { await env?.cleanup() })

test.beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const u of Object.values(users)) await setDoc(doc(ctx.firestore(), 'users', u.uid), { uid: u.uid, email: u.email, role: u.role, status: 'active', displayName: u.role })
  })
})

const approvedExpense = { status: 'aprovado', valorTotal: 1000, fornecedor: 'FORNECEDOR TESTE', createdBy: 'op1', items: [{ descricao: 'Item', valor: 1000 }] }

test('tesouraria marca despesa aprovada como paga sem alterar valor', async () => {
  await seed('expenses', 'exp1', approvedExpense)
  await assertSucceeds(updateDoc(doc(dbAs(users.tesouraria), 'expenses', 'exp1'), { status: 'pago', paymentDate: '2026-11-21', paidBy: 'te1', updatedAt: serverTimestamp() }))
})

test('tesouraria não altera valor de despesa já aprovada', async () => {
  await seed('expenses', 'exp1', approvedExpense)
  await assertFails(updateDoc(doc(dbAs(users.tesouraria), 'expenses', 'exp1'), { status: 'pago', valorTotal: 9000 }))
  await assertFails(updateDoc(doc(dbAs(users.tesouraria), 'expenses', 'exp1'), { status: 'aprovado', fornecedor: 'OUTRO' }))
})

test('despesa criada precisa ter o próprio usuário como autor', async () => {
  const db = dbAs(users.operador)
  await assertSucceeds(setDoc(doc(db, 'expenses', 'novo1'), { status: 'rascunho', valorTotal: 10, createdBy: 'op1' }))
  await assertFails(setDoc(doc(db, 'expenses', 'novo2'), { status: 'rascunho', valorTotal: 10, createdBy: 'op2' }))
})

test('comissão aprovada: pagamento permitido, troca de valor devido negada', async () => {
  const plan = { status: 'aprovado', amountDue: 500, installments: [{ value: 250, paid: false }, { value: 250, paid: false }] }
  await seed('agentCommissions', 'c1', plan)
  const db = dbAs(users.tesouraria)
  await assertFails(updateDoc(doc(db, 'agentCommissions', 'c1'), { amountDue: 5000 }))
  await assertFails(updateDoc(doc(db, 'agentCommissions', 'c1'), { installments: [{ value: 500, paid: true }], status: 'pago' }))
  await assertSucceeds(updateDoc(doc(db, 'agentCommissions', 'c1'), { installments: [{ value: 250, paid: true }, { value: 250, paid: false }], status: 'parcialmente_pago', paidValue: 250 }))
})

test('comissão aprovada: tesouraria não altera o valor de uma parcela ao pagar', async () => {
  const plan = { status: 'aprovado', amountDue: 500, installments: [{ value: 250, paid: false }, { value: 250, paid: false }] }
  await seed('agentCommissions', 'c2', plan)
  const db = dbAs(users.tesouraria)
  await assertFails(updateDoc(doc(db, 'agentCommissions', 'c2'), { installments: [{ value: 400, paid: true }, { value: 100, paid: false }], status: 'parcialmente_pago' }))
  await assertFails(updateDoc(doc(db, 'agentCommissions', 'c2'), { installments: [{ value: 250, paid: true }, { value: 999, paid: false }], status: 'parcialmente_pago' }))
})

test('comissão com 12 parcelas: paga a 1ª sem mudar valores; alterar a 10ª é negado', async () => {
  const installments = Array.from({ length: 12 }, () => ({ value: 100, paid: false }))
  await seed('agentCommissions', 'c12', { status: 'aprovado', amountDue: 1200, installments })
  const db = dbAs(users.tesouraria)
  const paidFirst = installments.map((item, index) => index === 0 ? { ...item, paid: true } : item)
  const changedTenth = paidFirst.map((item, index) => index === 9 ? { ...item, value: 1 } : item)
  await assertFails(updateDoc(doc(db, 'agentCommissions', 'c12'), { installments: changedTenth, status: 'parcialmente_pago' }))
  await assertSucceeds(updateDoc(doc(db, 'agentCommissions', 'c12'), { installments: paidFirst, status: 'parcialmente_pago' }))
})

test('repasse de alvará: plano devolvido pode ser replanejado com novos valores', async () => {
  const plan = { status: 'devolvido', amountDue: 500, installments: [{ value: 500, paid: false }] }
  await seed('alvaraTransfers', 't1', plan)
  await assertSucceeds(updateDoc(doc(dbAs(users.tesouraria), 'alvaraTransfers', 't1'), { status: 'aguardando_aprovacao', installments: [{ value: 200, paid: false }, { value: 300, paid: false }] }))
})

test('operador não edita rascunho de receita de outro operador; gerente pode', async () => {
  await seed('receivables', 'r1', { status: 'rascunho', valorAlvara: 100, createdBy: 'op2' })
  await assertFails(updateDoc(doc(dbAs(users.operador), 'receivables', 'r1'), { valorAlvara: 200 }))
  await assertSucceeds(updateDoc(doc(dbAs(users.gerente), 'receivables', 'r1'), { valorAlvara: 200 }))
})

test('tesouraria confirma receita sem alterar valores', async () => {
  await seed('receivables', 'r1', { status: 'enviado_tesouraria', valorAlvara: 100, createdBy: 'op1' })
  const db = dbAs(users.tesouraria)
  await assertFails(updateDoc(doc(db, 'receivables', 'r1'), { status: 'recebido_tesouraria', valorAlvara: 1 }))
  await assertSucceeds(updateDoc(doc(db, 'receivables', 'r1'), { status: 'recebido_tesouraria', treasuryBy: 'te1' }))
})

test('repasse societário: tesouraria paga exatamente o valor apurado', async () => {
  await seed('societaryTransfers', 's1', { status: 'enviado_tesouraria', transferValue: 700, sourceReceivableId: 's1' })
  const db = dbAs(users.tesouraria)
  await assertFails(updateDoc(doc(db, 'societaryTransfers', 's1'), { status: 'pago', paidValue: 900 }))
  await assertFails(updateDoc(doc(db, 'societaryTransfers', 's1'), { status: 'pago', paidValue: 700, transferValue: 900 }))
  await assertSucceeds(updateDoc(doc(db, 'societaryTransfers', 's1'), { status: 'pago', paidValue: 700, paymentDate: '2026-11-21', paidBy: 'te1' }))
})

test('auditoria não aceita registro em nome de outro usuário', async () => {
  const db = dbAs(users.operador)
  const valid = { action: 'Teste', module: 'Despesas', detail: 'Operacao', userId: 'op1',
    userName: 'operador', userEmail: users.operador.email, createdAt: serverTimestamp() }
  await assertSucceeds(addDoc(collection(db, 'auditLogs'), valid))
  await assertFails(addDoc(collection(db, 'auditLogs'), { ...valid, action: 'Forjado', userId: 'ge1' }))
  await assertFails(addDoc(collection(db, 'auditLogs'), { ...valid, userEmail: 'outra@example.test' }))
  await assertFails(addDoc(collection(db, 'auditLogs'), { ...valid, userName: 'gerente' }))
  await assertFails(addDoc(collection(db, 'auditLogs'), { ...valid, createdAt: new Date('2020-01-01') }))
  await assertFails(addDoc(collection(db, 'auditLogs'), { ...valid, isMaster: true }))
})

test('cadastro com e-mail de sócio exige e-mail verificado', async () => {
  const fake = { uid: 'fake1', email: 'flavio.marques@marquesemuller.adv.br' }
  const payload = { uid: 'fake1', email: fake.email, role: 'diretor', status: 'pending' }
  await assertFails(setDoc(doc(dbAs(fake, { email_verified: false }), 'users', 'fake1'), payload))
  await assertSucceeds(setDoc(doc(dbAs(fake, { email_verified: true }), 'users', 'fake1'), payload))
})

test('repasse societario: impede adulterar valor durante aprovacao e envio', async () => {
  const master = { uid: 'master1', email: 'fernandoazeredo64@gmail.com' }
  await seed('users', master.uid, { uid: master.uid, email: master.email, role: 'master', status: 'active' })
  const db = dbAs(master, { email_verified: true })
  await seed('societaryTransfers', 'seg1', { status: 'aguardando_aprovacao', sourceReceivableId: 'seg1', transferValue: 700, percent: 40 })
  await assertFails(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'aprovado', transferValue: 900, approvedValue: 900, approvedPercent: 40 }))
  await assertSucceeds(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'aprovado', approvedValue: 700, approvedPercent: 40 }))
  await assertFails(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'enviado_tesouraria', percent: 50 }))
  await assertSucceeds(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'enviado_tesouraria' }))
  await assertFails(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'apurado', transferValue: 300 }))
  await assertSucceeds(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { status: 'apurado' }))
  await assertSucceeds(updateDoc(doc(db, 'societaryTransfers', 'seg1'), { transferValue: 300 }))
})
