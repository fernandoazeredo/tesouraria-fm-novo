import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Executa a função real da página em um ambiente com mocks, sem rede ou Firebase real.
const source = readFileSync(new URL('../src/pages/BankReconciliationPage.tsx', import.meta.url), 'utf8')
const start = source.indexOf('  async function deleteStatementCompletely() {')
const end = source.indexOf('\n  async function reconcile(', start)
assert.ok(start >= 0 && end > start, 'Função de exclusão deve existir')
const fragment = source.slice(start, end)
const js = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function exercise({ transactionCount = 2, failBatchAt = 0, failStorage = false, failAudit = false } = {}) {
  const calls = { batches: [], audit: [], storage: [], deletedDoc: [], messages: [], busy: [] }
  let batchNumber = 0
  const statementId = '2099-01__Todas'
  const transactions = Array.from({ length: transactionCount }, (_, i) => ({
    id: 'tx' + i,
    statementVersions: [statementId + '__v1'],
  }))
  const api = {
    profile: { uid: 'test' }, statement: { fileName: 'fake.ofx' }, isMaster: true,
    statementId, transactions, reconciliations: [], periods: [], competence: '2099-01',
    db: {}, window: { confirm: () => true },
    setStatementBusy: (v) => calls.busy.push(v),
    setMessage: (v) => calls.messages.push(v),
    writeBatch: () => {
      const number = ++batchNumber
      const changes = []
      return {
        delete: (ref) => changes.push(['delete', ref]),
        update: (ref) => changes.push(['update', ref]),
        commit: async () => {
          if (number === failBatchAt) throw new Error('simulated Firestore batch failure')
          calls.batches.push(changes)
        },
      }
    },
    doc: (_db, collection, id) => ({ collection, id }),
    deleteStorageTree: async (path) => {
      calls.storage.push(path)
      if (failStorage) throw new Error('simulated storage/unauthorized')
    },
    deleteDoc: async (ref) => calls.deletedDoc.push(ref),
    audit: async (name, detail, id) => {
      calls.audit.push({ name, detail, id })
      if (failAudit) throw new Error('simulated audit failure')
    },
    console: { error: () => {} },
    Set, Array, String, Error,
  }
  const run = runInNewContext(js + '\n;deleteStatementCompletely', api)
  return { calls, run }
}

test('Firestore: falha no segundo lote registra parcial com progresso exato', async () => {
  const h = exercise({ transactionCount: 351, failBatchAt: 2 })
  await h.run()
  assert.equal(h.calls.batches.length, 1)
  assert.equal(h.calls.audit.length, 1)
  assert.equal(h.calls.audit[0].name, 'Falha parcial ao apagar extrato bancário')
  assert.match(h.calls.audit[0].detail, /350\/351/)
  assert.match(h.calls.audit[0].detail, /simulated Firestore batch failure/)
  assert.equal(h.calls.deletedDoc.length, 0)
  assert.equal(h.calls.storage.length, 0)
  assert.match(h.calls.messages.at(-1), /Não foi possível apagar completamente/)
  assert.deepEqual(h.calls.busy, [true, false])
})

test('Storage: falha após commit impede remover documento e registra auditoria', async () => {
  const h = exercise({ failStorage: true })
  await h.run()
  assert.equal(h.calls.batches.length, 1)
  assert.equal(h.calls.deletedDoc.length, 0)
  assert.equal(h.calls.audit.length, 1)
  assert.equal(h.calls.audit[0].name, 'Falha parcial ao apagar extrato bancário')
  assert.match(h.calls.audit[0].detail, /simulated storage\/unauthorized/)
})

test('Auditoria: falha após exclusão não declara exclusão parcial', async () => {
  const h = exercise({ failAudit: true })
  await h.run()
  assert.equal(h.calls.deletedDoc.length, 1)
  assert.equal(h.calls.audit.length, 1)
  assert.equal(h.calls.audit[0].name, 'Extrato bancário apagado definitivamente')
  assert.match(h.calls.messages.at(-1), /A exclusão foi concluída, mas não foi possível registrar a Auditoria/)
  assert.deepEqual(h.calls.busy, [true, false])
})

test('Sucesso: registro final, armazenamento e auditoria são processados', async () => {
  const h = exercise()
  await h.run()
  assert.equal(h.calls.deletedDoc.length, 1)
  assert.equal(h.calls.storage.length, 2)
  assert.equal(h.calls.audit.length, 1)
  assert.equal(h.calls.audit[0].name, 'Extrato bancário apagado definitivamente')
  assert.match(h.calls.messages.at(-1), /Extrato apagado definitivamente/)
})
