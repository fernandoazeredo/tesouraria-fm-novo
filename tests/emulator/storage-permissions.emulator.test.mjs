// Testes integrados das regras de Storage + consultas ao Firestore.
// Executar com os emuladores storage e firestore, nunca contra producao.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getMetadata, deleteObject } from 'firebase/storage'

const STORAGE_RULES = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')
const FIRESTORE_RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
const PROJECT = 'demo-tesouraria-fm-storage'
const BUCKET = 'gs://' + PROJECT + '.appspot.com'
let env

const users = {
  master: { uid: 'ma1', email: 'fernandoazeredo64@gmail.com', role: 'master' },
  treasury: { uid: 'te1', email: 'socorro@marquesemuller.adv.br', role: 'tesouraria' },
  director: { uid: 'di1', email: 'flavio.marques@marquesemuller.adv.br', role: 'diretor' },
  operator: { uid: 'op1', email: 'operador.teste@example.test', role: 'operador' },
  suspended: { uid: 'su1', email: 'reinaldo@marquesemuller.adv.br', role: 'gerente' },
}

const asStorage = (user, verified = true) =>
  env.authenticatedContext(user.uid, { email: user.email, email_verified: verified }).storage(BUCKET)

const pdf = () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
const zip = () => new Uint8Array([80, 75, 3, 4])
const metadata = (user, path, verified = true) =>
  getMetadata(ref(asStorage(user, verified), path))
const upload = (user, path, bytes, contentType, verified = true) =>
  uploadBytes(ref(asStorage(user, verified), path), bytes, { contentType })
const denied = async (promise) => {
  await assert.rejects(promise, (error) =>
    error?.code === 'storage/unauthorized' || error?.code === 'storage/unknown',
    'Acesso indevido deve ser negado pelas regras de Storage')
}

async function seedUser(user, status = 'active') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', user.uid),
      { uid: user.uid, email: user.email, role: user.role, status, displayName: user.role })
  })
}

async function seedFile(path, bytes = pdf(), contentType = 'application/pdf') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(BUCKET), path), bytes, { contentType })
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: FIRESTORE_RULES, host: '127.0.0.1', port: 8080 },
    storage: { rules: STORAGE_RULES, host: '127.0.0.1', port: 9199 },
  })
})
after(async () => { await env?.cleanup() })

test.beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await Promise.all([
    seedUser(users.master),
    seedUser(users.treasury),
    seedUser(users.director),
    seedUser(users.operator),
    seedUser(users.suspended, 'suspended'),
  ])
})

test('conta oficial verificada e ativa pode ler e escrever extratos', async () => {
  const path = 'extratos-bancarios/2026-11/teste.ofx'
  await upload(users.treasury, path, zip(), 'application/octet-stream')
  const result = await metadata(users.treasury, path)
  assert.equal(result.fullPath, path)
})

test('conta oficial suspensa nao acessa extratos existentes nem grava', async () => {
  const path = 'extratos-bancarios/2026-11/protegido.ofx'
  await seedFile(path)
  await denied(metadata(users.suspended, path))
  await denied(upload(users.suspended, 'extratos-bancarios/2026-11/novo.ofx', zip(), 'application/octet-stream'))
})

test('e-mail oficial nao verificado nao acessa extratos, ainda que ativo', async () => {
  const path = 'extratos-bancarios/2026-11/protegido.ofx'
  await seedFile(path)
  await denied(metadata(users.treasury, path, false))
  await denied(upload(users.treasury, 'extratos-bancarios/2026-11/novo.ofx', zip(), 'application/octet-stream', false))
})

test('operador ativo nao tem acesso aos extratos financeiros oficiais', async () => {
  const path = 'extratos-bancarios/2026-11/protegido.ofx'
  await seedFile(path)
  await denied(metadata(users.operator, path))
  await denied(upload(users.operator, 'extratos-bancarios/2026-11/novo.ofx', zip(), 'application/octet-stream'))
})

test('diretor oficial ativo pode ler extratos mas nao enviar', async () => {
  const path = 'extratos-bancarios/2026-11/protegido.ofx'
  await seedFile(path)
  assert.equal((await metadata(users.director, path)).fullPath, path)
  await denied(upload(users.director, 'extratos-bancarios/2026-11/novo.ofx', zip(), 'application/octet-stream'))
})

test('operador ativo consegue escrever seu comprovante, nao o de outro usuario', async () => {
  const path = 'despesas/op1/recibo.pdf'
  await upload(users.operator, path, pdf(), 'application/pdf')
  assert.equal((await metadata(users.operator, path)).fullPath, path)
  await denied(upload(users.operator, 'despesas/te1/recibo.pdf', pdf(), 'application/pdf'))
})

test('conta suspensa nao le nem envia comprovante', async () => {
  const path = 'despesas/op1/recibo.pdf'
  await seedFile(path)
  await denied(metadata(users.suspended, path))
  await denied(upload(users.suspended, 'despesas/su1/recibo.pdf', pdf(), 'application/pdf'))
})

test('demonstrativos aceitam apenas PDFs e permanecem imutaveis', async () => {
  const path = 'demonstrativos/2026-11/teste.pdf'
  await upload(users.operator, path, pdf(), 'application/pdf')
  assert.equal((await metadata(users.operator, path)).fullPath, path)
  await denied(upload(users.operator, 'demonstrativos/2026-11/teste.txt', pdf(), 'text/plain'))
  await denied(upload(users.operator, path, pdf(), 'application/pdf'))
  await denied(deleteObject(ref(asStorage(users.operator), path)))
})

test('usuario sem cadastro ou nao autenticado nao pode ler demonstrativos', async () => {
  const path = 'demonstrativos/2026-11/protegido.pdf'
  await seedFile(path)
  const unknown = { uid: 'no1', email: 'sem-cadastro@example.test' }
  await denied(metadata(unknown, path))
  await denied(getMetadata(ref(env.unauthenticatedContext().storage(BUCKET), path)))
})

test('conta master suspensa nao consegue acessar extratos', async () => {
  await seedUser(users.master, 'suspended')
  const path = 'extratos-bancarios/2026-11/protegido.ofx'
  await seedFile(path)
  await denied(metadata(users.master, path))
})
