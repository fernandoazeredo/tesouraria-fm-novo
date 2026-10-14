import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { OfficialFinancialDocument, type OfficialDocumentKind, type FinancialDocumentRecord } from '../components/OfficialFinancialDocument'

/**
 * Um unico componente React para prévia na tela e geração de PDF.
 * Faz captura do HTML real, sem recriar o documento via comandos PDF de texto.
 */
export async function renderFinancialDocumentPdf(kind: OfficialDocumentKind, record: FinancialDocumentRecord, emittedAt: string): Promise<Uint8Array> {
  const host = document.createElement('div')
  host.setAttribute('data-official-financial-pdf', 'true')
  host.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:-10;pointer-events:none;'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(createElement(OfficialFinancialDocument, { kind, record, emittedAt })))
    const sheet = host.querySelector('.ofd-sheet') as HTMLElement | null
    if (!sheet) throw new Error('Componente HTML do demonstrativo indisponível')

    await document.fonts.ready
    const imgs = Array.from(sheet.querySelectorAll('img'))
    await Promise.all(imgs.map(async (img) => {
      if (img.complete) return
      await new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      })
    }))

    const canvas = await html2canvas(sheet, {
      scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true,
      width: 794, windowWidth: 794, scrollX: 0, scrollY: 0,
    })
    if (!canvas.width || !canvas.height) throw new Error('Falha ao capturar o formulário HTML')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
    const widthPt = pdf.internal.pageSize.getWidth()
    const heightPt = pdf.internal.pageSize.getHeight()
    const marginPt = 18
    const availableWidthPt = widthPt - marginPt * 2
    const availableHeightPt = heightPt - marginPt * 2
    const scalePt = availableWidthPt / canvas.width
    const maxHeightPixels = Math.max(1, Math.floor(availableHeightPt / scalePt))
    let startY = 0
    let pageNumber = 0
    while (startY < canvas.height) {
      const sliceHeight = Math.min(maxHeightPixels, canvas.height - startY)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = sliceHeight
      const ctx = slice.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível para paginação')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, startY, canvas.width, sliceHeight, 0, 0, slice.width, sliceHeight)
      if (pageNumber > 0) pdf.addPage()
      pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', marginPt, marginPt, availableWidthPt, sliceHeight * scalePt)
      startY += sliceHeight
      pageNumber += 1
    }
    const buffer = pdf.output('arraybuffer')
    return new Uint8Array(buffer)
  } finally {
    root.unmount()
    host.remove()
  }
}
