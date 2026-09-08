import { useEffect } from 'react'

const NEW_LOGO = '/logo-fm.svg'

export function BrandIdentityMMEnhancer() {
  useEffect(() => {
    function applyBrandImages() {
      document.title = 'Controle de Despesas e Receitas | Flávio Marques Advogados Associados'

      const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]
      for (const image of images) {
        const src = image.getAttribute('src') ?? ''
        const isBrandImage = src.includes('logo-fm') || src.includes('logo-mm') || Boolean(image.closest('.auth-brand-panel, .brand-logo-only, .mobile-header-brand'))
        if (!isBrandImage) continue

        if (src !== NEW_LOGO) image.setAttribute('src', NEW_LOGO)
        if (image.alt !== 'Flávio Marques Advogados Associados') image.alt = 'Flávio Marques Advogados Associados'
      }
    }

    applyBrandImages()

    // Observa apenas a criação/remoção de elementos. Não observa texto nem valores
    // de inputs, evitando ciclos de MutationObserver/React que podem bloquear a
    // navegação entre Despesas, Recebimentos e Repasse de Alvarás.
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(applyBrandImages)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])

  return null
}
