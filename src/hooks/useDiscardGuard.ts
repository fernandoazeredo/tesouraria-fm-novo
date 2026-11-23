import { useEffect, useRef } from 'react'

/** Retrato dos campos do formulário, usado para saber se há alterações não salvas. */
function snapshot(root: HTMLElement) {
  const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
  const values = controls.map((control, index) => {
    const checked = control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type) ? String(control.checked) : ''
    return `${index}:${control instanceof HTMLInputElement ? control.type : control.tagName}:${control.value}:${checked}`
  })
  values.push(`uploads:${root.querySelectorAll('.upload-item').length}`)
  return values.join('|')
}

/**
 * Fecha o modal ao clicar fora ou apertar Esc, pedindo confirmação se houver
 * alterações não salvas. Retorna a ref do painel e as props do fundo do modal.
 */
export function useDiscardGuard(onClose: () => void) {
  const sheetRef = useRef<HTMLElement>(null)
  const baseline = useRef<string | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (sheetRef.current) baseline.current = snapshot(sheetRef.current) })
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); attemptClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey, true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function attemptClose() {
    const sheet = sheetRef.current
    const dirty = Boolean(sheet && baseline.current !== null && snapshot(sheet) !== baseline.current)
    if (dirty && !window.confirm('Descartar alterações? Os dados ainda não salvos serão perdidos.')) return
    closeRef.current()
  }

  const backdropProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      attemptClose()
    },
  }
  return { sheetRef, backdropProps }
}
