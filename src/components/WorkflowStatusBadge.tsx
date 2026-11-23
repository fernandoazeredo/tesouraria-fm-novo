export type WorkflowTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE_BY_STATUS: Record<string, WorkflowTone> = {
  rascunho: 'neutral',
  enviado_aprovacao: 'info',
  em_analise: 'info',
  aprovado: 'success',
  pago: 'success',
  arquivado: 'success',
  devolvido: 'warning',
  rejeitado: 'danger',
  enviado_tesouraria: 'info',
  recebido_tesouraria: 'info',
  encerrado: 'success',
  pending: 'warning',
  active: 'success',
  inactive: 'neutral',
  blocked: 'danger',
}

export function workflowStatusTone(status: string | undefined | null): WorkflowTone {
  return TONE_BY_STATUS[String(status ?? '')] ?? 'neutral'
}

export function WorkflowStatusBadge({ status, label }: { status: string | undefined | null; label: string }) {
  return <span className={`workflow-status-badge workflow-${workflowStatusTone(status)}`}>{label}</span>
}

/** Cor do selo .status-badge conforme o texto do status (antes aplicada por WorkflowStatusEnhancer). */
const STATUS_CLASS_BY_TEXT: Record<string, string> = {
  'Rascunho': 'workflow-neutral', 'Enviado para Aprovação': 'workflow-info', 'Em Análise': 'workflow-info',
  'Enviado à Tesouraria': 'workflow-info', 'Recebido pela Tesouraria': 'workflow-info', 'Aprovado': 'workflow-success',
  'Pago': 'workflow-success', 'Arquivado': 'workflow-success', 'Encerrado / Arquivado': 'workflow-success',
  'Ativo': 'workflow-success', 'Cadastrado': 'workflow-success', 'Devolvido p/ Correção': 'workflow-warning',
  'Devolvido para Correção': 'workflow-warning', 'Pendente': 'workflow-warning', 'Aguardando cadastro': 'workflow-warning',
  'Rejeitado': 'workflow-danger', 'Bloqueado': 'workflow-danger', 'Inativo': 'workflow-neutral',
}
export function statusTextClass(label: string) {
  return STATUS_CLASS_BY_TEXT[label.trim()] ?? ''
}
