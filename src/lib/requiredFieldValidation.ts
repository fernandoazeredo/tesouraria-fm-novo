type ValidationScope = string | HTMLElement

const SUMMARY_TEXT = 'Preencha os campos destacados para continuar.'
const FIELD_TEXT = 'Campo obrigatório'

function resolveScope(scope: ValidationScope) {
  return typeof scope === 'string' ? document.querySelector<HTMLElement>(scope) : scope
}

function wrapperOf(control: HTMLElement) {
  return control.closest<HTMLElement>('label') ?? control
}

function removeFieldState(control: HTMLElement) {
  const wrapper = wrapperOf(control)
  wrapper.classList.remove('field-validation-error')
  control.classList.remove('required-control-error')
  control.removeAttribute('aria-invalid')
  wrapper.querySelectorAll<HTMLElement>('[data-required-validation-message="true"]').forEach((item) => item.remove())
}

export function clearRequiredFieldErrors(scope: ValidationScope) {
  const host = resolveScope(scope)
  if (!host) return
  host.querySelectorAll<HTMLElement>('[data-required-key]').forEach(removeFieldState)
  host.querySelectorAll<HTMLElement>('[data-required-validation-summary="true"]').forEach((item) => item.remove())
}

export function showRequiredFieldErrors(scope: ValidationScope, keys: string[]) {
  const host = resolveScope(scope)
  if (!host) return false
  clearRequiredFieldErrors(host)
  const controls: HTMLElement[] = []
  for (const key of [...new Set(keys.filter(Boolean))]) {
    const control = host.querySelector<HTMLElement>(`[data-required-key="${key}"]`)
    if (!control) continue
    controls.push(control)
    const wrapper = wrapperOf(control)
    wrapper.classList.add('field-validation-error')
    control.classList.add('required-control-error')
    control.setAttribute('aria-invalid', 'true')
    if (wrapper.tagName === 'LABEL' && !wrapper.querySelector('[data-required-validation-message="true"]')) {
      const message = document.createElement('small')
      message.className = 'field-validation-message'
      message.dataset.requiredValidationMessage = 'true'
      message.textContent = FIELD_TEXT
      wrapper.appendChild(message)
    }
  }
  if (!controls.length) return false
  const first = controls[0]
  const wrapper = wrapperOf(first)
  const group = wrapper.closest<HTMLElement>('.form-grid, .obligation-form-grid, .settings-grid, .soc-settings-grid, .legacy-table, .labor-installments-table, .obligation-installments, .commission-deduction-table')
  const summary = document.createElement('div')
  summary.className = 'form-validation-summary'
  summary.dataset.requiredValidationSummary = 'true'
  summary.setAttribute('role', 'alert')
  summary.textContent = SUMMARY_TEXT
  if (group?.parentElement) group.parentElement.insertBefore(summary, group)
  else host.prepend(summary)
  window.requestAnimationFrame(() => {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (first instanceof HTMLInputElement || first instanceof HTMLSelectElement || first instanceof HTMLTextAreaElement) first.focus()
  })
  return true
}

if (typeof document !== 'undefined') {
  const clearEditedField = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const control = target.closest<HTMLElement>('[data-required-key]')
    if (!control || control.getAttribute('aria-invalid') !== 'true') return
    const host = control.closest<HTMLElement>('.modal-sheet, .decision-modal, .page-card, .main-content, form')
    removeFieldState(control)
    if (host && !host.querySelector('[data-required-key][aria-invalid="true"]')) {
      host.querySelectorAll<HTMLElement>('[data-required-validation-summary="true"]').forEach((item) => item.remove())
    }
  }
  document.addEventListener('input', clearEditedField, true)
  document.addEventListener('change', clearEditedField, true)
}
