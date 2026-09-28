export type OfxTransaction = {
  fitId: string
  sourceIndex: number
  identityKey: string
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

export async function readOfxFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const latin1 = new TextDecoder('windows-1252').decode(bytes)
  const header = latin1.slice(0, 2048)
  const declaresUtf8 = /CHARSET\s*:\s*(UTF-?8|65001)/i.test(header)
  return declaresUtf8 ? new TextDecoder('utf-8').decode(bytes) : latin1
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
  const occurrence = new Map<string, number>()
  const transactions = validRows.map((item) => {
    const signature = [
      item.date,
      item.amount.toFixed(2),
      normalizeIdentityText(item.fitId),
      normalizeIdentityText(item.type),
      normalizeIdentityText(item.memo),
      normalizeIdentityText(item.name),
      normalizeIdentityText(item.refNum),
      normalizeIdentityText(item.checkNum),
    ].join('|')
    const count = (occurrence.get(signature) ?? 0) + 1
    occurrence.set(signature, count)
    return {
      ...item,
      identityKey: `${item.date}__${hashIdentity(signature)}__${String(count).padStart(2, '0')}`,
    }
  })

  return {
    bankId: field(source, 'BANKID'),
    branchId: field(source, 'BRANCHID'),
    accountId: field(source, 'ACCTID'),
    currency: field(source, 'CURDEF') || 'BRL',
    transactions,
    discardedCount: parsedRows.length - validRows.length,
  }
}
