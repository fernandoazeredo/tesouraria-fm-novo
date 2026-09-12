import { useEffect, useState } from 'react'

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
  const [open, setOpen] = useState(false)

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

  if (!src) return null

  return (
    <>
      <section className="page-card" style={{ marginTop: 24, padding: 12 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir Fluxo Operacional em tamanho grande"
          style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }}
        >
          <img
            src={src}
            alt="Fluxo Operacional do Aplicativo"
            style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 14 }}
          />
        </button>
      </section>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fluxo Operacional ampliado"
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(5, 15, 30, 0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}
        >
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setOpen(false) }}
            aria-label="Fechar imagem ampliada"
            style={{ position: 'fixed', top: 16, right: 18, zIndex: 100000, width: 44, height: 44, borderRadius: 999, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}
          >×</button>
          <img
            src={src}
            alt="Fluxo Operacional do Aplicativo ampliado"
            onClick={(event) => event.stopPropagation()}
            style={{ display: 'block', width: 'auto', maxWidth: '96vw', height: 'auto', maxHeight: '92vh', objectFit: 'contain', borderRadius: 12, background: '#fff', boxShadow: '0 24px 70px rgba(0,0,0,.45)', cursor: 'zoom-out' }}
          />
        </div>
      )}
    </>
  )
}
