function buildPdf(jpeg: Uint8Array, width: number, height: number) {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets = [0, 0, 0, 0, 0, 0]
  let offset = 0

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    offset += bytes.byteLength
  }
  const write = (value: string) => push(encoder.encode(value))
  const object = (number: number, body: string) => {
    offsets[number] = offset
    write(`${number} 0 obj\n${body}\nendobj\n`)
  }

  const pageWidth = width * 72 / 150
  const pageHeight = height * 72 / 150

  write('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)

  offsets[4] = offset
  write(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`)
  push(jpeg)
  write('\nendstream\nendobj\n')

  const stream = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`
  offsets[5] = offset
  write(`5 0 obj\n<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}endstream\nendobj\n`)

  const xref = offset
  write('xref\n0 6\n0000000000 65535 f \n')
  for (let index = 1; index <= 5; index += 1) {
    write(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  }
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const pdf = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    pdf.set(chunk, position)
    position += chunk.byteLength
  }

  return new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' })
}

export function createFlowPdfUrl(src: string) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas indisponível')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.98)
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const binary = atob(base64)
        const jpeg = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) jpeg[index] = binary.charCodeAt(index)

        resolve(URL.createObjectURL(buildPdf(jpeg, canvas.width, canvas.height)))
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error('Não foi possível preparar o PDF'))
    image.src = src
  })
}
