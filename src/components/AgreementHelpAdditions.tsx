import { FileText, Handshake, Send } from 'lucide-react'

/** Bloco de ajuda do fluxo de Acordo Trabalhista, exibido em DICAS e Como Usar. */
export function AgreementHelpCard() {
  return <section className="page-card agreement-help-card" style={{ marginBottom: 16 }}>
    <span className="eyebrow">Novo fluxo de receitas</span>
    <h2>Acordo Trabalhista</h2>
    <p>Ao clicar em <strong>+ Nova Receita</strong>, escolha entre <strong>Alvará / Receita normal</strong> e <strong>Acordo Trabalhista</strong>. Cada opção abre seu formulário próprio.</p>
    <div className="help-situation-list" style={{ marginTop: 14 }}>
      <div><Handshake size={18} /><span><strong>Acordo Trabalhista:</strong> informe processo, partes, valor bruto do acordo, percentual de honorários, conta de recebimento e dados do cliente.</span></div>
      <div><FileText size={18} /><span><strong>Parcelas:</strong> use <strong>+ Adicionar parcela</strong> para incluir cada parcela. Preencha datas prevista e realizada, valor, honorários, deduções, líquido do cliente e data de contabilização.</span></div>
      <div><Send size={18} /><span><strong>Envio:</strong> anexe acordo e comprovantes, salve como rascunho quando necessário e envie à Tesouraria quando houver recebimento efetivo a confirmar.</span></div>
    </div>
  </section>
}
