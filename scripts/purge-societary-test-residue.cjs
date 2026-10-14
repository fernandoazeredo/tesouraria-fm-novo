'use strict'

// Manutenção pontual autorizada para resíduos societários de homologação.
// Abortamos SEM exclusões quando os dados não coincidem com o escopo informado.
const { initializeApp, applicationDefault } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

async function main() {
  if (process.env.ALLOW_TEST_RESIDUE_PURGE !== 'SOC-3-2-19000-7600-6000') {
    throw new Error('Confirmação de escopo não fornecida')
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: 'tesouraria-fm-novo',
    storageBucket: 'tesouraria-fm-novo.firebasestorage.app',
  })
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const snapshot = await db.collection('societaryTransfers').get()
  const rows = snapshot.docs.map((snap) => ({ id: snap.id, data: snap.data() }))
  const cents = (v) => Math.round((Number(v) || 0) * 100)
  const sum = (field) => rows.reduce((n, row) => n + cents(row.data[field]), 0)
  const paid = rows.filter((row) => row.data.status === 'pago')
  const unpaid = rows.filter((row) => row.data.status !== 'pago')
  const transfer = sum('transferValue')
  const fees = sum('officeFees')
  const paidTotal = sum('paidValue')
  const allMatches = rows.length === 3
    && paid.length === 2
    && unpaid.length === 1
    && fees === 1900000
    && transfer === 760000
    && paidTotal === 600000
    && transfer - paidTotal === 160000
    && paid.map((row) => cents(row.data.paidValue)).sort((a,b) => a-b).join(',') === '200000,400000'
    && cents(unpaid[0].data.transferValue) === 160000
  if (!allMatches) {
    console.log('PRECHECK: escopo não confere. Registros:', rows.length,
      'pagos:', paid.length, 'totais em centavos:', { fees, transfer, paidTotal })
    throw new Error('Divergência: nenhum registro ou arquivo foi removido')
  }
  const objects = paid.map((row) => {
    const path = String(row.data.demonstrativePath || row.data.demonstrative?.path || '')
    const expected = 'demonstrativos/repasses-societarios/' + row.id + '/v3/demonstrativo.pdf'
    if (path !== expected) throw new Error('Caminho do demonstrativo não corresponde ao registro societário')
    return path
  })
  if (objects.length !== 2 || new Set(objects).size !== 2) {
    throw new Error('Escopo de dois PDFs não confirmado')
  }
  for (const path of objects) {
    const [exists] = await bucket.file(path).exists()
    if (!exists) throw new Error('PDF societário esperado não encontrado no Storage; nenhuma exclusão executada')
  }
  console.log('PRECHECK: exatos três registros de teste e dois PDFs confirmados. Removendo somente este escopo.')
  let objectsDeleted = 0
  for (const path of objects) {
    await bucket.file(path).delete()
    objectsDeleted++
  }
  const batch = db.batch()
  rows.forEach((row) => batch.delete(db.collection('societaryTransfers').doc(row.id)))
  await batch.commit()
  await db.collection('auditLogs').add({
    action: 'Exclusão pontual de resíduos societários',
    module: 'Utilitários',
    status: 'concluida',
    detail: '3 registros societários de teste; 2 demonstrativos PDF; operação restrita por verificações de quantidade e valores.',
    counts: { societaryTransfers: 3 },
    removedFiles: objectsDeleted,
    executedBy: 'GitHub Actions / Firebase Admin service account',
    requestedBy: 'Administrador Master — autorização expressa em 2026-10-14',
    source: 'workflow de manutenção autorizado',
    workflowRun: process.env.GITHUB_RUN_ID || '',
    commitSha: process.env.GITHUB_SHA || '',
    createdAt: FieldValue.serverTimestamp(),
  })
  const after = await db.collection('societaryTransfers').get()
  if (!after.empty) throw new Error('Verificação posterior: ainda existem registros societários')
  for (const path of objects) {
    const [exists] = await bucket.file(path).exists()
    if (exists) throw new Error('Verificação posterior: ainda existe PDF societário')
  }
  console.log('CONFIRMADO: 3 documentos Firestore e 2 PDFs removidos. Auditoria da manutenção registrada.')
}
main().catch((err) => { console.error('MANUTENÇÃO NÃO CONCLUÍDA:', err.message); process.exit(1) })
