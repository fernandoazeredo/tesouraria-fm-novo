import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Calculator, CheckCircle2, Download, FileSpreadsheet, Landmark, Mail, Paperclip, ReceiptText, Send, Upload } from 'lucide-react'
import { addDoc, arrayUnion, collection, doc, onSnapshot, serverTimestamp, setDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import { getBytes, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { createZip } from '../lib/simpleZip'
import { createXlsx, type XlsxSheet } from '../lib/simpleXlsx'
import { parseOfx, readOfxFile } from '../lib/ofx'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTimeBR = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type AnyRecord = { id: string } & DocumentData
type BusyAction = '' | 'download' | 'send' | 'statement' | 'email'
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
function competenceLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return value
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const ACCOUNTING_EMAIL_TO = ['fiscal@contabilidadequality.com.br']
const ACCOUNTING_EMAIL_CC = ['socorro@marquesemuller.adv.br', 'fernandoazeredo64@gmail.com']

function gmailComposeUrl(to: string[], cc: string[], subject: string, body: string) {
  const enc = encodeURIComponent
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to.join(','))}&cc=${enc(cc.join(','))}&su=${enc(subject)}&body=${enc(body)}`
}

function mailtoComposeUrl(to: string[], cc: string[], subject: string, body: string) {
  const enc = encodeURIComponent
  return `mailto:${to.join(',')}?cc=${enc(cc.join(','))}&subject=${enc(subject)}&body=${enc(body)}`
}
function attachmentsOf(item: AnyRecord): Attachment[] { return Array.isArray(item.attachments) ? item.attachments as Attachment[] : [] }
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
  const statements = useLiveCollection('bankStatements')
  const bankTransactions = useLiveCollection('bankTransactions')
  const bankReconciliations = useLiveCollection('bankReconciliations')
  const reconciliationPeriods = useLiveCollection('bankReconciliationPeriods')
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
  const reconciliationPeriodId = `${competence}__itau`
  const reconciliationPeriod = reconciliationPeriods.find((item) => item.id === reconciliationPeriodId) ?? null
  const reconciliationClosed = reconciliationPeriod?.status === 'fechada'
  const activeStatementVersions = new Set(statements.map((item) => String(item.activeVersionId || '')).filter(Boolean))
  const monthBankTransactions = bankTransactions.filter((item) =>
    String(item.competence) === competence
    && String(item.bankAccountId || 'itau') === 'itau'
    && String(item.movementClass || 'conciliavel') === 'conciliavel'
    && Array.isArray(item.statementVersions)
    && item.statementVersions.some((version: unknown) => activeStatementVersions.has(String(version)))
  ).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  const activeTransactionIds = new Set(monthBankTransactions.map((item) => item.id))
  const monthReconciliations = bankReconciliations.filter((item) => String(item.competence) === competence && activeTransactionIds.has(String(item.bankTransactionId)))
  const reconciliationByTransaction = new Map(monthReconciliations.map((item) => [String(item.bankTransactionId), item]))
  const documentCount = [...selectedExpenses, ...selectedReceivables].reduce((sum, item) => sum + attachmentsOf(item).length, 0)
  const missingDocs = [...selectedExpenses.map((item) => ({ type: 'Despesa', item })), ...selectedReceivables.map((item) => ({ type: 'Receita', item }))].filter(({ item }) => attachmentsOf(item).length === 0)

  async function audit(action: string, detail: string, entityId?: string) {
    if (!profile) return
    await addDoc(collection(db, 'auditLogs'), { action, module: 'Contabilidade', detail, entityId: entityId ?? null, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() })
  }

  async function uploadStatement(file: File) {
    if (!profile || file.size > 30 * 1024 * 1024) { if (file.size > 30 * 1024 * 1024) setMessage('O extrato ultrapassa o limite de 30 MB.'); return }
    setBusy('statement'); setMessage('')
    try {
      const isOfx = /\.ofx$/i.test(file.name)
      const parsedOfx = isOfx ? parseOfx(await readOfxFile(file)) : null
      if (isOfx && !parsedOfx?.transactions.length) throw new Error('O arquivo OFX não contém movimentações bancárias reconhecíveis.')

      if (parsedOfx) {
        const affectedMonths = Array.from(new Set(parsedOfx.transactions.map((item) => item.date.slice(0, 7))))
        const previousCoveredMonths = Array.isArray(statement?.coveredMonths) ? statement.coveredMonths.map(String) : (statement ? [competence] : [])
        const monthsThatWillChange = Array.from(new Set([...affectedMonths, ...previousCoveredMonths]))
        const closedMonths = monthsThatWillChange.filter((month) => reconciliationPeriods.some((item) => item.id === `${month}__itau` && item.status === 'fechada'))
        if (closedMonths.length) {
          setMessage(`Não é possível substituir/importar o OFX porque a Conciliação Bancária está fechada em: ${closedMonths.join(', ')}. O Administrador Master deve reabrir a competência antes.`)
          return
        }
      }

      const path = `extratos-bancarios/${competence}/${safeName(unit)}/${Date.now()}-${safeName(file.name)}`
      const target = storageRef(storage, path)
      await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' })
      const downloadUrl = await getDownloadURL(target)
      let importedTransactionCount = 0
      let ofxBankId = ''
      let ofxAccountId = ''
      let activeVersionId: string | null = null
      let coveredMonths: string[] = []
      let discardedTransactionCount = 0
      let balanceCount = 0
      let automaticInvestmentCount = 0
      let reconcilableCount = 0
      if (parsedOfx) {
        const parsed = parsedOfx
        activeVersionId = `${statementId}__${Date.now()}__${safeName(file.name)}`
        coveredMonths = Array.from(new Set(parsed.transactions.map((item) => item.date.slice(0, 7))))
        discardedTransactionCount = parsed.discardedCount
        balanceCount = parsed.balanceCount
        automaticInvestmentCount = parsed.automaticInvestmentCount
        reconcilableCount = parsed.reconcilableCount

        const ops = parsed.transactions.map((transaction) => {
          const transactionCompetence = transaction.date.slice(0, 7)
          const reconciliationPeriodId = `${transactionCompetence}__itau`
          const transactionId = `itau__${transaction.identityKey}`
          return { transaction, transactionCompetence, reconciliationPeriodId, transactionId }
        })

        for (let start = 0; start < ops.length; start += 400) {
          const batch = writeBatch(db)
          ops.slice(start, start + 400).forEach(({ transaction, transactionCompetence, reconciliationPeriodId, transactionId }) => {
            batch.set(doc(db, 'bankTransactions', transactionId), {
              ...transaction,
              competence: transactionCompetence,
              reconciliationPeriodId,
              unit,
              bankAccountId: 'itau',
              bankId: parsed.bankId,
              branchId: parsed.branchId,
              accountId: parsed.accountId,
              currency: parsed.currency,
              statementVersions: arrayUnion(activeVersionId),
              lastStatementId: statementId,
              lastStatementStoragePath: path,
              lastImportedBy: profile.uid,
              lastImportedByName: profile.displayName,
              lastImportedByEmail: profile.email,
              lastImportedAt: serverTimestamp(),
            }, { merge: true })
          })
          await batch.commit()
        }

        importedTransactionCount = parsed.transactions.length
        ofxBankId = parsed.bankId
        ofxAccountId = parsed.accountId
      }

      // Este ponteiro só muda depois que TODAS as transações do novo OFX foram gravadas.
      // Se qualquer lote falhar, o extrato anterior continua sendo a versão ativa.
      await setDoc(doc(db, 'bankStatements', statementId), {
        competence, unit, fileName: file.name, storagePath: path, downloadUrl, size: file.size,
        type: file.type || 'application/octet-stream', bankAccountId: isOfx ? 'itau' : null,
        importedTransactionCount, discardedTransactionCount,
        balanceCount, automaticInvestmentCount, reconcilableCount,
        ofxBankId: ofxBankId || null, ofxAccountId: ofxAccountId || null,
        activeVersionId,
        coveredMonths,
        previousVersionId: statement?.activeVersionId || null,
        previousStoragePath: statement?.storagePath || null,
        uploadedBy: profile.uid, uploadedByName: profile.displayName, uploadedByEmail: profile.email, uploadedAt: serverTimestamp(),
      })
      await audit('Extrato bancário consolidado anexado', `${competence} · ${unit} · ${file.name}${importedTransactionCount ? ` · ${importedTransactionCount} movimentação(ões) OFX importada(s)` : ''}`, statementId)
      setMessage(importedTransactionCount
        ? `Extrato OFX anexado com sucesso. ${reconcilableCount} movimento(s) conciliável(is), ${balanceCount} linha(s) de saldo e ${automaticInvestmentCount} movimentação(ões) automática(s) de aplicação/resgate/rendimento foram identificados.${discardedTransactionCount ? ` Atenção: ${discardedTransactionCount} linha(s) inválida(s) foram ignoradas.` : ''}`
        : 'Extrato consolidado anexado com sucesso. Ele será incluído automaticamente no ZIP da Contabilidade.')
    } catch (error) { console.error(error); setMessage('Não foi possível enviar o extrato consolidado.') } finally { setBusy('') }
  }

  function workbookSheets(): XlsxSheet[] {
    const summaryRows = [
      ['FLÁVIO MARQUES ADVOGADOS ASSOCIADOS'],
      ['Movimento mensal para Contabilidade'],
      ['Competência', competence], ['Unidade', unit], ['Movimento', movement],
      ['Despesas aptas', expenseCount], ['Total despesas', expenseTotal],
      ['Receitas aptas', receivableCount], ['Total receitas', revenueTotal],
      ['Repasses de Alvarás pagos no mês', transferCount], ['Total repassado a clientes', transferTotal],
      ['Comissões de Agentes pagas no mês', commissionCount], ['Total de comissões pagas', commissionTotal],
      ['Documentos anexados', documentCount], ['Lançamentos sem documento', missingDocs.length], ['Extrato consolidado', statement?.fileName || 'NÃO ANEXADO (OPCIONAL)'], ['Conciliação Bancária', reconciliationClosed ? 'FECHADA' : 'NÃO FECHADA'], ['Movimentos bancários', monthBankTransactions.length], ['Movimentos conciliados', monthReconciliations.length],
      ['Gerado por', profile?.displayName || profile?.email || 'Usuário'], ['Gerado em', dateTimeBR.format(new Date())],
    ]
    const expenseRows: (string | number)[][] = [['Competência', 'Unidade', 'Responsável', 'Fornecedor/Favorecido', 'CPF/CNPJ', 'Plano de Contas', 'Descrição da Conta', 'DRE', 'Status', 'Valor', 'Documentos']]
    for (const item of selectedExpenses) expenseRows.push([item.competencia ?? '', item.unidade ?? '', item.nome ?? '', item.fornecedor ?? '', item.documento ?? '', item.expenseAccountCode ?? item.classificacaoContabil ?? '', item.expenseAccountName ?? '', item.expenseAccountDre ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorTotal), attachmentsOf(item).length])
    const revenueRows: (string | number)[][] = [['Data', 'Unidade', 'Processo', 'Reclamante', 'Reclamada', 'Origem', 'Plano de Contas', 'Descrição da Conta', 'DRE', 'Status', 'Valor do Alvará', 'Líquido Cliente', 'Documentos']]
    for (const item of selectedReceivables) revenueRows.push([item.data ?? '', item.unidade ?? '', item.processo ?? '', item.reclamante ?? '', item.reclamada ?? '', item.origem ?? '', item.revenueAccountCode ?? item.classificacaoContabil ?? '', item.revenueAccountName ?? '', item.revenueAccountDre ?? '', statusLabel(String(item.status ?? '')), toNumber(item.valorAlvara), toNumber(item.valorLiquidoCliente), attachmentsOf(item).length])
    const transferRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Cliente / Beneficiário', 'Parcela', 'Valor', 'Natureza']]
    selectedTransfers.forEach((item) => transferRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Repasse de valor de terceiro — não classificar como despesa operacional/DRE']))
    const commissionRows: (string | number)[][] = [['Data do Pagamento', 'Unidade', 'Processo', 'Agente / Beneficiário', 'Parcela', 'Valor', 'Natureza']]
    selectedCommissions.forEach((item) => commissionRows.push([item.paidDate, item.unit, item.process, item.beneficiary, item.installment, item.value, 'Comissão / participação vinculada ao Alvará']))
    const documentRows: (string | number)[][] = [['Tipo', 'Referência', 'Arquivo', 'Tamanho (bytes)']]
    selectedExpenses.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Despesa', `${item.nome ?? ''} · ${item.fornecedor ?? ''}`, file.name ?? 'Documento', toNumber(file.size)])))
    selectedReceivables.forEach((item) => attachmentsOf(item).forEach((file) => documentRows.push(['Receita', `${item.processo ?? ''} · ${item.reclamante ?? ''}`, file.name ?? 'Documento', toNumber(file.size)])))
    const pendingRows: (string | number)[][] = [['Tipo', 'Referência', 'Valor', 'Pendência']]
    missingDocs.forEach(({ type, item }) => pendingRows.push([type, type === 'Despesa' ? `${item.nome ?? ''} · ${item.fornecedor ?? ''}` : `${item.processo ?? ''} · ${item.reclamante ?? ''}`, type === 'Despesa' ? toNumber(item.valorTotal) : toNumber(item.valorAlvara), 'Sem documento anexado']))
    if (!statement) pendingRows.push(['Extrato bancário', competence, 0, 'Extrato consolidado não anexado — opcional'])
    const reconciliationRows: (string | number)[][] = [['Data', 'Histórico bancário', 'Valor', 'Status', 'Tipo no sistema', 'Data no sistema']]
    monthBankTransactions.forEach((transaction) => {
      const reconciliation = reconciliationByTransaction.get(transaction.id)
      reconciliationRows.push([
        transaction.date ?? '',
        transaction.memo || transaction.name || transaction.refNum || transaction.type || '',
        toNumber(transaction.amount),
        reconciliation ? 'Conciliado' : 'Pendente',
        reconciliation?.sourceType || '',
        reconciliation?.systemDate || '',
      ])
    })
    return [
      { name: 'Resumo', rows: summaryRows as (string | number)[][], currencyColumns: [1] },
      { name: 'Despesas', rows: expenseRows, currencyColumns: [9] },
      { name: 'Receitas', rows: revenueRows, currencyColumns: [10, 11] },
      { name: 'Repasses_Alvaras', rows: transferRows, currencyColumns: [5] },
      { name: 'Comissoes_Agentes', rows: commissionRows, currencyColumns: [5] },
      { name: 'Documentos', rows: documentRows },
      { name: 'Pendencias', rows: pendingRows, currencyColumns: [2] },
      { name: 'Conciliacao_Bancaria', rows: reconciliationRows, currencyColumns: [2] },
    ]
  }

  async function buildPackage() {
    if (totalEntries === 0) throw new Error('Nenhum lançamento apto foi encontrado para a competência e filtros selecionados.')
    setMessage('Montando planilha Excel e incorporando documentos ao ZIP...')
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
    for (let index = 0; index < selectedExpenses.length; index += 1) for (const file of attachmentsOf(selectedExpenses[index])) {
      try { entries.push({ name: `Documentos_Despesas/${String(index + 1).padStart(3, '0')}_${safeName(String(selectedExpenses[index].fornecedor || selectedExpenses[index].nome || selectedExpenses[index].id))}/${safeName(file.name || 'documento')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Documento de despesa não incluído:', file, error) }
    }
    for (let index = 0; index < selectedReceivables.length; index += 1) for (const file of attachmentsOf(selectedReceivables[index])) {
      try { entries.push({ name: `Documentos_Receitas/${String(index + 1).padStart(3, '0')}_${safeName(String(selectedReceivables[index].processo || selectedReceivables[index].reclamante || selectedReceivables[index].id))}/${safeName(file.name || 'documento')}`, content: await bytesFromAttachment(file) }) } catch (error) { console.warn('Documento de receita não incluído:', file, error) }
    }
    const bytes = createZip(entries)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return { blob: toBlob(bytes), fileName: `Contabilidade_${competence}_${safeName(unit)}_${stamp}.zip` }
  }

  async function downloadPackage() {
    setBusy('download'); setMessage('')
    try {
      const { blob, fileName } = await buildPackage()
      downloadBlob(blob, fileName)
      await audit('Pacote completo da Contabilidade baixado', `${competence} · ${unit} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões) · extrato ${statement ? 'anexado' : 'não anexado'}`)
      setMessage(`ZIP completo gerado: ${fileName}${statement ? '' : ' (sem extrato bancário)'}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o ZIP.') } finally { setBusy('') }
  }

  async function prepareAccountingEmail() {
    if (!profile) return
    if (totalEntries === 0) { setMessage('Nenhum lançamento apto foi encontrado.'); return }

    let reconciliationOverrideReason = ''
    if (!reconciliationClosed) {
      if (profile.role !== 'master') {
        setMessage('A Conciliação Bancária desta competência ainda não foi fechada. Finalize a conciliação antes de preparar o e-mail para a Contabilidade.')
        return
      }
      const reason = window.prompt('A Conciliação Bancária desta competência ainda não foi fechada. Como Administrador Master, informe a justificativa para preparar o e-mail excepcionalmente:')
      if (!reason?.trim()) return
      reconciliationOverrideReason = reason.trim()
    }

    const warning = statement ? '' : '\n\nATENÇÃO: o extrato bancário não está anexado e não será incluído no pacote.'
    if (!window.confirm(`Preparar o e-mail da competência ${competenceLabel(competence)} para fiscal@contabilidadequality.com.br?${warning}\n\nIsso NÃO registrará o envio como concluído.`)) return

    // Abre imediatamente para evitar bloqueio do navegador após os awaits.
    const popup = window.open('about:blank', '_blank')
    setBusy('email'); setMessage('Preparando o pacote para a Contabilidade...')
    try {
      const { blob, fileName } = await buildPackage()
      const packagePath = `envios-contabilidade/${competence}/${safeName(unit)}/${fileName}`
      const target = storageRef(storage, packagePath)
      await uploadBytes(target, blob, {
        contentType: 'application/zip',
        contentDisposition: `attachment; filename="${fileName}"`,
      })
      const downloadUrl = await getDownloadURL(target)

      const subject = `Movimento Contábil — ${competenceLabel(competence)} — FLÁVIO MARQUES ADVOGADOS ASSOCIADOS`
      const body = [
        'Prezados,',
        '',
        `Segue o movimento contábil referente à competência ${competenceLabel(competence)}.`,
        '',
        'O pacote contém a planilha de movimentação contábil, documentos de Despesas, documentos de Receitas, Repasses de Alvarás, Comissões de Agentes, Pendências e o Extrato Bancário, quando anexado.',
        '',
        'Pacote para download:',
        downloadUrl,
        '',
        'Atenciosamente,',
        'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',
      ].join('\n')

      await audit(
        'E-mail para a Contabilidade preparado',
        `${competence} · ${unit} · Para: ${ACCOUNTING_EMAIL_TO.join(', ')} · Cópia: ${ACCOUNTING_EMAIL_CC.join(', ')} · ${fileName}${reconciliationOverrideReason ? ` · Exceção Master: ${reconciliationOverrideReason}` : ''}`
      )

      const gmailUrl = gmailComposeUrl(ACCOUNTING_EMAIL_TO, ACCOUNTING_EMAIL_CC, subject, body)
      if (popup) popup.location.href = gmailUrl
      else window.location.href = mailtoComposeUrl(ACCOUNTING_EMAIL_TO, ACCOUNTING_EMAIL_CC, subject, body)

      setMessage('E-mail preparado. Confira a mensagem, envie no Gmail e depois use “Registrar envio à Contabilidade” para confirmar oficialmente o envio.')
    } catch (error) {
      popup?.close()
      console.error(error)
      setMessage(error instanceof Error ? error.message : 'Não foi possível preparar o e-mail para a Contabilidade.')
    } finally {
      setBusy('')
    }
  }

  async function sendMovement() {
    if (totalEntries === 0) { setMessage('Nenhum lançamento apto foi encontrado.'); return }
    let reconciliationOverride = false
    let reconciliationOverrideReason = ''

    if (!reconciliationClosed) {
      if (profile?.role !== 'master') {
        setMessage('A Conciliação Bancária desta competência ainda não foi fechada. Finalize a conciliação antes de registrar o envio à Contabilidade.')
        return
      }
      const reason = window.prompt('A Conciliação Bancária desta competência ainda não foi fechada. Como Administrador Master, informe a justificativa para liberar excepcionalmente o registro do envio:')
      if (!reason?.trim()) return
      reconciliationOverride = true
      reconciliationOverrideReason = reason.trim()
    }

    const previousDispatches = dispatches.filter((item) => String(item.competence) === competence && String(item.unit || 'Todas') === unit)
    const alreadySentWarning = previousDispatches.length
      ? `\n\nATENÇÃO: esta competência já possui ${previousDispatches.length} envio(s) registrado(s). Este registro será tratado como novo envio/reenvio.`
      : ''
    if (!window.confirm(`Registrar o movimento ${competence} como enviado à Contabilidade?${alreadySentWarning}`)) return

    setBusy('send'); setMessage('')
    try {
      const ref = await addDoc(collection(db, 'accountingDispatches'), {
        competence, unit, movement, expenseCount, receivableCount, transferCount, commissionCount,
        expenseTotal, revenueTotal, transferTotal, commissionTotal, documentCount,
        bankStatement: statement?.fileName ?? null,
        reconciliationStatus: reconciliationClosed ? 'fechada' : 'liberada_excepcionalmente',
        reconciliationPeriodId,
        reconciliationOverride,
        reconciliationOverrideReason: reconciliationOverrideReason || null,
        status: 'enviado',
        sentBy: profile?.uid, sentByName: profile?.displayName, sentByEmail: profile?.email,
        createdAt: serverTimestamp(),
      })
      if (reconciliationOverride) {
        await audit('Envio à Contabilidade liberado sem Conciliação Bancária fechada', `${competence} · Motivo: ${reconciliationOverrideReason}`, ref.id)
      }
      await audit('Movimento registrado como enviado à Contabilidade', `${competence} · ${expenseCount} despesa(s) · ${receivableCount} receita(s) · ${transferCount} repasse(s) · ${commissionCount} comissão(ões) · conciliação ${reconciliationClosed ? 'fechada' : 'liberada excepcionalmente'}`, ref.id)
      setMessage(previousDispatches.length ? 'Reenvio registrado com sucesso no histórico.' : 'Movimento registrado com sucesso no histórico.')
    } catch (error) { console.error(error); setMessage('Não foi possível registrar o envio.') } finally { setBusy('') }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Fechamento mensal</span><h1>Contabilidade</h1><p>Pacote mensal por competência real: receitas no mês do recebimento e repasses/comissões no mês do pagamento efetivo.</p></div></div>
    <section className="page-card accounting-panel">
      <div className="accounting-config"><label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label><label><span>Unidade</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option>Todas</option><option>RJ</option><option>SP</option></select></label><label><span>Movimento</span><select value={movement} onChange={(e) => setMovement(e.target.value)}><option>Movimento completo</option><option>Somente Despesas</option><option>Somente Recebimentos</option><option>Somente Repasses / Comissões</option></select></label></div>
      <div className="readiness-grid accounting-six"><article><ReceiptText /><span>Despesas aptas</span><strong>{expenseCount}</strong><small>{money.format(expenseTotal)}</small></article><article><BadgeDollarSign /><span>Receitas aptas</span><strong>{receivableCount}</strong><small>{money.format(revenueTotal)}</small></article><article><Send /><span>Repasses pagos</span><strong>{transferCount}</strong><small>{money.format(transferTotal)}</small></article><article><Calculator /><span>Comissões pagas</span><strong>{commissionCount}</strong><small>{money.format(commissionTotal)}</small></article><article><Paperclip /><span>Documentos</span><strong>{documentCount}</strong><small>{missingDocs.length} lançamento(s) sem anexo</small></article><article className={statement ? 'storage-ready-card' : ''}><Landmark /><span>Extrato bancário</span><strong>{statement ? 'Anexado' : 'Não anexado'}</strong><small>{statement?.fileName || 'Opcional para gerar o ZIP'}</small></article></div>
      <div className="bank-statement-box"><div><Landmark size={21} /><div><strong>Extrato consolidado do banco</strong><span>Opcional para gerar o pacote mensal. Se anexado, será incluído no ZIP. Aceita PDF, OFX, CSV e Excel.</span>{statement && <small><CheckCircle2 size={13} /> {statement.fileName}</small>}</div></div><label className="secondary-button accounting-file-button"><Upload size={17} /> {busy === 'statement' ? 'Enviando...' : statement ? 'Substituir extrato' : 'Anexar extrato'}<input type="file" hidden accept=".pdf,.ofx,.csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadStatement(file); e.currentTarget.value = '' }} /></label></div>
      <div className="storage-ready-box"><FileSpreadsheet size={18} /><div className="accounting-package-copy"><span><strong>Pacote para a Contabilidade:</strong> planilha Excel com Resumo, Despesas, Receitas, Repasses de Alvarás, Comissões de Agentes, Documentos, Pendências e Conciliação Bancária + anexos. O extrato bancário é incluído somente quando estiver anexado.</span><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void prepareAccountingEmail()}><Mail size={17} /> {busy === 'email' ? 'Preparando e-mail...' : 'Preparar e-mail para o contador'}</button><small>Para: fiscal@contabilidadequality.com.br · Cópia: socorro@marquesemuller.adv.br; fernandoazeredo64@gmail.com</small></div></div>
      <div className="accounting-feedback success"><strong>Regra contábil operacional:</strong> Repasse de Alvará é dinheiro de terceiro e não entra como despesa operacional/DRE. A saída aparece na competência da data efetiva de pagamento da parcela.</div>
      {message && <div className={`accounting-feedback ${message.includes('sucesso') || message.includes('gerado') || message.includes('anexado') ? 'success' : 'warning'}`} role="status">{message}</div>}
      <div className="accounting-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void downloadPackage()}><Download size={17} /> {busy === 'download' ? 'Montando ZIP...' : 'Baixar ZIP completo'}</button><button className="revenue-button" type="button" disabled={Boolean(busy)} onClick={() => void sendMovement()}><Calculator size={17} /> {busy === 'send' ? 'Registrando...' : 'Registrar envio à Contabilidade'}</button></div>
    </section>
    <section className="page-card accounting-history-card"><div className="card-title-row"><div><h2>Histórico de envios para a Contabilidade</h2><p>Cada confirmação fica registrada com competência, usuário e totais.</p></div><span className="status-badge revenue">{orderedDispatches.length} envio(s)</span></div>{orderedDispatches.length === 0 ? <div className="module-empty"><Send size={34} /><strong>Nenhum envio registrado</strong></div> : <div className="accounting-history-list">{orderedDispatches.map((item) => <article key={item.id}><div><strong>{item.competence || '—'} · {item.unit || 'Todas'}</strong><span>{item.movement || 'Movimento mensal'}</span><small>{item.sentByName || item.sentByEmail || 'Usuário'} · {timestampToDateTime(item.createdAt)}</small></div><div className="history-totals"><span>{toNumber(item.expenseCount)} despesa(s) · {money.format(toNumber(item.expenseTotal))}</span><span>{toNumber(item.receivableCount)} receita(s) · {money.format(toNumber(item.revenueTotal))}</span><span>{toNumber(item.transferCount)} repasse(s) · {money.format(toNumber(item.transferTotal))}</span><span>{toNumber(item.commissionCount)} comissão(ões) · {money.format(toNumber(item.commissionTotal))}</span></div><span className="status-badge success">Enviado</span></article>)}</div>}</section>
  </>
}
