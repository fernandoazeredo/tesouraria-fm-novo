import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

function applyNavigationCopy(pathname: string) {
  const revenueLink = document.querySelector<HTMLAnchorElement>('a.nav-link[href="/alvaras"]')
  const revenueLabel = revenueLink?.querySelector<HTMLElement>('span')
  if (revenueLabel && revenueLabel.textContent !== 'Receitas') revenueLabel.textContent = 'Receitas'

  const approvalLink = document.querySelector<HTMLAnchorElement>('a.nav-link[href="/aprovacoes"]')
  if (approvalLink && !approvalLink.classList.contains('approval-attention-nav')) approvalLink.classList.add('approval-attention-nav')

  if (pathname === '/alvaras') {
    const heading = document.querySelector<HTMLElement>('.main-content .page-heading')
    const title = heading?.querySelector<HTMLElement>('h1')
    const description = heading?.querySelector<HTMLElement>('p')
    if (title && title.textContent !== 'Receitas') title.textContent = 'Receitas'
    const desiredDescription = 'O departamento de origem registra os recebimentos, informa a conta em que o valor foi recebido e anexa os documentos que seguirão para a Tesouraria.'
    if (description && description.textContent !== desiredDescription) description.textContent = desiredDescription
  }

  if (pathname === '/despesas') {
    const heading = document.querySelector<HTMLElement>('.main-content .page-heading')
    const description = heading?.querySelector<HTMLElement>('p')
    const desiredDescription = 'A Tesouraria recebe a solicitação e os documentos da despesa, confere e registra as informações, informa a conta em que o pagamento será realizado, encaminha o demonstrativo para aprovação e, após autorizado, efetua e acompanha o pagamento.'
    if (description && description.textContent !== desiredDescription) description.textContent = desiredDescription
  }
}

export function NavigationCopyEnhancer() {
  const location = useLocation()

  useEffect(() => {
    let scheduled = false
    const apply = () => {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(() => {
        scheduled = false
        applyNavigationCopy(location.pathname)
      })
    }

    applyNavigationCopy(location.pathname)
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [location.pathname])

  return null
}
