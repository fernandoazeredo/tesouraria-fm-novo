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


/**
 * Demonstrativo oficial vetorial A4. Espelha a estrutura de cabeçalho
 * institucional, faixas de seção e dados financeiros dos formulários do app.
 * Mantém texto selecionável e paginação automática, sem screenshots.
 */
export function createStyledDemonstrativePdf(company: string, lines: string[]) {
  const heading = String(lines[0] || 'DEMONSTRATIVO').trim()
  const expense = /DESPESA/i.test(heading)
  const accent = expense ? '0.70 0.19 0.20' : '0.11 0.34 0.67'
  const navy = '0.08 0.13 0.23'
  const gray = '0.25 0.30 0.38'
  const pages: string[][] = []
  let commands: string[] = []
  let y = 721

  const writeText = (value: string, x: number, baseline: number, size: number, bold = false, rgb = gray) => {
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb} rg 1 0 0 1 ${x} ${baseline} Tm (${escapePdfText(value)}) Tj ET`)
  }
  const startPage = () => {
    commands = [
      `${navy} rg 0 754 595 88 re f`,
      `${accent} rg 0 750 595 4 re f`,
      '0.96 0.97 0.99 rg 34 722 527 20 re f',
    ]
    writeText(company, 34, 804, 13, true, '1 1 1')
    writeText(heading, 34, 775, 11, true, '1 1 1')
    y = 701
  }
  const finishPage = () => {
    const index = pages.length + 1
    commands.push('0.86 0.88 0.91 RG 34 55 m 561 55 l S')
    writeText(`Documento gerado pela Tesouraria FM NOVO · Página ${index}`, 34, 40, 8, false, gray)
    pages.push(commands)
  }
  const ensureRoom = (required: number) => {
    if (y - required < 69) {
      finishPage()
      startPage()
    }
  }
  const isSection = (value: string) => {
    const v = value.trim()
    return v.length > 0 && v.length <= 65 && !v.includes(':') &&
      /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ /()-]+$/.test(v) && v === v.toLocaleUpperCase('pt-BR')
  }

  startPage()
  for (const raw of lines.slice(1)) {
    const text = String(raw || '').trim()
    if (!text) {
      y -= 7
      continue
    }
    if (isSection(text)) {
      ensureRoom(41)
      commands.push('0.93 0.95 0.98 rg 34 ' + (y - 6) + ' 527 25 re f')
      commands.push(`${accent} rg 34 ${y - 6} 4 25 re f`)
      writeText(text, 46, y + 2, 10, true, navy)
      y -= 38
      continue
    }
    const emphasized = /^(TOTAL |VALOR LÍQUIDO|VALOR PAGO|HONORÁRIOS DO ESCRITÓRIO)/i.test(text)
    for (const line of wrapLine(text, 95)) {
      ensureRoom(17)
      writeText(line, 44, y, emphasized ? 10.5 : 9.5, emphasized, emphasized ? navy : gray)
      y -= 16
    }
  }
  finishPage()

  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = ''
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  let id = 5
  const pageIds: number[] = []
  pages.forEach((page) => {
    const pageId = id++
    const contentId = id++
    pageIds.push(pageId)
    const stream = page.join('\n')
    objects[contentId] = `<< /Length ${encodeWinAnsi(stream).length} >>\nstream\n${stream}\nendstream`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
  })
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(' ')}] >>`
  const pieces: Uint8Array[] = [encodeWinAnsi('%PDF-1.4\n%âãÏÓ\n')]
  const offsets: number[] = [0]
  let position = pieces[0].length
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = position
    const part = encodeWinAnsi(`${i} 0 obj\n${objects[i]}\nendobj\n`)
    pieces.push(part)
    position += part.length
  }
  const xref = ['xref', `0 ${objects.length}`, '0000000000 65535 f ']
  for (let i = 1; i < objects.length; i += 1) xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `)
  xref.push('trailer', `<< /Size ${objects.length} /Root 1 0 R >>`, 'startxref', String(position), '%%EOF')
  pieces.push(encodeWinAnsi(xref.join('\n')))
  return concatBytes(pieces)
}
