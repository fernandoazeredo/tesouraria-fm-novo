import type { DocumentData } from 'firebase/firestore'

export type ReceivableRecord = { id?: string } & DocumentData

export function normalizeReceivableText(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function isAlvaraReceivable(item: ReceivableRecord) {
  const type = normalizeReceivableText(item.tipoRecebimento).replace(/[\s-]+/g, '_')
  if (type === 'outras_receitas' || type === 'acordo_trabalhista') return false

  const origin = normalizeReceivableText(item.origem)
  if (!origin.includes('alvara')) return false

  // Alvará é uma receita vinculada a processo. Registros antigos de teste sem processo
  // não podem alimentar Dashboard nem Repasse de Alvarás.
  if (!String(item.processo ?? '').trim()) return false
  if (!String(item.reclamante ?? '').trim()) return false

  return true
}

export function isEffectiveAlvaraReceivable(item: ReceivableRecord) {
  return ['recebido_tesouraria', 'encerrado'].includes(String(item.status ?? '')) && isAlvaraReceivable(item)
}
