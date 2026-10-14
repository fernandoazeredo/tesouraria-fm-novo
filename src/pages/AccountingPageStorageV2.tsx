import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Calculator, CheckCircle2, Download, FileSpreadsheet, Landmark, Paperclip, ReceiptText, Send, Upload } from 'lucide-react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { deleteObject, getBytes, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { createZip } from '../lib/simpleZip'
import { createXlsx, type XlsxSheet } from '../lib/simpleXlsx'
import { ensureOfficialDemonstrative } from '../lib/officialDemonstrative'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTimeBR = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type AnyRecord = { id: string } & DocumentData
type BusyAction = '' | 'download' | 'send' | 'statement'
type Attachment = { name?: string; path?: string; url?: string; size?: number; type?: string }
type PaidMovement = { planId: string; type: 'Repasse de Alvará' | 'Comissão de Agente'; process: string; beneficiary: string; unit: string; installment: number; paidDate: string; value: number; status: string }

function useLiveCollection(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))), [name])
  return records
}

function toNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function timestampToDateTime(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') return dateTimeBR.format((value as { toDate: () => Date }).toDate())
  return '—'
}
function safeName(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo' }
function toBlob(bytes: Uint8Array) { const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); return new Blob([buffer], { type: 'application/zip' }) }
function downloadBlob(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }
function attachmentsOf(item: AnyRecord): Attachment[] { return Array.isArray(item.attachments) ? item.attachments as Attachment[] : [] }
function demonstrativeOf(item: AnyRecord): Attachment | null {
  const d = item.demonstrative as Attachment | undefined
  if (d?.path || d?.url) return { name: d.name || 'demonstrativo.pdf', path: d.path, url: d.url, type: 'application/pdf' }
  if (item.demonstrativePath || item.demonstrativeUrl) return { name: 'demonstrativo.pdf', path: item.demonstrativePath, url: item.demonstrativeUrl, type: 'application/pdf' }
  return null
}
function revenueComponentValue(item: AnyRecord, name: string) {
  if (name === 'Honorários do Escritório' && toNumber(item.invoiceValue) > 0) return toNumber(item.invoiceValue)
  if (name === 'Outras Deduções / Participações' && toNumber(item.agentCommissionValue) > 0) return toNumber(item.agentCommissionValue)
  const components = Array.isArray(item.components) ? item.components : []
  return toNumber(components.find((row: DocumentData) => String(row?.nome || '') === name)?.valor)
}
function statusLabel(value: string) {
  const labels: Record<string, string> = { aprovado: 'Aprovado', pago: 'Pago', arquivado: 'Arquivado', recebido_tesouraria: 'Recebido pela Tesouraria', encerrado: 'Encerrado / Arquivado', parcialmente_pago: 'Parcialmente pago' }
  return labels[value] ?? value
}
function unitOfPlan(plan: AnyRecord) { return String(plan.sourceSnapshot?.unidade || plan.unidade || '') }
function paidMovements(plans: AnyRecord[], type: PaidMovement['type'], competence: string, unit: string): PaidMovement[] {
  const rows: PaidMovement[] = []
  for (const plan of plans) {
    const planUnit = unitOfPlan(plan)
    if (unit !== 'Todas' && planUnit !== unit) continue
    const installments = Array.isArray(plan.installments) ? plan.installments : []
    for (let index = 0; index < installments.length; index += 1) {
      const item = installments[index]
      const paidDate = String(item?.paidDate || '')
      if (!item?.paid || !paidDate || paidDate.slice(0, 7) !== competence) continue
      rows.push({
        planId: plan.id,
        type,
        process: String(plan.processo || plan.sourceSnapshot?.processo || ''),
        beneficiary: String(plan.beneficiary || (type === 'Repasse de Alvará' ? plan.sourceSnapshot?.titular || plan.sourceSnapshot?.reclamante || 'Cliente' : plan.sourceSnapshot?.agentName || 'Agente')),
        unit: planUnit,
        installment: toNumber(item?.number) || index + 1,
        paidDate,
        value: toNumber(item?.value),
        status: String(item?.status || 'paga'),
      })
    }
  }
  return rows.sort((a, b) => a.paidDate.localeCompare(b.paidDate) || a.process.localeCompare(b.process))
}

