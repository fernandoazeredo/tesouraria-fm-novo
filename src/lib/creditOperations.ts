import type { DocumentData } from 'firebase/firestore'

export type OperationRecord = { id: string } & DocumentData

/** Prioritize the immutable source relationship. Process number is a fallback only
 * when it identifies exactly one receivable; never merge unrelated operations. */
export function receivableForFinancialPlan(plan: OperationRecord, receivables: OperationRecord[]): OperationRecord | null {
  const sourceId = String(plan.sourceReceivableId || plan.sourceId || '').trim()
  if (sourceId) return receivables.find((r) => r.id === sourceId) || null
  const idMatch = receivables.find((r) => r.id === plan.id)
  if (idMatch) return idMatch
  const process = String(plan.processo || plan.sourceSnapshot?.processo || '').trim()
  if (!process) return null
  const matches = receivables.filter((r) => String(r.processo || '').trim() === process)
  return matches.length === 1 ? matches[0] : null
}

/** No matching receivable means the plan gets its own explicit dossier, never
 * a forced association based on a non-unique process number. */
export function creditKey(plan: OperationRecord, receivables: OperationRecord[]): string {
  const source = receivableForFinancialPlan(plan, receivables)
  return source ? 'receivable:' + source.id : 'unlinked:' + plan.id
}

export function creditFolder(record: OperationRecord): string {
  const safe = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-dado'
  return 'Creditos/' + safe(String(record.processo || record.sourceSnapshot?.processo || 'sem-processo'))
    + '_' + safe(String(record.reclamante || record.sourceSnapshot?.reclamante || 'cliente'))
    + '_' + safe(String(record.id))
}
