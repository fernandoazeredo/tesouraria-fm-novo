// Regras da Conferência de Entradas (bankCredits + receita prevista -> recebida direto) no Firestore Emulator.
import test, { after, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import assert from 'node:assert/strict'
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
let env
const u = {
  master: { uid: 'ma1', email: 'fernandoazeredo64@gmail.com', role: 'master', verified: true },
  juridico: { uid: 'op1', email: 'juridico.teste@example.test', role: 'operador' },
  outro: { uid: 'op2', email: 'outro.teste@example.test', role: 'operador' },
  tesouraria: { uid: 'te1', email: 'tesouraria.teste@example.test', role: 'tesouraria' },
}
const dbAs = (x) => env.authenticatedContext(x.uid, { email: x.email, email_verified: !!x.verified }).firestore()
const credit = { date: '2026-11-24', amount: 22000, memo: 'TED RECEBIDA', name: '', fitId: '1', refNum: '', importedBy: 'ma1', importedByName: 'Fernando', matchedReceivableId: null }
const prevista = { status: 'enviado_tesouraria', valorAlvara: 22000, processo: 'TESTE-1', reclamante: 'CLIENTE FICTÍCIO', createdBy: 'op2', createdAt: 'x', baseCalculo: 22000, dataPrevista: '2026-11-25' }

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-tesouraria-fm', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } }) })
after(async () => { await env?.cleanup() })
test.beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const x of Object.values(u)) await setDoc(doc(db, 'users', x.uid), { uid: x.uid, email: x.email, role: x.role, status: 'active' })
    await setDoc(doc(db, 'userPermissions', 'op1'), { schemaVersion: 1, modules: { conferencia_entradas: { ver: true } } })
    await setDoc(doc(db, 'bankCredits', 'c1'), credit)
    await setDoc(doc(db, 'bankCredits', 'c2'), { ...credit, amount: 500 })
    await setDoc(doc(db, 'receivables', 'r1'), prevista)
    await setDoc(doc(db, 'receivables', 'r2'), { ...prevista, processo: 'TESTE-2' })
    await setDoc(doc(db, 'receivables', 'r3'), { ...prevista, status: 'rascunho' })
  })
})

const confirmBatch = (db, rid, cid, date = '2026-11-24', by = 'op1') => {
  const b = writeBatch(db)
  b.update(doc(db, 'receivables', rid), { status: 'recebido_tesouraria', bankCreditId: cid, receiptDate: date, updatedAt: serverTimestamp(), bankConfirmedBy: by, bankConfirmedByName: 'Teste', bankConfirmedAt: serverTimestamp() })
  b.update(doc(db, 'bankCredits', cid), { matchedReceivableId: rid, matchedAt: serverTimestamp(), matchedBy: by, matchedByName: 'Teste' })
  return b.commit()
}

test('leitura: jurídico liberado lê créditos; operador sem liberação não lê', async () => {
  await assertSucceeds(getDoc(doc(dbAs(u.juridico), 'bankCredits', 'c1')))
  await assertFails(getDoc(doc(dbAs(u.outro), 'bankCredits', 'c1')))
})

test('carga do extrato: master e tesouraria criam; jurídico não', async () => {
  await assertSucceeds(setDoc(doc(dbAs(u.master), 'bankCredits', 'n1'), { ...credit, importedBy: 'ma1' }))
  await assertSucceeds(setDoc(doc(dbAs(u.tesouraria), 'bankCredits', 'n2'), { ...credit, importedBy: 'te1' }))
  await assertFails(setDoc(doc(dbAs(u.juridico), 'bankCredits', 'n3'), { ...credit, importedBy: 'op1' }))
  await assertFails(setDoc(doc(dbAs(u.master), 'bankCredits', 'n4'), { ...credit, importedBy: 'ma1', amount: -10 }))
})

test('jurídico liberado confirma receita prevista com crédito de mesmo valor e data', async () => {
  await assertSucceeds(confirmBatch(dbAs(u.juridico), 'r1', 'c1'))
})

