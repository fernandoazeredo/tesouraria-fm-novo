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
  configuracoes: '/configuracoes', ia: '/ia',
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
  ia:['master'],
}
const ALL_ROLES = ['master','diretor','gerente','tesouraria','operador'] as const
/** Perfis aos quais o Fernando pode liberar o módulo (compatível com as Rules). Sem entrada = mesmo que o padrão. */
const grantableRoles: Partial<Record<ModuleId, readonly string[]>> = {
  plano_contas: ALL_ROLES, ia: ALL_ROLES,
  fluxo_caixa: ['master','diretor','gerente','tesouraria'],
}
export const canGrant = (id: ModuleId, role: string) => (grantableRoles[id] ?? defaultRoles[id]).includes(role)
const REINALDO = 'reinaldo@marquesemuller.adv.br'
const SOCORRO = 'socorro@marquesemuller.adv.br'
const FLAVIO = 'flavio.marques@marquesemuller.adv.br'
/** Reinaldo (Jurídico): todas as receitas/alvarás, repasse de alvarás e comissões de agentes. */
export const REINALDO_MODULES: readonly ModuleId[] = ['receitas', 'repasse_alvaras', 'comissoes', 'aprovacoes']
/** Flávio (Diretor): tudo, exceto IA, DRE, Plano de Contas, Contabilidade, administração, Documentos e Conciliação. */
export const FLAVIO_BLOCKED: readonly ModuleId[] = ['ia', 'dre', 'plano_contas', 'contabilidade', 'usuarios', 'auditoria', 'utilitarios', 'configuracoes', 'documentos', 'conciliacao']
/** Padrão por pessoa (definido pelo Fernando). Só vale enquanto o Fernando não marcar/desmarcar o módulo em Configurações. */
export function personDefaultBlocked(id: ModuleId, rawEmail: string) {
  const e = rawEmail.trim().toLowerCase()
  if (e === REINALDO && !REINALDO_MODULES.includes(id)) return 'Reinaldo (Jurídico): somente Receitas, Repasse de Alvarás e Comissões'
  if (e === FLAVIO && FLAVIO_BLOCKED.includes(id)) return 'Não liberado para o Flávio'
  if (e === SOCORRO && id === 'plano_contas') return 'Não permitido para a Socorro'
  return ''
}
export function effectiveView(id: ModuleId, role: string, email: string, config: PermissionDocument | null | undefined, masterEmail: string, directorEmail: string) {
  const e = email.trim().toLowerCase()
  const master = e === masterEmail && role === 'master'
  if (master) return true
  // A fila de Aprovações é visível para todos os perfis ativos, nunca decisória por esse motivo.
  if (id === 'aprovacoes') return true
  if (['auditoria','usuarios','configuracoes','utilitarios'].includes(id)) return false
  void directorEmail
  if (!canGrant(id, role)) return false // Sem concessões incompatíveis com as Rules atuais.
  const configured = config?.modules?.[id]?.ver
  if (typeof configured === 'boolean') return configured
  if (personDefaultBlocked(id, e)) return false
  return defaultRoles[id].includes(role)
}

/** Apenas consulta, até homologação da Etapa 3. Não concede operações. */
export function canDecideApproval(role: string, email: string, masterEmail: string, directorEmail: string) {
  const value = email.trim().toLowerCase()
  return (role === 'master' && value === masterEmail) || (role === 'diretor' && value === directorEmail)
}
/** Documento de permissões salvo antes do primeiro acesso (por e-mail). */
export const pendingPermissionDocId = (email: string) => 'email:' + email.trim().toLowerCase()
export function firestoreViewSupported(id: ModuleId, role: string) {
  return canGrant(id, role)
}
