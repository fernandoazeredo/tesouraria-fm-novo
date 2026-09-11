import { useEffect, useState } from 'react'

const PART_COUNT = 5

export function OperationalFlowImage() {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let active = true
    Promise.all(Array.from({ length: PART_COUNT }, (_, index) => fetch(`/fluxo-operacional-${index + 1}.b64`).then((response) => {
      if (!response.ok) throw new Error('Imagem ainda não disponível')
      return response.text()
    })))
      .then((parts) => {
        if (active) setSrc(`data:image/webp;base64,${parts.join('').trim()}`)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  if (!src) return null

  return (
    <section className="page-card" style={{ marginTop: 24, padding: 12 }}>
      <img
        src={src}
        alt="Fluxo Operacional do Aplicativo"
        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 14, cursor: 'zoom-in' }}
        onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
      />
    </section>
  )
}
