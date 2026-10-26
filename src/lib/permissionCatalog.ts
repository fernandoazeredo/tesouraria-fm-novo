// Catálogo de módulos utilizado pelo futuro painel. Não altera a autorização em produção.
export const PERMISSION_SCHEMA_VERSION = 1
export const modulePaths = {
  dashboard: '/', despesas: '/despesas', receitas: '/alvaras',
  repasse_alvaras: '/repasse-alvaras', repasse_societario: '/repasse-societario',
  nota_fiscal: '/nota-fiscal', comissoes: '/comissoes-agentes',
  tesouraria: '/tesouraria', aprovacoes: '/aprovacoes',
  dre: '/dre-gerencial', plano_contas: '/plano-contas',
  contabilidade: '/contabilidade', calendario: '/calendario-financeiro',
  fluxo_caixa: '/fluxo-caixa', conciliacao: '/conciliacao-bancaria',
  documentos: '/documentos', usuarios: '/usuarios',
  auditoria: '/auditoria', utilitarios: '/utilitarios',
  configuracoes: '/configuracoes',
} as const
export type ModuleId = keyof typeof modulePaths
export type ViewGrant = { ver?: boolean; fazer?: Record<string, boolean> }
export type PermissionDocument = {
  schemaVersion: 1
  modules: Partial<Record<ModuleId, ViewGrant>>
  updatedBy?: string
  updatedAt?: unknown
}
export const defaultRoles: Record<ModuleId, readonly string[]> = {
  dashboard:['master','diretor','gerente','tesouraria','operador'],
  despesas:['master','diretor','gerente','tesouraria','operador'],
  receitas:['master','diretor','gerente','tesouraria','operador'],
  repasse_alvaras:['master','diretor','gerente','tesouraria'],
  repasse_societario:['master','diretor','gerente','tesouraria'],
  nota_fiscal:['master','diretor','gerente','tesouraria'],
  comissoes:['master','diretor','gerente','tesouraria'],
  tesouraria:['master','diretor','gerente','tesouraria'],
  aprovacoes:['master','diretor','gerente','tesouraria','operador'],
  dre:['master','diretor','gerente'],
  plano_contas:['master'],
  contabilidade:['master','diretor','gerente','tesouraria'],
  calendario:['master','diretor','gerente','tesouraria'],
  fluxo_caixa:['master','diretor'],
  conciliacao:['master','diretor','gerente','tesouraria'],
  documentos:['master','diretor','gerente','tesouraria','operador'],
  usuarios:['master'],auditoria:['master'],utilitarios:['master'],configuracoes:['master'],
}
export function effectiveView(id: ModuleId, role: string, email: string, config: PermissionDocument | null | undefined, masterEmail: string, directorEmail: string) {
  const e = email.trim().toLowerCase()
  const master = e === masterEmail && role === 'master'
  if (master) return true
  // Proibição expressa: Socorro não pode ver nem operar Plano de Contas.
  if (id === 'plano_contas' && e === 'socorro@marquesemuller.adv.br') return false
  if (['auditoria','usuarios','configuracoes','utilitarios'].includes(id)) return false
  if (id === 'fluxo_caixa' && !(role === 'diretor' && e === directorEmail)) return false
  if (!defaultRoles[id].includes(role) && id !== 'plano_contas') return false // Sem concessões incompatíveis com as Rules atuais.
  const configured = config?.modules?.[id]?.ver
  return typeof configured === 'boolean' ? configured : defaultRoles[id].includes(role)
}

/** Apenas consulta, até homologação da Etapa 3. Não concede operações. */
export function canDecideApproval(role: string, email: string, masterEmail: string, directorEmail: string) {
  const value = email.trim().toLowerCase()
  return (role === 'master' && value === masterEmail) || (role === 'diretor' && value === directorEmail)
}
export function firestoreViewSupported(id: ModuleId, role: string) {
  return id === 'plano_contas' || defaultRoles[id].includes(role)
}
