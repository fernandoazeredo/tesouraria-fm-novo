/**
 * Regras de edição de receitas (Recebimento de Alvarás).
 *
 * Espelham exatamente o que `originReceivableUpdate()` em firestore.rules
 * já autoriza para a área de origem:
 *   - rascunho  → rascunho | enviado_tesouraria
 *   - devolvido → devolvido | enviado_tesouraria
 * Receitas enviadas, recebidas ou encerradas não são editáveis pela origem.
 */

export type ReceivableEditMode = 'draft' | 'returned'
export type ReceivableSaveStatus = 'rascunho' | 'devolvido' | 'enviado_tesouraria'

export const RECEIVABLE_EDITOR_ROLES = ['master', 'gerente', 'operador'] as const

const ALLOWED_TRANSITIONS: Record<string, ReceivableSaveStatus[]> = {
  rascunho: ['rascunho', 'enviado_tesouraria'],
  devolvido: ['devolvido', 'enviado_tesouraria'],
}

export function receivableEditMode(status: unknown): ReceivableEditMode | null {
  if (status === 'rascunho') return 'draft'
  if (status === 'devolvido') return 'returned'
  return null
}

export function canEditReceivable(record: Record<string, unknown> | null | undefined, role: unknown): boolean {
  if (!record) return false
  if (!RECEIVABLE_EDITOR_ROLES.includes(String(role ?? '') as typeof RECEIVABLE_EDITOR_ROLES[number])) return false
  // Acordos trabalhistas e outras receitas (tipoRecebimento preenchido) possuem
  // formulários próprios; este editor atende somente o Demonstrativo de Alvarás.
  if (record.tipoRecebimento) return false
  return receivableEditMode(record.status) !== null
}

export function isAllowedReceivableTransition(fromStatus: unknown, toStatus: ReceivableSaveStatus): boolean {
  return (ALLOWED_TRANSITIONS[String(fromStatus ?? '')] ?? []).includes(toStatus)
}

export type StoredComponent = { nome: string; percentual: number; valor: number; detalhe?: string }

/**
 * Reconstrói a composição salva sobre a lista padrão do formulário,
 * preservando a ordem padrão, os valores e percentuais gravados e os
 * campos adicionais dinâmicos existentes no documento.
 */
export function restoreComponents(defaults: StoredComponent[], stored: unknown): StoredComponent[] {
  const saved = Array.isArray(stored) ? stored.filter((item): item is StoredComponent => Boolean(item) && typeof item.nome === 'string') : []
  const byName = new Map(saved.map((item) => [item.nome, item]))
  const base = defaults.map((item) => {
    const match = byName.get(item.nome)
    return match ? { ...item, percentual: Number(match.percentual) || 0, valor: Number(match.valor) || 0, ...(match.detalhe !== undefined || item.detalhe !== undefined ? { detalhe: match.detalhe ?? '' } : {}) } : { ...item }
  })
  const defaultNames = new Set(defaults.map((item) => item.nome))
  const extras = saved.filter((item) => !defaultNames.has(item.nome)).map((item) => ({ nome: item.nome, percentual: Number(item.percentual) || 0, valor: Number(item.valor) || 0, detalhe: item.detalhe ?? '' }))
  return [...base, ...extras]
}

export function receivableAuditAction(mode: ReceivableEditMode | null, status: ReceivableSaveStatus): string {
  if (!mode) return status === 'rascunho' ? 'Receita salva como rascunho' : 'Receita enviada à Tesouraria'
  if (mode === 'draft') return status === 'rascunho' ? 'Rascunho de receita editado' : 'Rascunho de receita enviado à Tesouraria'
  return status === 'devolvido' ? 'Receita devolvida corrigida' : 'Receita corrigida reenviada à Tesouraria'
}

/** Campos que nunca podem ser sobrescritos numa edição. */
export const IMMUTABLE_RECEIVABLE_FIELDS = ['createdAt', 'createdBy', 'createdByName'] as const

export function stripImmutableFields<T extends Record<string, unknown>>(payload: T): Omit<T, typeof IMMUTABLE_RECEIVABLE_FIELDS[number]> {
  const copy: Record<string, unknown> = { ...payload }
  for (const key of IMMUTABLE_RECEIVABLE_FIELDS) delete copy[key]
  return copy as Omit<T, typeof IMMUTABLE_RECEIVABLE_FIELDS[number]>
}
