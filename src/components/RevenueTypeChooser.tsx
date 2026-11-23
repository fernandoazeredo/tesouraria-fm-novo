import { createPortal } from 'react-dom'
import { Handshake, ReceiptText, WalletCards, X } from 'lucide-react'

/** Escolha do tipo de receita: Alvará, Acordo Trabalhista ou Outras Receitas. */
export function RevenueTypeModal({ onClose, onStandard, onAgreement, onOther }: {
  onClose: () => void
  onStandard: () => void
  onAgreement: () => void
  onOther: () => void
}) {
  return createPortal(
    <div className="modal-backdrop revenue-type-backdrop">
      <section className="decision-modal revenue-type-modal" role="dialog" aria-modal="true" aria-label="Escolher tipo de receita">
        <div className="modal-toolbar">
          <div><span className="eyebrow revenue-text">Nova Receita</span><h2>Qual é o tipo de recebimento?</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        <p className="revenue-type-helper">Escolha o fluxo correto. Cada opção abre o formulário próprio e mantém os lançamentos dentro do mesmo módulo de Receitas.</p>
        <div className="revenue-type-options revenue-type-options-three">
          <button type="button" className="revenue-type-option" onClick={onStandard}>
            <span className="revenue-type-icon"><ReceiptText size={25} /></span>
            <span><strong>Alvará</strong><small>Recebimento de alvará, com o demonstrativo já utilizado no sistema.</small></span>
          </button>
          <button type="button" className="revenue-type-option agreement" onClick={onAgreement}>
            <span className="revenue-type-icon"><Handshake size={25} /></span>
            <span><strong>Acordo Trabalhista</strong><small>Controle próprio do acordo, com parcelas, datas previstas e realizadas, honorários, deduções e líquido do cliente.</small></span>
          </button>
          <button type="button" className="revenue-type-option other-revenue-option" onClick={onOther}>
            <span className="revenue-type-icon"><WalletCards size={25} /></span>
            <span><strong>Outras Receitas</strong><small>Entradas sem processo judicial, como aporte, reembolso, rendimento de aplicação ou outros créditos.</small></span>
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
