import { doc, updateDoc, type DocumentData } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'
import { createTextPdf } from './simplePdf'

export type DemonstrativeKind = 'expense' | 'revenue' | 'alvaraTransfer' | 'commission' | 'societaryTransfer'
export type AnyFinancialRecord = { id: string } & DocumentData
export type DemonstrativeMeta = {
  name: string
  path: string
  url: string
  type: 'application/pdf'
  generatedAt: string
  generatedBy?: string | null
  kind: DemonstrativeKind
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function n(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function s(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function componentRows(record: AnyFinancialRecord) {
  const rows = Array.isArray(record.components) ? record.components : []
  return rows.map((item: DocumentData) => {
    const detail = s(item?.detalhe, '')
    const percent = n(item?.percentual)
    const value = n(item?.valor)
    return `${s(item?.nome)}${detail ? ` — ${detail}` : ''}: ${percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% · ${money.format(value)}`
  })
}

function installmentRows(record: AnyFinancialRecord) {
  const rows = Array.isArray(record.installments) ? record.installments : []
  return rows.map((item: DocumentData, index: number) =>
    `Parcela ${n(item?.number) || index + 1}: ${money.format(n(item?.value))} · prevista ${s(item?.dueDate)} · status ${s(item?.status)} · pagamento ${s(item?.paidDate)}`
  )
}

function deductionRows(record: AnyFinancialRecord) {
  const rows = Array.isArray(record.deductions) ? record.deductions : []
  return rows.map((item: DocumentData) => `${s(item?.date)} · ${s(item?.description)} · ${money.format(n(item?.value))}`)
}

export function createExpenseDemonstrativePdf(record: AnyFinancialRecord) {
  const items = Array.isArray(record.items) ? record.items : []
  const itemLines = items.length
    ? items.map((item: DocumentData) => `${s(item?.data)} · ${s(item?.historico)} · ${money.format(n(item?.valor))}`)
    : ['Nenhum item detalhado informado.']

  return createTextPdf('FLÁVIO MARQUES ADVOGADOS ASSOCIADOS', [
    'DEMONSTRATIVO DE DESPESAS',
    '',
    'DADOS DO LANÇAMENTO',
    `Unidade: ${s(record.unidade)}`,
    `Competência: ${s(record.competencia)}`,
    `Responsável: ${s(record.nome)}`,
    `Fornecedor / Favorecido: ${s(record.fornecedor)}`,
    `CPF / CNPJ: ${s(record.documento)}`,
    '',
    'ITENS DA DESPESA',
    ...itemLines,
    `TOTAL DA DESPESA: ${money.format(n(record.valorTotal))}`,
    '',
    'CLASSIFICAÇÃO',
    `Plano de Contas: ${s(record.expenseAccountCode || record.classificacaoContabil)}`,
    `Descrição da Conta: ${s(record.expenseAccountName || record.categoria)}`,
    `DRE: ${s(record.expenseAccountDre)}`,
    `Detalhamento complementar: ${s(record.subcategoria)}`,
    '',
    'PAGAMENTO',
    `Vencimento / data prevista: ${s(record.paymentDueDate || record.vencimento)}`,
    `Data do pagamento: ${s(record.paymentDate)}`,
    `Conta de pagamento: ${s(record.paymentBankAccount?.bank)} · Ag. ${s(record.paymentBankAccount?.agency)} · C/C ${s(record.paymentBankAccount?.account)}`,
    `Forma de pagamento: ${s(record.paymentMethod)}`,
    `Observações: ${s(record.observacoes || record.observation)}`,
    '',
    'APROVAÇÃO',
    `Status: ${s(record.status)}`,
    `Aprovado por: ${s(record.approvedByName || record.decisionByName)}`,
    `Observação da aprovação: ${s(record.approvalNote)}`,
    `Pago por: ${s(record.paidByName)}`,
  ])
}

export function createRevenueDemonstrativePdf(record: AnyFinancialRecord) {
  return createTextPdf('FLÁVIO MARQUES ADVOGADOS ASSOCIADOS', [
    'DEMONSTRATIVO DE RECEBIMENTO DE HONORÁRIOS',
    '',
    'DADOS DO PROCESSO',
    `Unidade: ${s(record.unidade)}`,
    `Data: ${s(record.data)}`,
    `Data do recebimento: ${s(record.receiptDate || record.data)}`,
    `Natureza: ${s(record.natureza)}`,
    `Processo: ${s(record.processo)}`,
    `Reclamante: ${s(record.reclamante)}`,
    `Reclamada: ${s(record.reclamada)}`,
    `Origem: ${s(record.origem || record.natureza)}`,
    `Forma de recebimento: ${s(record.formaRecebimento)}`,
    '',
    'COMPOSIÇÃO DO VALOR',
    `Valor total / líquido do alvará: ${money.format(n(record.valorAlvara))}`,
    `Base de cálculo: ${money.format(n(record.baseCalculo))}`,
    ...componentRows(record),
    `Total de deduções: ${money.format(n(record.totalDeducoes))}`,
    `Honorários do Escritório: ${money.format(n(record.invoiceValue))}`,
    `Comissão / participação do agente: ${money.format(n(record.agentCommissionValue))}`,
    `VALOR LÍQUIDO AO CLIENTE: ${money.format(n(record.valorLiquidoCliente))}`,
    '',
    'DADOS BANCÁRIOS DO CLIENTE',
    `Banco: ${s(record.banco)}`,
    `Agência: ${s(record.agencia)}`,
    `Conta: ${s(record.conta)}`,
    `Titular: ${s(record.titular)}`,
    `CPF: ${s(record.cpf)}`,
    `PIX: ${s(record.pix)}`,
    '',
    'DADOS PARA NOTA FISCAL',
    `Cliente / tomador: ${s(record.reclamante)}`,
    `Endereço: ${s(record.enderecoNf)}`,
    `E-mail: ${s(record.emailNf)}`,
    '',
    'RECEBIMENTO PELO ESCRITÓRIO',
    `Conta de recebimento: ${s(record.receivingBankAccount?.bank)} · Ag. ${s(record.receivingBankAccount?.agency)} · C/C ${s(record.receivingBankAccount?.account)}`,
    `Status: ${s(record.status)}`,
    `Confirmado pela Tesouraria por: ${s(record.treasuryByName || record.treasuryBy)}`,
  ])
}

export function createPaymentDemonstrativePdf(kind: Exclude<DemonstrativeKind, 'expense' | 'revenue'>, record: AnyFinancialRecord) {
  const title = kind === 'commission'
    ? 'DEMONSTRATIVO DE PAGAMENTO DE COMISSÃO DE AGENTE'
    : kind === 'societaryTransfer'
      ? 'DEMONSTRATIVO DE REPASSE SOCIETÁRIO'
      : 'DEMONSTRATIVO DE REPASSE DE ALVARÁ'

  const lines = [
    title,
    '',
    'IDENTIFICAÇÃO',
    `Processo: ${s(record.processo || record.sourceSnapshot?.processo)}`,
    `Reclamante: ${s(record.reclamante || record.sourceSnapshot?.reclamante)}`,
    `Reclamada: ${s(record.reclamada || record.sourceSnapshot?.reclamada)}`,
    `Beneficiário: ${s(record.beneficiary)}`,
    `Unidade: ${s(record.sourceSnapshot?.unidade || record.unidade)}`,
    '',
  ]

  if (kind === 'commission') {
    lines.push(
      'COMISSÃO',
      `Comissão bruta: ${money.format(n(record.grossAmount))}`,
      ...deductionRows(record),
      `Total de deduções: ${money.format(n(record.deductionTotal))}`,
      `Valor líquido devido: ${money.format(n(record.netAmountDue ?? record.amountDue))}`,
      '',
    )
  } else if (kind === 'societaryTransfer') {
    lines.push(
      'REPASSE SOCIETÁRIO',
      `Honorários do escritório: ${money.format(n(record.officeFees))}`,
      `Percentual: ${n(record.percent).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
      `Valor do repasse: ${money.format(n(record.transferValue))}`,
      '',
    )
  } else {
    lines.push(
      'REPASSE AO CLIENTE',
      `Valor recebido: ${money.format(n(record.amountReceived))}`,
      `Valor devido ao cliente: ${money.format(n(record.amountDue))}`,
      '',
    )
  }

  lines.push(
    'PAGAMENTO',
    ...installmentRows(record),
    `Valor pago: ${money.format(n(record.paidValue || record.transferValue))}`,
    `Data efetiva do pagamento: ${s(record.paymentDate || (Array.isArray(record.installments) ? record.installments.find((i: DocumentData) => i?.paid)?.paidDate : ''))}`,
    `Referência bancária: ${s(record.paymentReference)}`,
    `Status: ${s(record.status)}`,
    `Pago por: ${s(record.paidByName || record.updatedByName)}`,
  )

  return createTextPdf('FLÁVIO MARQUES ADVOGADOS ASSOCIADOS', lines)
}

function pathFor(kind: DemonstrativeKind, id: string) {
  const folder = {
    expense: 'despesas',
    revenue: 'receitas',
    alvaraTransfer: 'repasses-alvaras',
    commission: 'comissoes',
    societaryTransfer: 'repasses-societarios',
  }[kind]
  return `demonstrativos/${folder}/${id}/demonstrativo.pdf`
}

export async function ensureOfficialDemonstrative(
  kind: DemonstrativeKind,
  record: AnyFinancialRecord,
  options?: { collectionName?: string; generatedBy?: string | null },
): Promise<DemonstrativeMeta> {
  const existing = record.demonstrative as DemonstrativeMeta | undefined
  if (existing?.path && existing?.url) return existing

  const collectionName = options?.collectionName || ({
    expense: 'expenses',
    revenue: 'receivables',
    alvaraTransfer: 'alvaraTransfers',
    commission: 'agentCommissions',
    societaryTransfer: 'societaryTransfers',
  }[kind])

  const bytes = kind === 'expense'
    ? createExpenseDemonstrativePdf(record)
    : kind === 'revenue'
      ? createRevenueDemonstrativePdf(record)
      : createPaymentDemonstrativePdf(kind, record)

  const path = String(existing?.path || record.demonstrativePath || pathFor(kind, record.id))
  const target = storageRef(storage, path)
  // PDFs imutáveis: reutilizar o arquivo já existente em caso de geração parcial.
  let url: string
  try {
    url = await getDownloadURL(target)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code && code !== 'storage/object-not-found') throw error
    await uploadBytes(target, bytes, { contentType: 'application/pdf', customMetadata: { immutable: 'true', kind } })
    url = await getDownloadURL(target)
  }
  const meta: DemonstrativeMeta = {
    name: 'demonstrativo.pdf',
    path,
    url,
    type: 'application/pdf',
    generatedAt: new Date().toISOString(),
    generatedBy: options?.generatedBy ?? null,
    kind,
  }

  await updateDoc(doc(db, collectionName, record.id), {
    demonstrative: meta,
    demonstrativePath: path,
    demonstrativeUrl: url,
    demonstrativeGeneratedAt: meta.generatedAt,
  })
  return meta
}
