import { useEffect } from 'react'

/**
 * Permite digitar datas como DDMMAAAA em qualquer <input type="date"> (com dica
 * flutuante). Usa apenas delegação de eventos de teclado/foco; não altera a
 * estrutura da página.
 */
const dateBuffers = new WeakMap<HTMLInputElement, string>()

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function dateMaskText(digits: string) {
  const padded = digits.slice(0, 8).padEnd(8, '_')
  return `${padded.slice(0, 2)}/${padded.slice(2, 4)}/${padded.slice(4, 8)}`
}

function validIsoFromDigits(digits: string) {
  if (!/^\d{8}$/.test(digits)) return ''
  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4, 8))
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function useDateTypingHelper() {
  useEffect(() => {
    const hint = document.createElement('div')
    hint.className = 'date-mask-hint'
    hint.hidden = true
    document.body.appendChild(hint)

    const show = (input: HTMLInputElement, text: string, isError = false) => {
      const rect = input.getBoundingClientRect()
      hint.textContent = text
      hint.classList.toggle('is-error', isError)
      hint.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 205)}px`
      hint.style.top = `${Math.min(window.innerHeight - 42, rect.bottom + 5)}px`
      hint.hidden = false
    }
    const hide = () => { hint.hidden = true }

    const onKeyDown = (event: KeyboardEvent) => {
      const input = event.target instanceof HTMLInputElement && event.target.type === 'date' ? event.target : null
      if (!input || input.disabled || input.readOnly || event.ctrlKey || event.metaKey || event.altKey) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        const previous = dateBuffers.get(input) ?? ''
        const next = previous.length >= 8 ? event.key : `${previous}${event.key}`
        dateBuffers.set(input, next)
        show(input, `Digite DDMMAAAA: ${dateMaskText(next)}`)
        if (next.length === 8) {
          const iso = validIsoFromDigits(next)
          if (!iso) { show(input, `Data inválida: ${dateMaskText(next)}`, true); return }
          setNativeInputValue(input, iso)
          dateBuffers.set(input, '')
          show(input, `Data registrada: ${dateMaskText(next)}`)
          window.setTimeout(hide, 650)
        }
        return
      }
      if (event.key === '/' || event.key === '-') { event.preventDefault(); return }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        const previous = dateBuffers.get(input) ?? ''
        if (previous) {
          const next = previous.slice(0, -1)
          dateBuffers.set(input, next)
          show(input, `Digite DDMMAAAA: ${dateMaskText(next)}`)
        } else {
          setNativeInputValue(input, '')
          show(input, 'Digite DDMMAAAA: __/__/____')
        }
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      const input = event.target instanceof HTMLInputElement && event.target.type === 'date' ? event.target : null
      if (!input) return
      dateBuffers.set(input, '')
      input.title = 'Digite a data em DDMMAAAA ou utilize o calendário.'
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'date') { dateBuffers.set(event.target, ''); hide() }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      hint.remove()
    }
  }, [])
}
