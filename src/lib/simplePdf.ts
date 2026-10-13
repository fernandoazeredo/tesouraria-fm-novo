function encodeWinAnsi(value: string) {
  const map: Record<string, number> = {
    '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137,
    'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149,
    '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159,
  }
  const bytes: number[] = []
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 255) bytes.push(code)
    else if (map[char] != null) bytes.push(map[char])
    else bytes.push(63)
  }
  return new Uint8Array(bytes)
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapLine(value: string, maxChars = 88) {
  const source = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!source) return ['']
  const words = source.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) current = next
    else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

export function createTextPdf(title: string, lines: string[]) {
  const logicalLines = [title, '', ...lines].flatMap((line) => wrapLine(line))
  const perPage = 50
  const pages: string[][] = []
  for (let i = 0; i < logicalLines.length; i += perPage) pages.push(logicalLines.slice(i, i + perPage))
  if (pages.length === 0) pages.push([title])

  const objectBodies: string[] = []
  const pageObjectIds: number[] = []
  const contentObjectIds: number[] = []

  objectBodies[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objectBodies[2] = ''
  objectBodies[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  let nextId = 4
  for (const pageLines of pages) {
    const pageId = nextId++
    const contentId = nextId++
    pageObjectIds.push(pageId)
    contentObjectIds.push(contentId)

    const commands: string[] = ['BT', '/F1 10 Tf', '40 800 Td']
    pageLines.forEach((line, index) => {
      if (index > 0) commands.push('0 -14 Td')
      commands.push(`(${escapePdfText(line)}) Tj`)
    })
    commands.push('ET')
    const stream = commands.join('\n')
    objectBodies[contentId] = `<< /Length ${encodeWinAnsi(stream).length} >>\nstream\n${stream}\nendstream`
    objectBodies[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
  }

  objectBodies[2] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`

  const chunks: Uint8Array[] = [encodeWinAnsi('%PDF-1.4\n%âãÏÓ\n')]
  const offsets: number[] = [0]
  let currentOffset = chunks[0].length
  for (let id = 1; id < objectBodies.length; id += 1) {
    offsets[id] = currentOffset
    const chunk = encodeWinAnsi(`${id} 0 obj\n${objectBodies[id]}\nendobj\n`)
    chunks.push(chunk)
    currentOffset += chunk.length
  }

  const xrefOffset = currentOffset
  const xref: string[] = [
    'xref',
    `0 ${objectBodies.length}`,
    '0000000000 65535 f ',
  ]
  for (let id = 1; id < objectBodies.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n `)
  xref.push(
    'trailer',
    `<< /Size ${objectBodies.length} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF'
  )
  chunks.push(encodeWinAnsi(xref.join('\n')))
  return concatBytes(chunks)
}
