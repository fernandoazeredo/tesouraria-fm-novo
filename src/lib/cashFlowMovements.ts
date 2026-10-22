/** Pure, read-only cash-flow classification logic. No Firebase calls. */
export type RecordRow = { id: string } & DocumentData
export type Movement = { id: string; origin: string; description: string; date: string; value: number; direction: 'entrada' | 'saida'; stage: 'realizado' | 'previsto'; bank: 'itau' | 'outro' | 'indefinido'; observation?: string; treasuryDate?: string; alternativeDate?: boolean }
const bankOf = (raw: unknown): Movement['bank'] => raw === 'itau' || raw === 'itau-pj' ? 'itau' : raw === 'bb' || raw === 'bb-pf' || raw === 'cef' || raw === 'cef-pf' ? 'outro' : 'indefinido'
const dateOf = (raw: unknown) => { const value = typeof raw === 'string' ? raw.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' }
const timestampDate = (raw: unknown) => { if (!raw || typeof raw !== 'object') return ''; const v = raw as {toDate?: () => Date; seconds?: number}; const d = typeof v.toDate === 'function' ? v.toDate() : typeof v.seconds === 'number' ? new Date(v.seconds * 1000) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '' }
const numberOf = (raw: unknown) => { const value = Number(raw); return Number.isFinite(value) && value > 0 ? value : 0 }
export function movements(receivables: RecordRow[], expenses: RecordRow[], alvaraTransfers: RecordRow[], agentCommissions: RecordRow[], societaryTransfers: RecordRow[]) {
  const output: Movement[] = []
  for (const item of receivables) {
    const bank = bankOf(item.receivingBankAccountId)
    const description = String(item.processo || item.reclamante || item.descricao || 'Receita')
    if (String(item.tipoRecebimento) === 'acordo_trabalhista') {
      const status = String(item.status || '')
      if (!['recebido_tesouraria', 'encerrado', 'enviado_tesouraria'].includes(status)) continue
      const confirmed = status === 'recebido_tesouraria' || status === 'encerrado'
      const parts = Array.isArray(item.parcelas) ? item.parcelas as Record<string, any>[] : []
      parts.forEach((part, i) => {
        const actualDate = confirmed ? dateOf(part.dataRealizada) : ''
        const date = actualDate || dateOf(part.dataPrevista)
        const value = numberOf(part.valorParcela)
        if (value) output.push({ id: 'acordo-' + item.id + '-' + i, origin: 'Acordo Trabalhista', description: description + ' · parcela ' + (i + 1), date, value, direction: 'entrada', stage: actualDate ? 'realizado' : 'previsto', bank, observation: 'Valor individual da parcela do acordo; confirmação conforme status da receita' })
      })
      continue
    }
    const status = String(item.status || '')
    if (!['recebido_tesouraria', 'encerrado', 'enviado_tesouraria'].includes(status)) continue
    const stage = status === 'enviado_tesouraria' ? 'previsto' : 'realizado'
    const primaryDate = dateOf(item.receiptDate)
    const date = stage === 'realizado' ? primaryDate || dateOf(item.data) : dateOf(item.dataPrevista)
    const value = numberOf(item.valorAlvara)
    const treasuryDate = timestampDate(item.treasuryAt) || dateOf(item.treasuryAt)
    if (value) output.push({ id: 'receita-' + item.id, origin: 'Recebimentos', description, date, value, direction: 'entrada', stage, bank, treasuryDate, alternativeDate: stage === 'realizado' && !primaryDate && !!date, observation: stage === 'realizado' ? 'Data informada: ' + (primaryDate || date || 'ausente') + (primaryDate ? '' : ' (alternativa)') + ' · confirmação da Tesouraria: ' + (treasuryDate || 'não registrada') + (treasuryDate && date && treasuryDate !== date ? ' · DATAS DIFERENTES' : '') : 'Data prevista de recebimento' })
  }
  for (const item of expenses) {
    const status = String(item.status || '')
    const stage = ['pago', 'arquivado'].includes(status) ? 'realizado' : 'previsto'
    if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria', 'agendado'].includes(status)) continue
    const date = dateOf(item.paymentDate)
    const value = numberOf(item.valorTotal)
    if (value) output.push({ id: 'despesa-' + item.id, origin: 'Despesas', description: String(item.fornecedor || item.nome || 'Despesa'), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: stage === 'previsto' ? 'Data informada no campo de movimentação financeira' : undefined })
  }
  const installmentRows = (items: RecordRow[], origin: string) => {
    for (const item of items) {
      const status = String(item.status || '')
      if (['cancelado', 'rejeitado', 'devolvido'].includes(status)) continue
      const installments = Array.isArray(item.installments) ? item.installments as Record<string, any>[] : []
      for (let index = 0; index < installments.length; index++) {
        const part = installments[index]
        const stage = part.paid === true || part.status === 'paga' ? 'realizado' : 'previsto'
        if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria', 'parcialmente_pago', 'pago'].includes(status)) continue
        const date = dateOf(stage === 'realizado' ? part.paidDate : part.dueDate)
        const value = numberOf(part.value)
        if (value) output.push({ id: origin + item.id + '-' + index, origin, description: String(item.processo || item.sourceSnapshot?.processo || 'Parcela') + ' · parcela ' + (index + 1), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: 'Conta bancária não identificada quando ausente no registro' })
      }
    }
  }
  installmentRows(alvaraTransfers, 'Repasse de Alvarás')
  installmentRows(agentCommissions, 'Comissões de Agentes')
  for (const item of societaryTransfers) {
    const status = String(item.status || '')
    if (['cancelado', 'rejeitado', 'devolvido'].includes(status)) continue
    const stage = status === 'pago' ? 'realizado' : 'previsto'
    if (stage === 'previsto' && !['aprovado', 'enviado_tesouraria'].includes(status)) continue
    const date = dateOf(stage === 'realizado' ? item.paymentDate : item.dueDate)
    const value = stage === 'realizado' ? numberOf(item.paidValue || item.transferValue) : Math.max(0, numberOf(item.transferValue) - numberOf(item.paidValue))
    if (value) output.push({ id: 'societario-' + item.id, origin: 'Repasse Societário', description: String(item.processo || item.beneficiary || 'Repasse societário'), date, value, direction: 'saida', stage, bank: bankOf(item.paymentBankAccountId), observation: 'Conta bancária não identificada quando ausente no registro' })
  }
  return output
}
export function validatePlan(item: RecordRow) { const parts = Array.isArray(item.installments) ? item.installments as Record<string, any>[] : []; if (!parts.length) return []; const errors: string[] = []; const total = parts.reduce((sum, p) => sum + numberOf(p.value), 0); const paid = parts.filter(p => p.paid === true || p.status === 'paga').reduce((sum, p) => sum + numberOf(p.value), 0); if (Math.abs(total - numberOf(item.amountDue)) > 0.02) errors.push('Soma das parcelas difere do valor devido'); if (Math.abs(paid - Number(item.paidValue || 0)) > 0.02) errors.push('Valor pago difere da soma das parcelas pagas'); return errors }

