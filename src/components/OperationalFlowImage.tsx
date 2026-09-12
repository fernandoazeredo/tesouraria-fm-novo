import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createFlowPdfUrl } from '../lib/flowPdf'

const PART_FILES = [
  '/fluxo-operacional-1.b64',
  '/fluxo-operacional-3.b64',
  '/fluxo-operacional-4.b64',
  '/fluxo-operacional-5.b64',
  '/fluxo-operacional-6.b64',
  '/fluxo-operacional-7.b64',
]

export function OperationalFlowImage() {
  const [src, setSrc] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let active = true
    Promise.all(PART_FILES.map((file) => fetch(file).then((response) => {
      if (!response.ok) throw new Error('Imagem ainda não disponível')
      return response.text()
    })))
      .then((parts) => {
        if (active) setSrc(`data:image/webp;base64,${parts.join('').trim()}`)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!src) return
    let active = true
    let createdUrl = ''
    createFlowPdfUrl(src)
      .then((url) => {
        createdUrl = url
        if (active) setPdfUrl(url)
        else URL.revokeObjectURL(url)
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [src])

  useEffect(() => {
    const parent = document.querySelector<HTMLElement>('.main-content')
    if (!parent) return
    const node = document.createElement('div')
    node.dataset.operationalFlowHost = 'true'
    parent.appendChild(node)
    setHost(node)

    const observer = new MutationObserver(() => {
      if (node.parentElement === parent && parent.lastElementChild !== node) parent.appendChild(node)
    })
    observer.observe(parent, { childList: true })

    return () => {
      observer.disconnect()
      node.remove()
      setHost(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!src || !host) return null

  const card = (
    <section className="page-card" style={{ marginTop: 24, padding: 12 }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onTouchEnd={() => setOpen(true)}
        aria-label="Abrir Fluxo Operacional em tamanho grande"
        style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in', WebkitTapHighlightColor: 'transparent' }}
      >
        <img src={src} alt="Fluxo Operacional do Aplicativo" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 14 }} />
      </button>
      {pdfUrl && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <a
            href={pdfUrl}
            download="Fluxo_Operacional_FM.pdf"
            className="primary-button"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            Baixar Fluxo Operacional em PDF
          </a>
        </div>
      )}
    </section>
  )

  const modal = open ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fluxo Operacional ampliado"
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(5, 15, 30, 0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'auto', touchAction: 'pan-x pan-y pinch-zoom' }}
    >
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(false) }}
        aria-label="Fechar imagem ampliada"
        style={{ position: 'fixed', top: 14, right: 14, zIndex: 2147483647, width: 48, height: 48, borderRadius: 999, border: '1px solid rgba(255,255,255,.45)', background: 'rgba(0,0,0,.72)', color: '#fff', fontSize: 30, lineHeight: 1, cursor: 'pointer' }}
      >×</button>
      <img
        src={src}
        alt="Fluxo Operacional do Aplicativo ampliado"
        onClick={(event) => event.stopPropagation()}
        style={{ display: 'block', width: 'auto', maxWidth: '98vw', height: 'auto', maxHeight: '94vh', objectFit: 'contain', borderRadius: 10, background: '#fff', boxShadow: '0 24px 70px rgba(0,0,0,.55)' }}
      />
    </div>
  ) : null

  return <>{createPortal(card, host)}{modal ? createPortal(modal, document.body) : null}</>
}
