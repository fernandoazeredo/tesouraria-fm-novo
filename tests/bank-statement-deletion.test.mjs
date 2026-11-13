import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Exercita a própria rotina de Storage isolada do React/Firebase.
// Não acessa serviços nem dados reais.
const source = readFileSync(new URL('../src/pages/BankReconciliationPage.tsx', import.meta.url), 'utf8')
const start = source.indexOf('async function deleteStorageTree(')
assert.ok(start >= 0, 'Rotina de exclusão encontrada')
const end = source.indexOf('\n}', start)
assert.ok(end > start, 'Fim da rotina encontrado')
const routine = source.slice(start, end + 2)
  .replace('path: string', 'path')
  .replaceAll('(error as { code?: string })?.code', 'error?.code')

function harness({ listings = {}, deletionError = null } = {}) {
  const visited = []
  const deleted = []
  const storageRef = (_storage, path) => ({ fullPath: path })
  async function listAll(root) {
    visited.push(root.fullPath)
    const value = listings[root.fullPath]
    if (value instanceof Error) throw value
    return value ?? { items: [], prefixes: [] }
  }
  async function deleteObject(item) {
    if (deletionError) throw deletionError
    deleted.push(item.fullPath)
  }
  const fn = runInNewContext(routine + '\n;deleteStorageTree', {
    storageRef, storage: {}, listAll, deleteObject,
  })
  return { fn, visited, deleted }
}

function storageError(code) {
  return Object.assign(new Error(code), { code })
}

test('Storage: prefixo sem arquivos termina sem erro', async () => {
  const h = harness()
  await h.fn('envios-contabilidade/2026-10')
  assert.deepEqual(h.visited, ['envios-contabilidade/2026-10'])
  assert.deepEqual(h.deleted, [])
})

test('Storage: object-not-found durante listagem é tolerado', async () => {
  const h = harness({ listings: { missing: storageError('storage/object-not-found') } })
  await h.fn('missing')
})

test('Storage: object-not-found durante exclusão é tolerado', async () => {
  const h = harness({
    listings: { root: { items: [{ fullPath: 'root/file' }], prefixes: [] } },
    deletionError: storageError('storage/object-not-found'),
  })
  await h.fn('root')
})

test('Storage: storage/unauthorized não é ignorado na listagem', async () => {
  const h = harness({ listings: { root: storageError('storage/unauthorized') } })
  await assert.rejects(h.fn('root'), /storage\/unauthorized/)
})

test('Storage: storage/unauthorized não é ignorado na exclusão', async () => {
  const h = harness({
    listings: { root: { items: [{ fullPath: 'root/file' }], prefixes: [] } },
    deletionError: storageError('storage/unauthorized'),
  })
  await assert.rejects(h.fn('root'), /storage\/unauthorized/)
})

test('Storage: limpeza recursiva visita subpastas e apaga arquivos', async () => {
  const h = harness({
    listings: {
      root: { items: [{ fullPath: 'root/a' }], prefixes: [{ fullPath: 'root/sub' }] },
      'root/sub': { items: [{ fullPath: 'root/sub/b' }], prefixes: [] },
    },
  })
  await h.fn('root')
  assert.deepEqual(h.visited, ['root', 'root/sub'])
  assert.deepEqual(h.deleted, ['root/a', 'root/sub/b'])
})

test('Auditoria: existe tratamento distinto para falha após remoção', () => {
  assert.match(source, /Exclusão concluída, mas auditoria falhou/)
  assert.match(source, /Falha parcial ao apagar extrato bancário/)
  assert.match(source, /Lote de movimentos confirmado:/)
  assert.match(source, /Lote de conciliações confirmado:/)
})