async function bytesFromAttachment(file: Attachment) {
  if (file.path) return new Uint8Array(await getBytes(storageRef(storage, file.path)))
  if (file.url) return new Uint8Array(await (await fetch(file.url)).arrayBuffer())
  throw new Error(`Documento sem referência de Storage: ${file.name || 'arquivo'}`)
}

export function AccountingPageStorageV2() {
  const { profile } = useAuth()
  const expenses = useLiveCollection('expenses')
  const receivables = useLiveCollection('receivables')
  const transfers = useLiveCollection('alvaraTransfers')
  const commissions = useLiveCollection('agentCommissions')
  const dispatches = useLiveCollection('accountingDispatches')
  const classifications = useLiveCollection('managerialClassifications')
  const statements = useLiveCollection('bankStatements')
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7))
  const [unit, setUnit] = useState('Todas')
  const [movement, setMovement] = useState('Movimento completo')
  const [busy, setBusy] = useState<BusyAction>('')
  const [message, setMessage] = useState('')

  const approvedExpenses = useMemo(() => expenses.filter((item) => ['aprovado', 'pago', 'arquivado'].includes(String(item.status)) && item.competencia === competence && (unit === 'Todas' || item.unidade === unit)), [expenses, competence, unit])
  const finishedReceivables = useMemo(() => receivables.filter((item) => ['recebido_tesouraria', 'encerrado'].includes(String(item.status)) && String(item.data ?? '').slice(0, 7) === competence && (unit === 'Todas' || item.unidade === unit)), [receivables, competence, unit])
  const paidTransfers = useMemo(() => paidMovements(transfers, 'Repasse de Alvará', competence, unit), [transfers, competence, unit])
  const paidCommissions = useMemo(() => paidMovements(commissions, 'Comissão de Agente', competence, unit), [commissions, competence, unit])

  const includeExpenses = movement === 'Movimento completo' || movement === 'Somente Despesas'
  const includeReceivables = movement === 'Movimento completo' || movement === 'Somente Recebimentos'
  const includePayouts = movement === 'Movimento completo' || movement === 'Somente Repasses / Comissões'
  const selectedExpenses = includeExpenses ? approvedExpenses : []
  const selectedReceivables = includeReceivables ? finishedReceivables : []
  const selectedTransfers = includePayouts ? paidTransfers : []
  const selectedCommissions = includePayouts ? paidCommissions : []

  const expenseCount = selectedExpenses.length
  const receivableCount = selectedReceivables.length
  const transferCount = selectedTransfers.length
  const commissionCount = selectedCommissions.length
  const expenseTotal = selectedExpenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = selectedReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const transferTotal = selectedTransfers.reduce((sum, item) => sum + item.value, 0)
  const commissionTotal = selectedCommissions.reduce((sum, item) => sum + item.value, 0)
  const totalEntries = expenseCount + receivableCount + transferCount + commissionCount
  const orderedDispatches = [...dispatches].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
  const statementId = `${competence}__${unit}`
  const statement = statements.find((item) => item.id === statementId) ?? null
  const classificationMap = useMemo(() => new Map(classifications.map((item) => [item.id, item])), [classifications])
  const documentCount = [...selectedExpenses, ...selectedReceivables].reduce((sum, item) => sum + attachmentsOf(item).length + (demonstrativeOf(item) ? 1 : 0), 0)
  const missingAttachments = [...selectedExpenses.map((item) => ({ type: 'Despesa', item })), ...selectedReceivables.map((item) => ({ type: 'Receita', item }))].filter(({ item }) => attachmentsOf(item).length === 0)
  const missingDemonstratives = [...selectedExpenses.map((item) => ({ type: 'Despesa', item })), ...selectedReceivables.map((item) => ({ type: 'Receita', item }))].filter(({ item }) => !demonstrativeOf(item))
  // Reavaliar depois da geração, nunca utilizar o snapshot anterior ao ZIP.
  const currentMissingDemonstratives = () => [...selectedExpenses.map((item) => ({ type: 'Despesa', item })), ...selectedReceivables.map((item) => ({ type: 'Receita', item }))].filter(({ item }) => !demonstrativeOf(item))

  async function audit(action: string, detail: string, entityId?: string) {
    if (!profile) return
    await addDoc(collection(db, 'auditLogs'), { action, module: 'Contabilidade', detail, entityId: entityId ?? null, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() })
  }

  async function uploadStatement(file: File) {
    if (!profile || file.size > 30 * 1024 * 1024) { if (file.size > 30 * 1024 * 1024) setMessage('O extrato ultrapassa o limite de 30 MB.'); return }
    setBusy('statement'); setMessage('')
    try {
      if (statement?.storagePath) { try { await deleteObject(storageRef(storage, String(statement.storagePath))) } catch {} }
      const path = `extratos-bancarios/${competence}/${safeName(unit)}/${Date.now()}-${safeName(file.name)}`
      const target = storageRef(storage, path)
      await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' })
      const downloadUrl = await getDownloadURL(target)
      await setDoc(doc(db, 'bankStatements', statementId), { competence, unit, fileName: file.name, storagePath: path, downloadUrl, size: file.size, type: file.type || 'application/octet-stream', uploadedBy: profile.uid, uploadedByName: profile.displayName, uploadedByEmail: profile.email, uploadedAt: serverTimestamp() })
      await audit('Extrato bancário consolidado anexado', `${competence} · ${unit} · ${file.name}`, statementId)
      setMessage('Extrato consolidado anexado com sucesso. Ele será incluído automaticamente no ZIP da Contabilidade.')
    } catch (error) { console.error(error); setMessage('Não foi possível enviar o extrato consolidado.') } finally { setBusy('') }
  }

  function workbookSheets(): XlsxSheet[] {
    const pendingDemonstratives = currentMissingDemonstratives()
    const summaryRows = [
      ['FLÁVIO MARQUES ADVOGADOS ASSOCIADOS'],
      ['Movimento mensal para Contabilidade'],
      ['Competência', competence], ['Unidade', unit], ['Movimento', movement],
      ['Despesas aptas', expenseCount], ['Total despesas', expenseTotal],
      ['Receitas aptas', receivableCount], ['Total receitas', revenueTotal],
      ['Repasses de Alvarás pagos no mês', transferCount], ['Total repassado a clientes', transferTotal],
      ['Comissões de Agentes pagas no mês', commissionCount], ['Total de comissões pagas', commissionTotal],
      ['Documentos anexados', documentCount], ['Lançamentos sem anexo', missingAttachments.length], ['Lançamentos sem demonstrativo', pendingDemonstratives.length], ['Extrato consolidado', statement?.fileName || 'NÃO ANEXADO (OPCIONAL)'],
      ['Gerado por', profile?.displayName || profile?.email || 'Usuário'], ['Gerado em', dateTimeBR.format(new Date())],
    ]
    const expenseRows: (string | number)[][] = [['Competência', 'Unidade', 'Responsável', 'Fornecedor/Favorecido', 'CPF/CNPJ', 'Plano de Contas', 'Descrição da Conta', 'DRE', 'Status', 'Valor', 'Documentos', 'Demonstrativo']]
    for (const item of selectedExpenses) {
      const classification = classificationMap.get(`expense__${item.id}`)
      expenseRows.push([item.competencia ?? '', item.unidade ?? '', item.nome ?? '', item.fornecedor ?? '', item.documento ?? '', classification?.accountCode ?? item.expenseAccountCode ?? item.classificacaoContabil ?? '', classification?.accountName ?? item.expenseAccountName ?? '', classification?.accountDre ?? item.expenseAccountDre ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorTotal), attachmentsOf(item).length, demonstrativeOf(item)?.path ?? ''])
    }
    const revenueRows: (string | number)[][] = [['Data', 'Unidade', 'Processo', 'Reclamante', 'Reclamada', 'Origem', 'Plano de Contas', 'Descrição da Conta', 'DRE', 'Status', 'Valor do Alvará', 'Líquido Cliente', 'Honorários Escritório', 'Comissão', 'Documentos', 'Demonstrativo']]
    for (const item of selectedReceivables) {
      const classification = classificationMap.get(`revenue__${item.id}`)
      revenueRows.push([item.data ?? '', item.unidade ?? '', item.processo ?? '', item.reclamante ?? '', item.reclamada ?? '', item.origem ?? '', classification?.accountCode ?? item.revenueAccountCode ?? item.classificacaoContabil ?? '', classification?.accountName ?? item.revenueAccountName ?? '', classification?.accountDre ?? item.revenueAccountDre ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorAlvara), toNumber(item.valorLiquidoCliente), revenueComponentValue(item, 'Honorários do Escritório'), revenueComponentValue(item, 'Outras Deduções / Participações'), attachmentsOf(item).length, demonstrativeOf(item)?.path ?? ''])
    }
    const transferRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Cliente / Beneficiário', 'Parcela', 'Valor', 'Natureza']]
    selectedTransfers.forEach((item) => transferRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Repasse de valor de terceiro — não classificar como despesa operacional/DRE']))
    const commissionRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Agente / Beneficiário', 'Parcela', 'Valor', 'Natureza']]
    selectedCommissions.forEach((item) => commissionRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Comissão / participação vinculada ao Alvará']))
    const documentRows: (string | number)[][] = [['Tipo', 'Referência', 'Arquivo', 'Tamanho (bytes)']]
    selectedExpenses.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Despesa', `${item.nome ?? ''} · ${item.fornecedor ?? ''}`, file.name ?? 'Documento', toNumber(file.size)])))
    selectedReceivables.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Receita', `${item.processo ?? ''} · ${item.reclamante ?? ''}`, file.name ?? 'Documento', toNumber(file.size)])))
    const pendingRows: (string | number)[][] = [['Tipo', 'Referência', 'Valor', 'Pendência']]
    missingAttachments.forEach(({ type, item }) => pendingRows.push([type, type === 'Despesa' ? `${item.nome ?? ''} · ${item.fornecedor ?? ''}` : `${item.processo ?? ''} · ${item.reclamante ?? ''}`, type === 'Despesa' ? toNumber(item.valorTotal) : toNumber(item.valorAlvara), 'Sem documento anexado']))
    pendingDemonstratives.forEach(({ type, item }) => pendingRows.push([type, type === 'Despesa' ? `${item.nome ?? ''} · ${item.fornecedor ?? ''}` : `${item.processo ?? ''} · ${item.reclamante ?? ''}`, type === 'Despesa' ? toNumber(item.valorTotal) : toNumber(item.valorAlvara), 'Sem demonstrativo gerado']))
    if (!statement) pendingRows.push(['Extrato bancário', competence, 0, 'Extrato consolidado não anexado — opcional'])
    return [
      { name: 'Resumo', rows: summaryRows as (string | number)[][], currencyColumns: [1] },
      { name: 'Despesas', rows: expenseRows, currencyColumns: [9] },
      { name: 'Receitas', rows: revenueRows, currencyColumns: [10, 11, 12, 13] },
      { name: 'Repasses_Alvaras', rows: transferRows, currencyColumns: [5] },
      { name: 'Comissoes_Agentes', rows: commissionRows, currencyColumns: [5] },
      { name: 'Documentos', rows: documentRows },
      { name: 'Pendencias', rows: pendingRows, currencyColumns: [2] },
    ]
  }

  async function buildPackage() {
    if (totalEntries === 0) throw new Error('Nenhum lançamento apto foi encontrado para a competência e filtros selecionados.')
    setMessage('Montando planilha Excel e incorporando documentos ao ZIP...')
    const failures: string[] = []
    for (const item of selectedExpenses) if (!demonstrativeOf(item) && ['pago', 'arquivado'].includes(String(item.status))) {
      try { item.demonstrative = await ensureOfficialDemonstrative('expense', item, { generatedBy: profile?.uid ?? null }) } catch (error) { console.warn('Demonstrativo de despesa não gerado:', item.id, error); failures.push(`Demonstrativo despesa ${item.id}: ${String(error)}`) }
    }
    for (const item of selectedReceivables) if (!demonstrativeOf(item) && ['recebido_tesouraria', 'encerrado'].includes(String(item.status))) {
      try { item.demonstrative = await ensureOfficialDemonstrative('revenue', item, { generatedBy: profile?.uid ?? null }) } catch (error) { console.warn('Demonstrativo de receita não gerado:', item.id, error); failures.push(`Demonstrativo receita ${item.id}: ${String(error)}`) }
    }
    for (const plan of transfers.filter((item) => Array.isArray(item.installments) && item.installments.some((p: DocumentData) => p?.paid === true))) if (!demonstrativeOf(plan)) {
      try { plan.demonstrative = await ensureOfficialDemonstrative('alvaraTransfer', plan, { generatedBy: profile?.uid ?? null }) } catch (error) { console.warn('Demonstrativo de repasse não gerado:', plan.id, error); failures.push(`Demonstrativo repasse ${plan.id}: ${String(error)}`) }
    }
    for (const plan of commissions.filter((item) => Array.isArray(item.installments) && item.installments.some((p: DocumentData) => p?.paid === true))) if (!demonstrativeOf(plan)) {
      try { plan.demonstrative = await ensureOfficialDemonstrative('commission', plan, { generatedBy: profile?.uid ?? null }) } catch (error) { console.warn('Demonstrativo de comissão não gerado:', plan.id, error); failures.push(`Demonstrativo comissão ${plan.id}: ${String(error)}`) }
    }
    const workbook = createXlsx(workbookSheets())
    const entries: Array<{ name: string; content: string | Uint8Array }> = [{ name: `Movimento_Contabilidade_${competence}_${safeName(unit)}.xlsx`, content: workbook }]
    if (statement?.storagePath) {
      try {
        const statementBytes = new Uint8Array(await getBytes(storageRef(storage, String(statement.storagePath))))
        entries.push({ name: `Extrato_Bancario/${safeName(String(statement.fileName ?? 'Extrato_Consolidado'))}`, content: statementBytes })
      } catch (error) {
        console.warn('Extrato bancário não incluído no ZIP:', error)
      }
    }
    for (const item of selectedExpenses) {
      const folder = `Despesas/${safeName(String(item.competencia || 'sem-competencia'))}_${safeName(String(item.fornecedor || item.nome || 'favorecido'))}_${safeName(item.id)}`
      entries.push({ name: `${folder}/`, content: '' })
      const demo = demonstrativeOf(item)
      if (demo) try { entries.push({ name: `${folder}/demonstrativo.pdf`, content: await bytesFromAttachment(demo) }) } catch (error) { console.warn('Demonstrativo de despesa não incluído:', item.id, error); failures.push(`PDF despesa ${item.id}: ${String(error)}`) }
      for (const file of attachmentsOf(item)) try { entries.push({ name: `${folder}/${safeName(file.name || 'documento')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Documento de despesa não incluído:', file, error) }
    }
    for (const item of selectedReceivables) {
      const folder = `Receitas/${safeName(String(item.processo || 'sem-processo'))}_${safeName(String(item.reclamante || 'cliente'))}_${safeName(item.id)}`
      const demo = demonstrativeOf(item)
      if (demo) try { entries.push({ name: `${folder}/demonstrativo.pdf`, content: await bytesFromAttachment(demo) }) } catch (error) { console.warn('Demonstrativo de receita não incluído:', item.id, error); failures.push(`PDF receita ${item.id}: ${String(error)}`) }
      for (const file of attachmentsOf(item)) try { entries.push({ name: `${folder}/${safeName(file.name || 'documento')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Documento de receita não incluído:', file, error) }
    }
    for (const movement of selectedTransfers) {
      const plan = transfers.find((item) => item.id === movement.planId)
      if (!plan) continue
      const folder = `Repasses_Alvaras/${safeName(movement.process || 'sem-processo')}_${safeName(movement.beneficiary || 'cliente')}_parcela-${movement.installment}_${safeName(plan.id)}`
      entries.push({ name: `${folder}/`, content: '' })
      const demo = demonstrativeOf(plan)
      if (demo) try { entries.push({ name: `${folder}/demonstrativo.pdf`, content: await bytesFromAttachment(demo) }) } catch (error) { console.warn('Demonstrativo de repasse não incluído:', plan.id, error); failures.push(`PDF repasse ${plan.id}: ${String(error)}`) }
      for (const file of attachmentsOf(plan)) try { entries.push({ name: `${folder}/${safeName(file.name || 'comprovante')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Comprovante de repasse não incluído:', file, error) }
    }
    for (const movement of selectedCommissions) {
      const plan = commissions.find((item) => item.id === movement.planId)
      if (!plan) continue
      const folder = `Comissoes/${safeName(movement.process || 'sem-processo')}_${safeName(movement.beneficiary || 'agente')}_parcela-${movement.installment}_${safeName(plan.id)}`
      const demo = demonstrativeOf(plan)
      if (demo) try { entries.push({ name: `${folder}/demonstrativo.pdf`, content: await bytesFromAttachment(demo) }) } catch (error) { console.warn('Demonstrativo de comissão não incluído:', plan.id, error); failures.push(`PDF comissão ${plan.id}: ${String(error)}`) }
      for (const file of attachmentsOf(plan)) try { entries.push({ name: `${folder}/${safeName(file.name || 'comprovante')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Comprovante de comissão não incluído:', file, error) }
    }
    if (failures.length) entries.push({ name: 'PENDENCIAS_GERACAO_DOCUMENTOS.txt', content: ['ATENÇÃO: pacote incompleto. Os documentos abaixo não foram incluídos.', 'Verifique permissões do Firebase Storage e Firestore antes de enviar à Contabilidade.', ...failures].join('\n') })
    const bytes = createZip(entries)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return { blob: toBlob(bytes), fileName: `Contabilidade_${competence}_${safeName(unit)}_${stamp}.zip`, failures: failures.length }
  }

  async function downloadPackage() {
    setBusy('download'); setMessage('')
    try {
      const { blob, fileName, failures } = await buildPackage()
      downloadBlob(blob, fileName)
      await audit('Pacote completo da Contabilidade baixado', `${competence} · ${unit} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões) · extrato ${statement ? 'anexado' : 'não anexado'}`)
      setMessage(failures ? `ZIP gerado com ${failures} falha(s): consulte PENDENCIAS_GERACAO_DOCUMENTOS.txt. Pacote incompleto.` : `ZIP completo gerado: ${fileName}${statement ? '' : ' (sem extrato bancário)'}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o ZIP.') } finally { setBusy('') }
  }

  async function sendMovement() {
    if (totalEntries === 0) { setMessage('Nenhum lançamento apto foi encontrado.'); return }
    if (!window.confirm(`Registrar o movimento ${competence} como enviado à Contabilidade?`)) return
    setBusy('send'); setMessage('')
    try {
      const ref = await addDoc(collection(db, 'accountingDispatches'), { competence, unit, movement, expenseCount, receivableCount, transferCount, commissionCount, expenseTotal, revenueTotal, transferTotal, commissionTotal, documentCount, bankStatement: statement?.fileName ?? null, status: 'enviado', sentBy: profile?.uid, sentByName: profile?.displayName, sentByEmail: profile?.email, createdAt: serverTimestamp() })
      await audit('Movimento registrado como enviado à Contabilidade', `${competence} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões)`, ref.id)
      setMessage('Movimento registrado com sucesso no histórico.')
    } catch (error) { console.error(error); setMessage('Não foi possível registrar o envio.') } finally { setBusy('') }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Fechamento mensal</span><h1>Contabilidade</h1><p>Pacote mensal por competência real: receitas no mês do recebimento e repasses/comissões no mês do pagamento efetivo.</p></div></div>
    <section className="page-card accounting-panel">
      <div className="accounting-config"><label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label><label><span>Unidade</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option>Todas</option><option>RJ</option><option>SP</option></select></label><label><span>Movimento</span><select value={movement} onChange={(e) => setMovement(e.target.value)}><option>Movimento completo</option><option>Somente Despesas</option><option>Somente Recebimentos</option><option>Somente Repasses / Comissões</option></select></label></div>
      <div className="readiness-grid accounting-six"><article><ReceiptText /><span>Despesas aptas</span><strong>{expenseCount}</strong><small>{money.format(expenseTotal)}</small></article><article><BadgeDollarSign /><span>Receitas aptas</span><strong>{receivableCount}</strong><small>{money.format(revenueTotal)}</small></article><article><Send /><span>Repasses pagos</span><strong>{transferCount}</strong><small>{money.format(transferTotal)}</small></article><article><Calculator /><span>Comissões pagas</span><strong>{commissionCount}</strong><small>{money.format(commissionTotal)}</small></article><article><Paperclip /><span>Documentos</span><strong>{documentCount}</strong><small>{missingAttachments.length} sem anexo · {missingDemonstratives.length} sem demonstrativo</small></article><article className={statement ? 'storage-ready-card' : ''}><Landmark /><span>Extrato bancário</span><strong>{statement ? 'Anexado' : 'Não anexado'}</strong><small>{statement?.fileName || 'Opcional para gerar o ZIP'}</small></article></div>
      <div className="bank-statement-box"><div><Landmark size={21} /><div><strong>Extrato consolidado do banco</strong><span>Opcional para gerar o pacote mensal. Se anexado, será incluído no ZIP. Aceita PDF, OFX, CSV e Excel.</span>{statement && <small><CheckCircle2 size={13} /> {statement.fileName}</small>}</div></div><label className="secondary-button accounting-file-button"><Upload size={17} /> {busy === 'statement' ? 'Enviando...' : statement ? 'Substituir extrato' : 'Anexar extrato'}<input type="file" hidden accept=".pdf,.ofx,.csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadStatement(file); e.currentTarget.value = '' }} /></label></div>
      <div className="storage-ready-box"><FileSpreadsheet size={18} /><span><strong>Pacote para a Contabilidade:</strong> planilha Excel com Resumo, Despesas, Receitas, Repasses de Alvarás, Comissões de Agentes, Documentos e Pendências + anexos. O extrato bancário é incluído somente quando estiver anexado.</span></div>
      <div className="accounting-feedback success"><strong>Regra contábil operacional:</strong> Repasse de Alvará é dinheiro de terceiro e não entra como despesa operacional/DRE. A saída aparece na competência da data efetiva de pagamento da parcela.</div>
      {message && <div className={`accounting-feedback ${message.includes('sucesso') || message.includes('gerado') || message.includes('anexado') ? 'success' : 'warning'}`} role="status">{message}</div>}
      <div className="accounting-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void downloadPackage()}><Download size={17} /> {busy === 'download' ? 'Montando ZIP...' : 'Baixar ZIP completo'}</button><button className="revenue-button" type="button" disabled={Boolean(busy)} onClick={() => void sendMovement()}><Calculator size={17} /> {busy === 'send' ? 'Registrando...' : 'Registrar envio à Contabilidade'}</button></div>
    </section>
    <section className="page-card accounting-history-card"><div className="card-title-row"><div><h2>Histórico de envios para a Contabilidade</h2><p>Cada confirmação fica registrada com competência, usuário e totais.</p></div><span className="status-badge revenue">{orderedDispatches.length} envio(s)</span></div>{orderedDispatches.length === 0 ? <div className="module-empty"><Send size={34} /><strong>Nenhum envio registrado</strong></div> : <div className="accounting-history-list">{orderedDispatches.map((item) => <article key={item.id}><div><strong>{item.competence || '—'} · {item.unit || 'Todas'}</strong><span>{item.movement || 'Movimento mensal'}</span><small>{item.sentByName || item.sentByEmail || 'Usuário'} · {timestampToDateTime(item.createdAt)}</small></div><div className="history-totals"><span>{toNumber(item.expenseCount)} despesa(s) · {money.format(toNumber(item.expenseTotal))}</span><span>{toNumber(item.receivableCount)} receita(s) · {money.format(toNumber(item.revenueTotal))}</span><span>{toNumber(item.transferCount)} repasse(s) · {money.format(toNumber(item.transferTotal))}</span><span>{toNumber(item.commissionCount)} comissão(ões) · {money.format(toNumber(item.commissionTotal))}</span></div><span className="status-badge success">Enviado</span></article>)}</div>}</section>
  </>
}