test('o mesmo crédito não serve para duas receitas', async () => {
  await assertSucceeds(confirmBatch(dbAs(u.juridico), 'r1', 'c1'))
  await assertFails(confirmBatch(dbAs(u.juridico), 'r2', 'c1'))
})

test('bloqueia valor diferente, data diferente, rascunho e quem não tem liberação', async () => {
  await assertFails(confirmBatch(dbAs(u.juridico), 'r1', 'c2'))
  await assertFails(confirmBatch(dbAs(u.juridico), 'r1', 'c1', '2026-11-25'))
  await assertFails(confirmBatch(dbAs(u.juridico), 'r3', 'c1'))
  await assertFails(confirmBatch(dbAs(u.outro), 'r1', 'c1', '2026-11-24', 'op2'))
})

test('não dá para mudar a receita sem vincular o crédito, nem alterar o valor', async () => {
  const db = dbAs(u.juridico)
  await assertFails(updateDoc(doc(db, 'receivables', 'r1'), { status: 'recebido_tesouraria', bankCreditId: 'c1', receiptDate: '2026-11-24', bankConfirmedBy: 'op1' }))
  const b = writeBatch(db)
  b.update(doc(db, 'receivables', 'r1'), { status: 'recebido_tesouraria', bankCreditId: 'c1', receiptDate: '2026-11-24', bankConfirmedBy: 'op1', valorAlvara: 1 })
  b.update(doc(db, 'bankCredits', 'c1'), { matchedReceivableId: 'r1', matchedBy: 'op1' })
  await assertFails(b.commit())
})

test('extrato vigente: só master/tesouraria gravam o "current"; apagar só entradas não vinculadas', async () => {
  const meta = (uid) => ({ fileName: 'extrato.ofx', uploadedAt: serverTimestamp(), uploadedBy: uid, uploadedByName: 'X', creditIds: ['c1'], count: 1, total: 22000, periodStart: '2026-11-24', periodEnd: '2026-11-24' })
  await assertSucceeds(setDoc(doc(dbAs(u.tesouraria), 'bankCreditImports', 'current'), meta('te1')))
  await assertFails(setDoc(doc(dbAs(u.juridico), 'bankCreditImports', 'current'), meta('op1')))
  await assertFails(setDoc(doc(dbAs(u.master), 'bankCreditImports', 'outro'), meta('ma1')))
  await assertSucceeds(getDoc(doc(dbAs(u.juridico), 'bankCreditImports', 'current')))
  await assertSucceeds(confirmBatch(dbAs(u.juridico), 'r1', 'c1'))
  await assertFails(deleteDoc(doc(dbAs(u.tesouraria), 'bankCredits', 'c1')))
  await assertSucceeds(deleteDoc(doc(dbAs(u.tesouraria), 'bankCredits', 'c2')))
  await assertFails(deleteDoc(doc(dbAs(u.juridico), 'bankCredits', 'c2')))
})

