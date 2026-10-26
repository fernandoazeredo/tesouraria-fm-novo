import { jsPDF } from 'jspdf'
import type { Movement } from './cashFlowMovements'

type Report = {
  month: string
  monthTitle: string
  account: string
  user: string
  issuedAt: Date
  actualIn: number
  actualOut: number
  plannedIn: number
  plannedOut: number
  pending: number
  noDate: Movement[]
  pfExcluded: number
  validationIssues: string[]
  movements: Movement[]
}
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateBR = (s: string) => s ? s.split('-').reverse().join('/') : 'Sem data'
export function downloadCashFlowPdf(r: Report) {
  const pdf = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait', compress: true })
  const pw = 210, ph = 297, margin = 14, right = pw - margin, content = right - margin
  let y = 15
  const lineH = 4.8
  const page = () => { pdf.addPage(); y = 16 }
  const ensure = (height: number) => { if (y + height > ph - 17) page() }
  const lines = (value: string, maxWidth = content, fontSize = 9) => {
    pdf.setFontSize(fontSize)
    return pdf.splitTextToSize(value, maxWidth) as string[]
  }
  const text = (value: string, opts: { bold?: boolean; size?: number; indent?: number } = {}) => {
    const size = opts.size ?? 9, x = margin + (opts.indent ?? 0)
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    const wrapped = lines(value, content - (opts.indent ?? 0), size)
    const spacing = size <= 8 ? 4 : lineH
    ensure(wrapped.length * spacing + 2)
    pdf.text(wrapped, x, y)
    y += wrapped.length * spacing + 2
  }
  const heading = (value: string) => { ensure(11); y += 3; text(value, { bold: true, size: 11 }) }
  const summary = (label: string, incoming: number, outgoing: number, resultLabel: string) => {
    heading(label)
    text('Entradas: ' + brl.format(incoming))
    text('Saídas: ' + brl.format(outgoing))
    text(resultLabel + ': ' + brl.format(incoming - outgoing), { bold: true })
  }
  text('FLÁVIO MARQUES ADVOGADOS ASSOCIADOS — Fluxo de Caixa Mensal', { bold: true, size: 13 })
  text('Referência: ' + r.monthTitle + ' (' + r.month + ') · Conta: ' + r.account)
  text('Emissão: ' + r.issuedAt.toLocaleString('pt-BR') + ' · Usuário: ' + r.user)
  pdf.setDrawColor(160); pdf.line(margin, y, right, y); y += 5
  heading('Fase 1 — demonstrativo gerencial, não saldo bancário')
  text('Os valores seguem os registros existentes, não um extrato conciliado. Não há saldo inicial ou projeção de saldo final. Recebimentos realizados usam a data declarada no lançamento; a data efetiva do crédito pode ser diferente. Operações sem conta identificada ficam separadas para evitar atribuição indevida ao Itaú PJ.')
  summary('Realizado · ' + r.monthTitle, r.actualIn, r.actualOut, 'Resultado do mês')
  summary('Previsto · ' + r.monthTitle, r.plannedIn, r.plannedOut, 'Resultado previsto')
  heading('Conciliação necessária')
  text(r.pending + ' movimentações do mês sem conta identificada.')
  text('Valores não presumidos como Itaú PJ.')
  text(r.noDate.length + ' registros sem data válida (fora dos totais mensais).')
  text(r.pfExcluded + ' movimentações em contas PF excluídas do Itaú PJ.')
  if (r.validationIssues.length) {
    heading('Inconsistências de parcelas')
    r.validationIssues.forEach(t => text('• ' + t))
  }
  if (r.noDate.length) {
    heading('Previsto/realizado sem data — fora dos totais')
    text('Inclui repasses societários aprovados sem vencimento cadastrado. Não há atribuição artificial a nenhum mês.')
    r.noDate.forEach(m => text(m.origin + ' · ' + m.description + ' · ' + brl.format(m.value) + ' (' + m.stage + ')'))
  }
  heading('Movimentações — ' + r.monthTitle)
  // Cada registro é uma linha lógica: calcular altura antes de desenhar para não cortar entre páginas.
  const widths = [18, 29, 62, 18, 20, 35]
  const xs = widths.reduce<number[]>((a, w, i) => { a.push(i ? a[i-1] + widths[i-1] : margin); return a }, [])
  const headers = ['Data', 'Origem', 'Descrição', 'Tipo', 'Etapa', 'Valor']
  const tableHeader = () => {
    ensure(9)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7)
    headers.forEach((h, i) => pdf.text(h, xs[i] + 1, y))
    y += 5; pdf.setDrawColor(165); pdf.line(margin, y - 2, right, y - 2)
  }
  tableHeader()
  if (!r.movements.length) text('Nenhum lançamento com data e conta bancária compatíveis com os filtros selecionados.')
  for (const m of r.movements) {
    const description = m.description + (m.alternativeDate ? ' · data alternativa' : '') + (m.treasuryDate ? ' · Tesouraria: ' + dateBR(m.treasuryDate) + (m.treasuryDate !== m.date ? ' · datas diferentes' : '') : '')
    const values = [dateBR(m.date), m.origin, description, m.direction === 'entrada' ? 'Entrada' : 'Saída', m.stage === 'realizado' ? 'Realizado*' : 'Previsto', brl.format(m.value)]
    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal')
    const wrapped = values.map((v, i) => pdf.splitTextToSize(v, widths[i] - 2) as string[])
    const rowH = Math.max(6, Math.max(...wrapped.map(a => a.length)) * 3.5 + 2)
    if (y + rowH > ph - 17) { page(); tableHeader() }
    wrapped.forEach((v, i) => pdf.text(v, xs[i] + 1, y + 2))
    y += rowH
    pdf.setDrawColor(225); pdf.line(margin, y - 1, right, y - 1)
  }
  heading('Notas')
  text('* Realizado significa status financeiro registrado no aplicativo; não substitui a conciliação com extrato. Registros sem data válida não entram no total. Repasses e comissões não são descontados novamente do valor bruto do recebimento: aparecem como saídas próprias.')
  const count = pdf.getNumberOfPages()
  for (let i = 1; i <= count; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text('Página ' + i + ' de ' + count, right, ph - 9, { align: 'right' }) }
  pdf.save('Fluxo_de_Caixa_' + r.month + '_' + r.account.replace(/[^a-z0-9]/gi, '_') + '.pdf')
}
