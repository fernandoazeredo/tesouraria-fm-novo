export type OfxTransaction = {
  fitId: string
  sourceIndex: number
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

export function parseOfx(text: string): ParsedOfx {
  const source = text.replace(/^\uFEFF/, '')
  const blocks = source.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)
    ?? source.split(/<STMTTRN>/i).slice(1).map((part) => part.split(/<\/BANKTRANLIST>/i)[0])

  const transactions = blocks.map((block, index) => {
    const amount = numberFromOfx(field(block, 'TRNAMT'))
    const fitId = field(block, 'FITID') || `SEM-FITID-${index + 1}-${dateFromOfx(field(block, 'DTPOSTED'))}-${amount.toFixed(2)}`
    return {
      fitId,
      sourceIndex: index,
      date: dateFromOfx(field(block, 'DTPOSTED')),
      amount,
      type: field(block, 'TRNTYPE'),
      memo: field(block, 'MEMO'),
      name: field(block, 'NAME'),
      refNum: field(block, 'REFNUM'),
      checkNum: field(block, 'CHECKNUM'),
    }
  }).filter((item) => item.date && item.amount !== 0)

  return {
    bankId: field(source, 'BANKID'),
    branchId: field(source, 'BRANCHID'),
    accountId: field(source, 'ACCTID'),
    currency: field(source, 'CURDEF') || 'BRL',
    transactions,
  }
}