test('fluxo completo de uma receita fictícia: rascunho → prevista → extrato → recebida → encerrada', async () => {
  const { movements } = await import('../../src/lib/cashFlowMovements.ts')
  const { creditsFromOfx, confirmableReceivables, suggestCredits } = await import('../../src/lib/incomingCredits.ts')
  const { parseOfx } = await import('../../src/lib/ofx.ts')
  const op = dbAs(u.juridico)
  const read = async () => { let data; await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), 'receivables', 'fic'))).data() }); return data }
  const stage = async () => movements([{ id: 'fic', ...(await read()) }], [], [], [], []).map((m) => m.stage)
  // 1) Jurídico lança como rascunho: fora do caixa
  await assertSucceeds(setDoc(doc(op, 'receivables', 'fic'), { status: 'rascunho', valorAlvara: 12345.67, processo: 'FICTICIO-0001', reclamante: 'CLIENTE FICTÍCIO', dataPrevista: '2026-11-26', createdBy: 'op1', createdAt: serverTimestamp(), baseCalculo: 12345.67 }))
  assert.deepEqual(await stage(), [])
  // 2) Envia (Prevista): entra como previsto
  await assertSucceeds(updateDoc(doc(op, 'receivables', 'fic'), { status: 'enviado_tesouraria' }))
  assert.deepEqual(await stage(), ['previsto'])
  // 3) Fernando sobe o OFX: só a entrada é gravada
  const ofx = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261126<TRNAMT>12345.67<FITID>FIC1<MEMO>TED RECEBIDA ALVARA</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261126<TRNAMT>-500.00<FITID>FIC2<MEMO>TARIFA</STMTTRN><STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261126<TRNAMT>9000<FITID>FIC3<MEMO>SALDO DO DIA</STMTTRN></BANKTRANLIST></OFX>'
  const credits = creditsFromOfx(parseOfx(ofx))
  assert.equal(credits.length, 1)
  const ma = dbAs(u.master)
  for (const { id, ...c } of credits) await assertSucceeds(setDoc(doc(ma, 'bankCredits', id), { ...c, importedBy: 'ma1', importedByName: 'Fernando', importedAt: serverTimestamp(), matchedReceivableId: null }))
  // 4) Tela sugere o crédito certo e o jurídico confirma
  const rec = { id: 'fic', ...(await read()) }
  assert.deepEqual(confirmableReceivables([rec]).map((r) => r.id), ['fic'])
  const [best] = suggestCredits(rec, credits)
  assert.equal(best.amount, 12345.67)
  await assertSucceeds(confirmBatch(op, 'fic', best.id, best.date))
  const after = await read()
  assert.equal(after.status, 'recebido_tesouraria'); assert.equal(after.receiptDate, '2026-11-26'); assert.equal(after.bankCreditId, best.id)
  assert.deepEqual(await stage(), ['realizado'])
  // 5) Não dá para confirmar de novo nem reaproveitar o crédito
  assert.deepEqual(confirmableReceivables([{ id: 'fic', ...after }]), [])
  // 6) Tesouraria encerra
  await assertSucceeds(updateDoc(doc(dbAs(u.tesouraria), 'receivables', 'fic'), { status: 'encerrado' }))
  assert.deepEqual(await stage(), ['realizado'])
})

test('Master desvincula: crédito volta livre e receita volta a Prevista; outros não', async () => {
  const { deleteField } = await import('firebase/firestore')
  await assertSucceeds(confirmBatch(dbAs(u.juridico), 'r1', 'c1'))
  const undo = (db) => { const b = writeBatch(db)
    b.update(doc(db, 'receivables', 'r1'), { status: 'enviado_tesouraria', bankCreditId: deleteField(), bankConfirmedBy: deleteField(), bankConfirmedByName: deleteField(), bankConfirmedAt: deleteField(), updatedAt: serverTimestamp() })
    b.update(doc(db, 'bankCredits', 'c1'), { matchedReceivableId: null, matchedAt: deleteField(), matchedBy: deleteField(), matchedByName: deleteField() })
    return b.commit() }
  await assertFails(undo(dbAs(u.juridico)))
  await assertFails(undo(dbAs(u.tesouraria)))
  await assertSucceeds(undo(dbAs(u.master)))
  await assertSucceeds(confirmBatch(dbAs(u.juridico), 'r2', 'c1'))
})

test('Tesouraria — Recebimentos: operador só confirma se o módulo Tesouraria foi liberado', async () => {
  await assertFails(updateDoc(doc(dbAs(u.juridico), 'receivables', 'r1'), { status: 'recebido_tesouraria' }))
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'userPermissions', 'op1'), { schemaVersion: 1, modules: { conferencia_entradas: { ver: true }, tesouraria: { ver: true } } }) })
  await assertSucceeds(updateDoc(doc(dbAs(u.juridico), 'receivables', 'r1'), { status: 'recebido_tesouraria' }))
  await assertFails(updateDoc(doc(dbAs(u.outro), 'receivables', 'r2'), { status: 'recebido_tesouraria' }))
})
