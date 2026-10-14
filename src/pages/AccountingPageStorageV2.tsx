import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Calculator, CheckCircle2, Download, FileSpreadsheet, Landmark, Paperclip, ReceiptText, Send, Upload } from 'lucide-react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { deleteObject, getBytes, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { createZip } from '../lib/simpleZip'
import { createXlsx, type XlsxSheet } from '../lib/simpleXlsx'
import { ensureOfficialDemonstrative } from '../lib/officialDemonstrative'
import { creditFolder, receivableForFinancialPlan } from '../lib/creditOperations'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTimeBR = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type AnyRecord = { id: string } & DocumentData
type BusyAction = '' | 'download' | 'send' | 'statement'
type Attachment = { name?: string; path?: string; url?: string; size?: number; type?: string }
type PackageIssue = { type: string; reference: string; value: number; reason: string }
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
  const societaryTransfers = useLiveCollection('societaryTransfers')
  const dispatches = useLiveCollection('accountingDispatches')
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
  const paidSocietary = useMemo(() => societaryTransfers.filter((item) => {
    if (item.status !== 'pago' || String(item.paymentDate || '').slice(0, 7) !== competence) return false
    const source = receivableForFinancialPlan(item, receivables)
    return unit === 'Todas' || String(source?.unidade || item.unidade || '') === unit
  }), [societaryTransfers, receivables, competence, unit])

  const includeExpenses = movement === 'Movimento completo' || movement === 'Somente Despesas'
  const includeReceivables = movement === 'Movimento completo' || movement === 'Somente Recebimentos'
  const includePayouts = movement === 'Movimento completo' || movement === 'Somente Repasses / Comissões'
  const selectedExpenses = includeExpenses ? approvedExpenses : []
  const selectedReceivables = includeReceivables ? finishedReceivables : []
  const selectedTransfers = includePayouts ? paidTransfers : []
  const selectedCommissions = includePayouts ? paidCommissions : []
  const selectedSocietary = includePayouts ? paidSocietary : []

  const expenseCount = selectedExpenses.length
  const receivableCount = selectedReceivables.length
  const transferCount = selectedTransfers.length
  const commissionCount = selectedCommissions.length
  const societaryCount = selectedSocietary.length
  const expenseTotal = selectedExpenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = selectedReceivables.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const transferTotal = selectedTransfers.reduce((sum, item) => sum + item.value, 0)
  const commissionTotal = selectedCommissions.reduce((sum, item) => sum + item.value, 0)
  const societaryTotal = selectedSocietary.reduce((sum, item) => sum + toNumber(item.paidValue || item.transferValue), 0)
  const totalEntries = expenseCount + receivableCount + transferCount + commissionCount + societaryCount
  const orderedDispatches = [...dispatches].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
  const statementId = `${competence}__${unit}`
  const statement = statements.find((item) => item.id === statementId) ?? null
  // Classificacoes e indicadores gerenciais permanecem apenas nos modulos internos.
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

  const debitFolder = (item: AnyRecord) => 'Debitos/' + safeName(String(item.competencia || competence)) + '_' + safeName(String(item.fornecedor || item.nome || 'fornecedor')) + '_' + safeName(item.id)
  const sourceOfPlan = (plan: AnyRecord) => receivableForFinancialPlan(plan, receivables)
  const creditFolderOfPlan = (plan: AnyRecord) => {
    const source = sourceOfPlan(plan)
    return creditFolder(source || { id: plan.id, processo: plan.processo || plan.sourceSnapshot?.processo, reclamante: plan.sourceSnapshot?.reclamante })
  }
  const accountingPath = (folder: string) => 'Contabilidade_' + competence + '/' + folder + '/'
  const operationFolderPaths = () => {
    const paths = new Map<string, string>()
    for (const item of selectedExpenses) paths.set('expense:' + item.id, accountingPath(debitFolder(item)))
    for (const item of selectedReceivables) paths.set('revenue:' + item.id, accountingPath(creditFolder(item)))
    for (const item of selectedTransfers) {
      const plan = transfers.find((r) => r.id === item.planId)
      if (plan) paths.set('transfer:' + plan.id, accountingPath(creditFolderOfPlan(plan)))
    }
    for (const item of selectedCommissions) {
      const plan = commissions.find((r) => r.id === item.planId)
      if (plan) paths.set('commission:' + plan.id, accountingPath(creditFolderOfPlan(plan)))
    }
    for (const item of selectedSocietary) paths.set('societary:' + item.id, accountingPath(creditFolderOfPlan(item)))
    return paths
  }

  function workbookSheets(packageIssues: PackageIssue[] = []): XlsxSheet[] {
    const pendingDemonstratives = packageIssues.filter((issue) => issue.reason.toLowerCase().includes('demonstrativo'))
    const paths = operationFolderPaths()
    const summaryRows = [
      ['FLÁVIO MARQUES ADVOGADOS ASSOCIADOS'],
      ['Movimento mensal para Contabilidade'],
      ['Competência', competence], ['Unidade', unit], ['Movimento', movement],
      ['Despesas aptas', expenseCount],
      ['Receitas aptas', receivableCount],
      ['Repasses de Alvarás pagos no mês', transferCount],
      ['Comissões de Agentes pagas no mês', commissionCount],
      ['Repasses Societários pagos no mês', societaryCount],
      ['Documentos anexados', documentCount], ['Lançamentos sem anexo', packageIssues.filter((issue) => issue.reason.toLowerCase().includes('comprovan')).length], ['Lançamentos sem demonstrativo', pendingDemonstratives.length], ['Extrato consolidado', statement?.fileName || 'NÃO ANEXADO (OPCIONAL)'],
      ['Gerado por', profile?.displayName || profile?.email || 'Usuário'], ['Gerado em', dateTimeBR.format(new Date())],
    ]
    const expenseRows: (string | number)[][] = [['Competência', 'Unidade', 'Responsável', 'Fornecedor/Favorecido', 'CPF/CNPJ', 'Status', 'Valor', 'Documentos', 'Demonstrativo', 'Pasta da Operação']]
    for (const item of selectedExpenses) {
      expenseRows.push([item.competencia ?? '', item.unidade ?? '', item.nome ?? '', item.fornecedor ?? '', item.documento ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorTotal), attachmentsOf(item).length, demonstrativeOf(item)?.path ?? '', paths.get('expense:' + item.id) || ''])
    }
    const revenueRows: (string | number)[][] = [['Data', 'Unidade', 'Processo', 'Reclamante', 'Reclamada', 'Origem', 'Status', 'Valor do Alvará', 'Líquido Cliente', 'Honorários Escritório', 'Comissão', 'Documentos', 'Demonstrativo', 'Pasta da Operação']]
    for (const item of selectedReceivables) {
      revenueRows.push([item.data ?? '', item.unidade ?? '', item.processo ?? '', item.reclamante ?? '', item.reclamada ?? '', item.origem ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorAlvara), toNumber(item.valorLiquidoCliente), revenueComponentValue(item, 'Honorários do Escritório'), revenueComponentValue(item, 'Outras Deduções / Participações'), attachmentsOf(item).length, demonstrativeOf(item)?.path ?? '', paths.get('revenue:' + item.id) || ''])
    }
    const transferRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Cliente / Beneficiário', 'Parcela', 'Valor', 'Natureza', 'Pasta da Operação']]
    selectedTransfers.forEach((item) => transferRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Repasse de valor de terceiro — não classificar como despesa operacional', paths.get('transfer:' + item.planId) || '']))
    const commissionRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Agente / Beneficiário', 'Parcela', 'Valor', 'Natureza', 'Pasta da Operação']]
    selectedCommissions.forEach((item) => commissionRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Comissão / participação vinculada ao Alvará', paths.get('commission:' + item.planId) || '']))
    const societaryRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Reclamante', 'Beneficiário', 'Valor Pago', 'Status', 'Pasta da Operação']]
    selectedSocietary.forEach((item) => {
      const source = sourceOfPlan(item)
      societaryRows.push([item.paymentDate ?? '', source?.unidade ?? item.unidade ?? '', item.processo ?? '', item.reclamante ?? source?.reclamante ?? '', item.beneficiary ?? '', toNumber(item.paidValue || item.transferValue), statusLabel(String(item.status)), paths.get('societary:' + item.id) || ''])
    })
    const documentRows: (string | number)[][] = [['Tipo', 'Referência', 'Arquivo', 'Tamanho (bytes)', 'Pasta da Operação']]
    selectedExpenses.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Despesa', `${item.nome ?? ''} · ${item.fornecedor ?? ''}`, file.name ?? 'Documento', toNumber(file.size), paths.get('expense:' + item.id) || ''])))
    selectedReceivables.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Receita', `${item.processo ?? ''} · ${item.reclamante ?? ''}`, file.name ?? 'Documento', toNumber(file.size), paths.get('revenue:' + item.id) || ''])))
    selectedTransfers.forEach((item) => {
      const plan = transfers.find((record) => record.id === item.planId)
      if (plan) attachmentsOf(plan).forEach((file) => documentRows.push(['Repasse de Alvará', `${item.process} · Parcela ${item.installment}`, file.name ?? 'Comprovante', toNumber(file.size), paths.get('transfer:' + item.planId) || '']))
    })
    selectedCommissions.forEach((item) => {
      const plan = commissions.find((record) => record.id === item.planId)
      if (plan) attachmentsOf(plan).forEach((file) => documentRows.push(['Comissão de Agente', `${item.process} · Parcela ${item.installment}`, file.name ?? 'Comprovante', toNumber(file.size), paths.get('commission:' + item.planId) || '']))
    })
    selectedSocietary.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Repasse Societário', String(item.processo || item.id), file.name ?? 'Comprovante', toNumber(file.size), paths.get('societary:' + item.id) || ''])))
    const operationRows: (string | number)[][] = [['Operação', 'Pasta da Operação']]
    for (const [key, folder] of paths) operationRows.push([key, folder])
    const pendingRows: (string | number)[][] = [['Tipo', 'Referência', 'Valor', 'Pendência']]
    packageIssues.forEach((issue) => pendingRows.push([issue.type, issue.reference, issue.value, issue.reason]))
    return [
      { name: 'Resumo', rows: summaryRows as (string | number)[][], currencyColumns: [1] },
      { name: 'Despesas', rows: expenseRows, currencyColumns: [6] },
      { name: 'Receitas', rows: revenueRows, currencyColumns: [7, 8, 9, 10] },
      { name: 'Repasses_Alvaras', rows: transferRows, currencyColumns: [5] },
      { name: 'Comissoes_Agentes', rows: commissionRows, currencyColumns: [5] },
      { name: 'Repasses_Societarios', rows: societaryRows, currencyColumns: [5] },
      { name: 'Documentos', rows: documentRows },
      { name: 'Operacoes', rows: operationRows },
      { name: 'Pendencias', rows: pendingRows, currencyColumns: [2] },
    ]
  }


  async function buildPackage() {
    if (totalEntries === 0) throw new Error('Nenhuma operação apta para os filtros selecionados.')
    setMessage('Agrupando documentos por operação e verificando arquivos...')
    const issues: PackageIssue[] = []
    const root = 'Contabilidade_' + competence + '/'
    const entries: Array<{ name: string; content: string | Uint8Array }> = []
    const addIssue = (type: string, reference: string, value: number, reason: string) => {
      issues.push({ type, reference, value, reason })
    }
    type CreditGroup = {
      folder: string
      source: AnyRecord | null
      transfers: Map<string, AnyRecord>
      commissions: Map<string, AnyRecord>
      societary: Map<string, AnyRecord>
      transferPayments: PaidMovement[]
      commissionPayments: PaidMovement[]
    }
    const credits = new Map<string, CreditGroup>()
    function groupFor(source: AnyRecord | null, plan: AnyRecord | null, kind: string): CreditGroup {
      const key = source ? 'receivable:' + source.id : kind + ':' + String(plan?.id || 'sem-id')
      let group = credits.get(key)
      if (!group) {
        const fallback: AnyRecord = source || {
          id: String(plan?.id || 'sem-id'),
          processo: plan?.processo || plan?.sourceSnapshot?.processo,
          reclamante: plan?.sourceSnapshot?.reclamante,
        }
        group = { folder: creditFolder(fallback), source, transfers: new Map(), commissions: new Map(), societary: new Map(), transferPayments: [], commissionPayments: [] }
        credits.set(key, group)
      }
      return group
    }
    for (const item of selectedReceivables) groupFor(item, null, 'revenue')
    for (const movement of selectedTransfers) {
      const plan = transfers.find((item) => item.id === movement.planId)
      if (!plan) {
        addIssue('Repasse de Alvará', movement.process, movement.value, 'Plano vinculado não encontrado')
        continue
      }
      const source = sourceOfPlan(plan)
      const group = groupFor(source, plan, 'alvara')
      if (!source) addIssue('Repasse de Alvará', movement.process, movement.value, 'Receita de origem não identificada de forma única; operação mantida separada')
      group.transfers.set(plan.id, plan)
      group.transferPayments.push(movement)
    }
    for (const movement of selectedCommissions) {
      const plan = commissions.find((item) => item.id === movement.planId)
      if (!plan) {
        addIssue('Comissão', movement.process, movement.value, 'Plano vinculado não encontrado')
        continue
      }
      const source = sourceOfPlan(plan)
      const group = groupFor(source, plan, 'comissao')
      if (!source) addIssue('Comissão', movement.process, movement.value, 'Receita de origem não identificada de forma única; operação mantida separada')
      group.commissions.set(plan.id, plan)
      group.commissionPayments.push(movement)
    }
    for (const plan of selectedSocietary) {
      const source = sourceOfPlan(plan)
      const group = groupFor(source, plan, 'societario')
      if (!source) addIssue('Repasse Societário', String(plan.processo || plan.id), toNumber(plan.paidValue || plan.transferValue), 'Receita de origem não identificada unicamente; operação mantida separada')
      group.societary.set(plan.id, plan)
    }
    // Todos os comprovantes de uma operação convivem no mesmo diretório.
    async function addProofs(
      record: AnyRecord, folder: string, label: string, reference: string, amount: number,
      seen: Set<string>, prefix: string,
    ) {
      const files = attachmentsOf(record)
      if (!files.length) {
        addIssue(label, reference, amount, prefix.startsWith('repasse_') ? 'Comprovante de pagamento ao cliente não anexado' : prefix.startsWith('comissao_') ? 'Comprovante de pagamento da comissão não anexado' : prefix.startsWith('repasse_societario') ? 'Comprovante de pagamento do repasse societário não anexado' : 'Sem comprovante/anexo registrado para ' + prefix)
        return
      }
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        const signature = String(file.path || file.url || prefix + ':' + i)
        if (seen.has(signature)) continue
        seen.add(signature)
        try {
          const content = await bytesFromAttachment(file)
          if (!content.byteLength) throw new Error('arquivo vazio')
          entries.push({ name: root + folder + '/comprovantes/' + (prefix.startsWith('repasse_societario') ? 'repasse_societario/' : '') + safeName(prefix) + '_' + String(i + 1).padStart(2, '0') + '_' + safeName(String(file.name || 'comprovante')), content })
        } catch (error) {
          addIssue(label, reference, amount, 'Comprovante ' + String(file.name || i + 1) + ' indisponível: ' + String(error))
        }
      }
    }
    async function addPdf(
      record: AnyRecord, kind: 'expense' | 'revenue' | 'alvaraTransfer' | 'commission' | 'societaryTransfer',
      folder: string, fileName: string, label: string, reference: string, amount: number, finalStatus: boolean,
    ) {
      if (!finalStatus) {
        addIssue(label, reference, amount, 'Pagamento ainda não finalizado: demonstrativo de baixa não aplicável')
        return
      }
      let pdf = demonstrativeOf(record)
      const requiredLayoutVersion = kind === 'expense' ? 4 : 3
      if (!pdf || Number(record.demonstrative?.layoutVersion ?? 0) < requiredLayoutVersion) {
        try {
          record.demonstrative = await ensureOfficialDemonstrative(kind, record, { generatedBy: profile?.uid ?? null })
          pdf = demonstrativeOf(record)
        } catch (error) {
          // Não exportar versão antiga de despesa com classificações internas.
          pdf = null
          addIssue(label, reference, amount, 'Falha ao gerar demonstrativo atualizado: ' + String(error))
        }
      }
      if (kind === 'expense' && Number(record.demonstrative?.layoutVersion ?? 0) < 4) pdf = null
      if (!pdf) {
        addIssue(label, reference, amount, 'Demonstrativo ausente')
        return
      }
      try {
        const content = await bytesFromAttachment(pdf)
        if (!content.byteLength) throw new Error('PDF vazio')
        entries.push({ name: root + folder + '/' + fileName, content })
      } catch (error) {
        addIssue(label, reference, amount, 'Falha ao incorporar demonstrativo: ' + String(error))
      }
    }
    for (const item of selectedExpenses) {
      const folder = debitFolder(item)
      const reference = String(item.fornecedor || item.nome || item.id)
      await addPdf(item, 'expense', folder, '01_demonstrativo_despesa.pdf', 'Despesa', reference, toNumber(item.valorTotal), ['pago', 'arquivado'].includes(String(item.status)))
      await addProofs(item, folder, 'Despesa', reference, toNumber(item.valorTotal), new Set<string>(), 'despesa')
    }
    for (const group of credits.values()) {
      const source = group.source
      const reference = String(source?.processo || group.transferPayments[0]?.process || group.commissionPayments[0]?.process || [...group.societary.values()][0]?.processo || group.folder)
      const seen = new Set<string>()
      if (source) {
        await addPdf(source, 'revenue', group.folder, '01_demonstrativo_receita.pdf', 'Receita', reference, toNumber(source.valorAlvara), ['recebido_tesouraria', 'encerrado'].includes(String(source.status)))
        await addProofs(source, group.folder, 'Receita', reference, toNumber(source.valorAlvara), seen, 'receita')
      }
      for (const plan of group.transfers.values()) {
        const movements = group.transferPayments.filter((movement) => movement.planId === plan.id)
        const amount = movements.reduce((sum, movement) => sum + movement.value, 0)
        const suffix = group.transfers.size > 1 ? '_' + safeName(plan.id) : ''
        const paid = Array.isArray(plan.installments) && plan.installments.some((item: DocumentData) => item?.paid === true)
        await addPdf(plan, 'alvaraTransfer', group.folder, '02_demonstrativo_repasse_cliente' + suffix + '.pdf', 'Repasse de Alvará', reference, amount, paid)
        await addProofs(plan, group.folder, 'Repasse de Alvará', reference, amount, seen, 'repasse_' + safeName(plan.id))
        // Registro de parcela paga não substitui o comprovante bancário.
      }
      for (const plan of group.commissions.values()) {
        const movements = group.commissionPayments.filter((movement) => movement.planId === plan.id)
        const amount = movements.reduce((sum, movement) => sum + movement.value, 0)
        const agent = safeName(String(plan.beneficiary || plan.sourceSnapshot?.agentName || 'agente'))
        const fileName = '03_demonstrativo_comissao_' + agent + (group.commissions.size > 1 ? '_' + safeName(plan.id) : '') + '.pdf'
        const paid = Array.isArray(plan.installments) && plan.installments.some((item: DocumentData) => item?.paid === true)
        await addPdf(plan, 'commission', group.folder, fileName, 'Comissão', reference, amount, paid)
        await addProofs(plan, group.folder, 'Comissão', reference, amount, seen, 'comissao_' + safeName(plan.id))
      }
      for (const plan of group.societary.values()) {
        const amount = toNumber(plan.paidValue || plan.transferValue)
        const suffix = group.societary.size > 1 ? '_' + safeName(plan.id) : ''
        await addPdf(plan, 'societaryTransfer', group.folder, '04_demonstrativo_repasse_societario' + suffix + '.pdf', 'Repasse Societário', reference, amount, String(plan.status) === 'pago')
        await addProofs(plan, group.folder, 'Repasse Societário', reference, amount, seen, 'repasse_societario_' + safeName(plan.id))
      }
    }
    if (statement?.storagePath) {
      try {
        const content = new Uint8Array(await getBytes(storageRef(storage, String(statement.storagePath))))
        if (!content.byteLength) throw new Error('extrato vazio')
        entries.push({ name: root + 'Extrato_Bancario/' + safeName(String(statement.fileName || 'Extrato_Consolidado')), content })
      } catch (error) {
        addIssue('Extrato bancário', competence, 0, 'Extrato anexado e indisponível: ' + String(error))
      }
    }
    const workbook = createXlsx(workbookSheets(issues))
    entries.unshift({ name: root + 'Movimento_Contabilidade.xlsx', content: workbook })
    if (issues.length) {
      const report = [
        'PACOTE CONTÁBIL — PENDÊNCIAS POR OPERAÇÃO',
        'Competência: ' + competence + ' | Unidade: ' + unit,
        ...issues.map((issue) => issue.type + ' | ' + issue.reference + ' | ' + money.format(issue.value) + ' | ' + issue.reason),
      ]
      entries.push({ name: root + 'Pendencias/RELATORIO_DE_PENDENCIAS.txt', content: report.join('\n') })
    }
    const bytes = createZip(entries)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return { blob: toBlob(bytes), fileName: 'Contabilidade_' + competence + '_' + safeName(unit) + '_' + stamp + '.zip', failures: issues.length }
  }

  async function downloadPackage() {
    setBusy('download'); setMessage('')
    try {
      const { blob, fileName, failures } = await buildPackage()
      downloadBlob(blob, fileName)
      await audit(failures ? 'Pacote da Contabilidade com pendências baixado' : 'Pacote completo da Contabilidade baixado', `${competence} · ${unit} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões) · ${societaryCount} repasse(s) societário(s) · extrato ${statement ? 'anexado' : 'não anexado'}`)
      setMessage(failures ? `ZIP gerado com ${failures} falha(s): consulte Contabilidade_${competence}/Pendencias/RELATORIO_DE_PENDENCIAS.txt. Pacote incompleto.` : `ZIP completo gerado: ${fileName}${statement ? '' : ' (sem extrato bancário)'}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o ZIP.') } finally { setBusy('') }
  }

  async function sendMovement() {
    if (totalEntries === 0) { setMessage('Nenhum lançamento apto foi encontrado.'); return }
    if (!window.confirm(`Registrar o movimento ${competence} como enviado à Contabilidade?`)) return
    setBusy('send'); setMessage('')
    try {
      const ref = await addDoc(collection(db, 'accountingDispatches'), { competence, unit, movement, expenseCount, receivableCount, transferCount, commissionCount, societaryCount, expenseTotal, revenueTotal, transferTotal, commissionTotal, societaryTotal, documentCount, bankStatement: statement?.fileName ?? null, status: 'enviado', sentBy: profile?.uid, sentByName: profile?.displayName, sentByEmail: profile?.email, createdAt: serverTimestamp() })
      await audit('Movimento registrado como enviado à Contabilidade', `${competence} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões) · ${societaryCount} repasse(s) societário(s)`, ref.id)
      setMessage('Movimento registrado com sucesso no histórico.')
    } catch (error) { console.error(error); setMessage('Não foi possível registrar o envio.') } finally { setBusy('') }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Fechamento mensal</span><h1>Contabilidade</h1><p>Pacote mensal por competência real: receitas no mês do recebimento e repasses, comissões e repasses societários no mês do pagamento efetivo.</p></div></div>
    <section className="page-card accounting-panel">
      <div className="accounting-config"><label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label><label><span>Unidade</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option>Todas</option><option>RJ</option><option>SP</option></select></label><label><span>Movimento</span><select value={movement} onChange={(e) => setMovement(e.target.value)}><option>Movimento completo</option><option>Somente Despesas</option><option>Somente Recebimentos</option><option>Somente Repasses / Comissões</option></select></label></div>
      <div className="readiness-grid accounting-six"><article><ReceiptText /><span>Despesas aptas</span><strong>{expenseCount}</strong><small>{money.format(expenseTotal)}</small></article><article><BadgeDollarSign /><span>Receitas aptas</span><strong>{receivableCount}</strong><small>{money.format(revenueTotal)}</small></article><article><Send /><span>Repasses pagos</span><strong>{transferCount}</strong><small>{money.format(transferTotal)}</small></article><article><Calculator /><span>Comissões pagas</span><strong>{commissionCount}</strong><small>{money.format(commissionTotal)}</small></article><article><Paperclip /><span>Documentos</span><strong>{documentCount}</strong><small>{missingAttachments.length} sem anexo · {missingDemonstratives.length} sem demonstrativo</small></article><article className={statement ? 'storage-ready-card' : ''}><Landmark /><span>Extrato bancário</span><strong>{statement ? 'Anexado' : 'Não anexado'}</strong><small>{statement?.fileName || 'Opcional para gerar o ZIP'}</small></article></div>
      <div className="bank-statement-box"><div><Landmark size={21} /><div><strong>Extrato consolidado do banco</strong><span>Opcional para gerar o pacote mensal. Se anexado, será incluído no ZIP. Aceita PDF, OFX, CSV e Excel.</span>{statement && <small><CheckCircle2 size={13} /> {statement.fileName}</small>}</div></div><label className="secondary-button accounting-file-button"><Upload size={17} /> {busy === 'statement' ? 'Enviando...' : statement ? 'Substituir extrato' : 'Anexar extrato'}<input type="file" hidden accept=".pdf,.ofx,.csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadStatement(file); e.currentTarget.value = '' }} /></label></div>
      <div className="storage-ready-box"><FileSpreadsheet size={18} /><span><strong>Pacote para a Contabilidade:</strong> Excel com Resumo, Despesas, Receitas, Repasses de Alvarás, Comissões de Agentes, Repasses Societários, Documentos, Operações e Pendências + comprovantes por operação. O extrato bancário é incluído somente quando estiver anexado.</span></div>
      <div className="accounting-feedback success"><strong>Regra contábil operacional:</strong> Repasse de Alvará é dinheiro de terceiro e não entra como despesa operacional/DRE. A saída aparece na competência da data efetiva de pagamento da parcela.</div>
      {message && <div className={`accounting-feedback ${message.includes('sucesso') || message.includes('gerado') || message.includes('anexado') ? 'success' : 'warning'}`} role="status">{message}</div>}
      <div className="accounting-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void downloadPackage()}><Download size={17} /> {busy === 'download' ? 'Montando ZIP...' : 'Baixar ZIP completo'}</button><button className="revenue-button" type="button" disabled={Boolean(busy)} onClick={() => void sendMovement()}><Calculator size={17} /> {busy === 'send' ? 'Registrando...' : 'Registrar envio à Contabilidade'}</button></div>
    </section>
    <section className="page-card accounting-history-card"><div className="card-title-row"><div><h2>Histórico de envios para a Contabilidade</h2><p>Cada confirmação fica registrada com competência, usuário e totais.</p></div><span className="status-badge revenue">{orderedDispatches.length} envio(s)</span></div>{orderedDispatches.length === 0 ? <div className="module-empty"><Send size={34} /><strong>Nenhum envio registrado</strong></div> : <div className="accounting-history-list">{orderedDispatches.map((item) => <article key={item.id}><div><strong>{item.competence || '—'} · {item.unit || 'Todas'}</strong><span>{item.movement || 'Movimento mensal'}</span><small>{item.sentByName || item.sentByEmail || 'Usuário'} · {timestampToDateTime(item.createdAt)}</small></div><div className="history-totals"><span>{toNumber(item.expenseCount)} despesa(s) · {money.format(toNumber(item.expenseTotal))}</span><span>{toNumber(item.receivableCount)} receita(s) · {money.format(toNumber(item.revenueTotal))}</span><span>{toNumber(item.transferCount)} repasse(s) · {money.format(toNumber(item.transferTotal))}</span><span>{toNumber(item.commissionCount)} comissão(ões) · {money.format(toNumber(item.commissionTotal))}</span></div><span className="status-badge success">Enviado</span></article>)}</div>}</section>
  </>
}
