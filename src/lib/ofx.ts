export type OfxTransaction = {
  fitId: string
  sourceIndex: number
  identityKey: string
  movementClass: 'conciliavel' | 'saldo' | 'aplicacao_automatica'
  date: string
  amount: number
  type: string
  memo: string
  name: string
  refNum: string
  checkNum: string
}

export type ParsedOfx = {
  bankId: string
  branchId: string
  accountId: string
  currency: string
  transactions: OfxTransaction[]
  discardedCount: number
  balanceCount: number
  automaticInvestmentCount: number
  reconcilableCount: number
}

function field(block: string, tag: string) {
  const xml = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)</${tag}>`, 'i'))
  if (xml) return xml[1].trim()
  const sgml = block.match(new RegExp(`<${tag}>([^\\r\\n<]+)`, 'i'))
  return sgml ? sgml[1].trim() : ''
}

function dateFromOfx(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function numberFromOfx(value: string) {
  const cleaned = value.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '')
  if (!cleaned) return 0

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.')
    else normalized = cleaned.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  }

  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function replacementCount(value: string) {
  return (value.match(/\uFFFD/g) || []).length
}

export async function readOfxFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())

  // Alguns OFX reais do Itaú declaram CHARSET:1252, mas o conteúdo está em UTF-8.
  // Primeiro tentamos UTF-8 estrito; só usamos Windows-1252 quando UTF-8 não é válido.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const utf8 = new TextDecoder('utf-8').decode(bytes)
    const latin1 = new TextDecoder('windows-1252').decode(bytes)
    return replacementCount(utf8) <= replacementCount(latin1) ? utf8 : latin1
  }
}

function normalizeIdentityText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase()
}

function hashIdentity(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function classifyMovement(item: { type: string; memo: string; name: string }) {
  const text = normalizeIdentityText([item.type, item.memo, item.name].filter(Boolean).join(' ')).replace(/\./g, '')

  const balancePatterns = [
    'SALDO ANTERIOR',
    'SALDO APLIC AUT',
    'SDO APLIC AUT MAIS',
    'SALDO TOTAL DISPONIVEL',
    'SALDO TOTAL DISPONIVEL DIA',
    'SALDO MOVIMENTACAO CONTA',
    'SALDO MOVIMENTACAO',
    'SALDO DISPONIVEL',
    'SALDO CONTA CORRENTE',
    'SALDO DO DIA',
  ]
  if (balancePatterns.some((pattern) => text.includes(pattern))) return 'saldo' as const

  const automaticInvestmentPatterns = [
    'APLICACAO AUTOMATICA',
    'APLIC AUTOMATICA',
    'APLIC AUT MAIS',
    'APL APLIC AUT',
    'APLICACAO CDB DI',
    'RESGATE AUTOMATICO',
    'RESGATE APLICACAO',
    'RESGATE CDB',
    'RENDIMENTO AUTOMATICO',
    'REND APLIC AUTOM',
    'REND PAGO APLIC AUT APR',
    'REMUNERACAO APLICACAO',
  ]
  if (automaticInvestmentPatterns.some((pattern) => text.includes(pattern))) return 'aplicacao_automatica' as const

  return 'conciliavel' as const
}

export function parseOfx(text: string): ParsedOfx {
  const source = text.replace(/^\uFEFF/, '')
  const blocks = source.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)
    ?? source.split(/<STMTTRN>/i).slice(1).map((part) => part.split(/<\/BANKTRANLIST>/i)[0])

  const parsedRows = blocks.map((block, index) => {
    const amount = numberFromOfx(field(block, 'TRNAMT'))
    const date = dateFromOfx(field(block, 'DTPOSTED'))
    const fitId = field(block, 'FITID') || 'SEM-FITID'
    return {
      fitId,
      sourceIndex: index,
      date,
      amount,
      type: field(block, 'TRNTYPE'),
      memo: field(block, 'MEMO'),
      name: field(block, 'NAME'),
      refNum: field(block, 'REFNUM'),
      checkNum: field(block, 'CHECKNUM'),
    }
  })

  const validRows = parsedRows.filter((item) => item.date && item.amount !== 0)

  const fitIdFrequency = new Map<string, number>()
  validRows.forEach((item) => {
    const fitId = normalizeIdentityText(item.fitId)
    if (fitId && fitId !== 'SEM-FITID') fitIdFrequency.set(fitId, (fitIdFrequency.get(fitId) ?? 0) + 1)
  })

  const occurrence = new Map<string, number>()
  const transactions = validRows.map((item) => {
    const normalizedFitId = normalizeIdentityText(item.fitId)
    const detailSignature = [
      item.date,
      item.amount.toFixed(2),
      normalizedFitId,
      normalizeIdentityText(item.type),
      normalizeIdentityText(item.memo),
      normalizeIdentityText(item.name),
      normalizeIdentityText(item.refNum),
      normalizeIdentityText(item.checkNum),
    ].join('|')

    let identityKey: string
    if (normalizedFitId && normalizedFitId !== 'SEM-FITID' && fitIdFrequency.get(normalizedFitId) === 1) {
      // No OFX real do Itaú o FITID é a identidade bancária mais estável entre exportações sobrepostas.
      identityKey = `FITID__${hashIdentity(normalizedFitId)}`
    } else {
      // Fallback para FITID ausente/repetido sem depender da posição da linha no arquivo.
      const count = (occurrence.get(detailSignature) ?? 0) + 1
      occurrence.set(detailSignature, count)
      identityKey = `DET__${hashIdentity(detailSignature)}__${String(count).padStart(2, '0')}`
    }

    return {
      ...item,
      identityKey,
      movementClass: classifyMovement(item),
    }
  })

  return {
    bankId: field(source, 'BANKID'),
    branchId: field(source, 'BRANCHID'),
    accountId: field(source, 'ACCTID'),
    currency: field(source, 'CURDEF') || 'BRL',
    transactions,
    discardedCount: parsedRows.length - validRows.length,
    balanceCount: transactions.filter((item) => item.movementClass === 'saldo').length,
    automaticInvestmentCount: transactions.filter((item) => item.movementClass === 'aplicacao_automatica').length,
    reconcilableCount: transactions.filter((item) => item.movementClass === 'conciliavel').length,
  }
}
