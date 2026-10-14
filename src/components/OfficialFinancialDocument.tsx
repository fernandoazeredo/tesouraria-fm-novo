import { useState, type ReactNode } from 'react'
import type { DocumentData } from 'firebase/firestore'
import { X, FileText } from 'lucide-react'
import './OfficialFinancialDocument.css'

export type OfficialDocumentKind = 'expense' | 'revenue' | 'alvaraTransfer' | 'commission' | 'societaryTransfer'
export type FinancialDocumentRecord = { id: string } & DocumentData

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const val = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text || '—'
}
const money = (value: unknown) => brl.format(num(value))
const dateBR = (value: unknown) => {
  const text = String(value ?? '')
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? match[3] + '/' + match[2] + '/' + match[1] : val(value)
}
type Field = { label: string; value: string }
function Fields({ fields }: { fields: Field[] }) {
  return <div className="ofd-fields">{fields.map((f, i) => <div className="ofd-field" key={i}><span>{f.label}</span><strong>{f.value}</strong></div>)}</div>
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ofd-section"><h3 className="form-section-title">{title}</h3>{children}</section>
}
function GridTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return <table className="ofd-table"><thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>
}
export function OfficialFinancialDocument({ kind, record, emittedAt }: { kind: OfficialDocumentKind; record: FinancialDocumentRecord; emittedAt?: string }) {
  const r = record
  const snapshot = r.sourceSnapshot || {}
  const title = kind === 'expense' ? 'DEMONSTRATIVO DE DESPESAS'
    : kind === 'revenue' ? 'DEMONSTRATIVO DE RECEBIMENTO DE HONORÁRIOS'
    : kind === 'commission' ? 'DEMONSTRATIVO DE COMISSÃO DE AGENTE'
    : kind === 'societaryTransfer' ? 'DEMONSTRATIVO DE REPASSE SOCIETÁRIO'
    : 'DEMONSTRATIVO DE REPASSE DE ALVARÁ'
  const styleClass = kind === 'expense' || kind === 'commission' ? 'expense' : 'revenue'
  const components: DocumentData[] = Array.isArray(r.components) ? r.components : []
  const items: DocumentData[] = Array.isArray(r.items) ? r.items : []
  const installments: DocumentData[] = Array.isArray(r.installments) ? r.installments : []
  const deductions: DocumentData[] = Array.isArray(r.deductions) ? r.deductions : []
  const paid = installments.filter((line) => line?.paid === true).reduce((sum, line) => sum + num(line?.value), 0)
  const emitted = emittedAt || String(r.demonstrativeGeneratedAt || new Date().toISOString())
  return <article className={'ofd-sheet ofd-' + styleClass}>
    <div className="ofd-head">
      <img className="ofd-logo" src="/logo-fm.svg" alt="Flávio Marques Advogados Associados" />
      <div><strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong><span>{title}</span></div>
    </div>
    {kind === 'revenue' ? <>
      <Section title="Dados do Processo">
        <Fields fields={[
          { label: 'Unidade', value: val(r.unidade) }, { label: 'Data', value: dateBR(r.data) },
          { label: 'Natureza', value: val(r.natureza) }, { label: 'Número do processo', value: val(r.processo) },
          { label: 'Reclamada', value: val(r.reclamada) }, { label: 'Reclamante', value: val(r.reclamante) },
          { label: 'Origem', value: val(r.origem) }, { label: 'Forma de recebimento', value: val(r.formaRecebimento) },
          { label: 'Data prevista', value: dateBR(r.dataPrevista) },
        ]} />
      </Section>
      <Section title="Composição do Valor">
        <GridTable columns={['Componente', 'Percentual (%)', 'Valor (R$)']} rows={[
          ['Valor Líquido do Alvará', '100%', money(r.valorAlvara)],
          ['Base Cálculo Honorários (Valor Bruto)', '—', money(r.baseCalculo)],
          ...components.map((c) => [val(c.nome) + (c.detalhe ? ' — ' + val(c.detalhe) : ''), num(c.percentual).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%', money(c.valor)]),
          ['Total de descontos / repasses', '—', money(r.totalDeducoes)],
          ['VALOR LÍQUIDO DEVIDO AO CLIENTE', '—', money(r.valorLiquidoCliente)],
        ]} />
      </Section>
      <Section title="Dados bancários para crédito do cliente">
        <Fields fields={[
          { label: 'Banco', value: val(r.banco) }, { label: 'Agência', value: val(r.agencia) },
          { label: 'Conta', value: val(r.conta) }, { label: 'Nome / Titular', value: val(r.titular) },
          { label: 'CPF', value: val(r.cpf) }, { label: 'PIX', value: val(r.pix) },
        ]} />
      </Section>
      <Section title="Dados para emissão de Nota Fiscal">
        <Fields fields={[{ label: 'Endereço', value: val(r.enderecoNf) }, { label: 'E-mail', value: val(r.emailNf) },
          { label: 'Honorários do Escritório', value: money(r.invoiceValue) },
          { label: 'Comissão / Participação do Agente', value: money(r.agentCommissionValue) }]} />
      </Section>
      <Section title="Recebimento pelo escritório">
        <Fields fields={[{ label: 'Conta', value: val(r.receivingBankAccount?.bank) + ' · Ag. ' + val(r.receivingBankAccount?.agency) + ' · C/C ' + val(r.receivingBankAccount?.account) },
          { label: 'Data do recebimento', value: dateBR(r.receiptDate || r.data) },
          { label: 'Status', value: val(r.status) }, { label: 'Confirmado por', value: val(r.treasuryByName || r.treasuryBy) }]} />
      </Section>
    </> : kind === 'expense' ? <>
      <Section title="Dados do Lançamento">
        <Fields fields={[
          { label: 'Competência', value: val(r.competencia) }, { label: 'Unidade', value: val(r.unidade) },
          { label: 'Responsável', value: val(r.nome) }, { label: 'Fornecedor / Favorecido', value: val(r.fornecedor) },
          { label: 'CPF / CNPJ', value: val(r.documento) },
          { label: 'Plano de Contas', value: val(r.expenseAccountCode || r.classificacaoContabil) },
          { label: 'Descrição da Conta', value: val(r.expenseAccountName || r.categoria) },
          { label: 'DRE', value: val(r.expenseAccountDre) },
        ]} />
      </Section>
      <Section title="Itens da Despesa">
        <GridTable columns={['Data', 'Histórico', 'Valor']} rows={[
          ...items.map((i) => [dateBR(i.data), val(i.historico), money(i.valor)]),
          ['TOTAL DA DESPESA', '', money(r.valorTotal)],
        ]} />
      </Section>
      <Section title="Pagamento e Aprovação">
        <Fields fields={[
          { label: 'Vencimento', value: dateBR(r.paymentDueDate || r.vencimento) },
          { label: 'Data do pagamento', value: dateBR(r.paymentDate) },
          { label: 'Conta de pagamento', value: val(r.paymentBankAccount?.bank) + ' · Ag. ' + val(r.paymentBankAccount?.agency) + ' · C/C ' + val(r.paymentBankAccount?.account) },
          { label: 'Forma de pagamento', value: val(r.paymentMethod) },
          { label: 'Status', value: val(r.status) }, { label: 'Aprovado por', value: val(r.approvedByName || r.decisionByName) },
          { label: 'Pago por', value: val(r.paidByName) }, { label: 'Observações', value: val(r.observacoes || r.observation) },
        ]} />
      </Section>
    </> : <>
      <Section title="Identificação">
        <Fields fields={[
          { label: 'Processo', value: val(r.processo || snapshot.processo) },
          { label: 'Reclamante', value: val(r.reclamante || snapshot.reclamante) },
          { label: 'Reclamada', value: val(r.reclamada || snapshot.reclamada) },
          { label: 'Beneficiário', value: val(r.beneficiary || snapshot.titular || snapshot.agentName) },
          { label: 'Unidade', value: val(r.unidade || snapshot.unidade) },
        ]} />
      </Section>
      <Section title={kind === 'commission' ? 'Comissão e Deduções' : kind === 'alvaraTransfer' ? 'Repasse ao Cliente' : 'Repasse Societário'}>
        <Fields fields={kind === 'commission'
          ? [{ label: 'Comissão Bruta', value: money(r.grossAmount) }, { label: 'Total de Deduções', value: money(r.deductionTotal) }, { label: 'Valor Líquido Devido', value: money(r.netAmountDue || r.amountDue) }]
          : kind === 'societaryTransfer'
            ? [{ label: 'Honorários do Escritório', value: money(r.officeFees) }, { label: 'Percentual', value: num(r.percent).toLocaleString('pt-BR') + '%' }, { label: 'Valor do Repasse', value: money(r.transferValue) }]
            : [{ label: 'Valor Recebido', value: money(r.amountReceived) }, { label: 'Valor Devido ao Cliente', value: money(r.amountDue) }]} />
        {kind === 'commission' && deductions.length > 0 && <GridTable columns={['Data', 'Dedução / Motivo', 'Valor']} rows={deductions.map((d) => [dateBR(d.date), val(d.description), money(d.value)])} />}
      </Section>
      <Section title="Parcelas e Pagamentos">
        <GridTable columns={['Parcela', 'Valor', 'Data Prevista', 'Status', 'Data do Pagamento']} rows={installments.map((row, index) =>
          [String(num(row.number) || index + 1), money(row.value), dateBR(row.dueDate), val(row.status), dateBR(row.paidDate)])} />
        <Fields fields={[{ label: 'Total já pago', value: money(r.paidValue || paid) },
          { label: 'Referência bancária', value: val(r.paymentReference) }, { label: 'Status', value: val(r.status) },
          { label: 'Pago por', value: val(r.paidByName || r.updatedByName) }]} />
      </Section>
    </>}
    <footer className="ofd-foot">
      <span>Documento oficial — Tesouraria FM NOVO</span>
      <span>Emitido em {new Date(emitted).toLocaleString('pt-BR')}</span>
    </footer>
  </article>
}

export function OfficialFinancialDocumentPreviewButton({ kind, record }: { kind: OfficialDocumentKind; record: FinancialDocumentRecord }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="small-neutral-button" type="button" onClick={() => setOpen(true)}><FileText size={14} /> Visualizar demonstrativo</button>
    {open && <div className="modal-backdrop ofd-preview-backdrop" role="presentation">
      <section className="ofd-preview-dialog" role="dialog" aria-modal="true" aria-label="Prévia do demonstrativo">
        <div className="ofd-preview-toolbar"><strong>Prévia do demonstrativo — mesmo componente utilizado no PDF</strong>
          <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
        <OfficialFinancialDocument kind={kind} record={record} emittedAt={String(record.demonstrativeGeneratedAt || '') || undefined} />
      </section>
    </div>}
  </>
}
