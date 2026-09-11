import { useEffect, useState } from 'react'
import { AlertTriangle, BadgeCheck, Eye, FileCheck2, X } from 'lucide-react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, type DocumentData } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { PRIMARY_ADMIN_EMAIL, isOfficialDirectorEmail, useAuth } from '../auth/AuthContext'
import { WorkflowStatusBadge } from '../components/WorkflowStatusBadge'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
type AnyRecord = { id: string } & DocumentData
type DecisionStatus = 'devolvido' | 'rejeitado'

const expenseStatusLabels: Record<string, string> = {
  enviado_aprovacao: 'Enviado para Aprovação',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido p/ Correção',
  rejeitado: 'Rejeitado',
}

function expenseBeneficiary(item: AnyRecord) {
  return String(item.fornecedor || item.favorecido || item.nomeFornecedor || item.nomeFavorecido || item.nome || 'Demonstrativo de despesa')
}

function useExpenses() {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, 'expenses'), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, () => setRecords([])), [])
  return records
}

async function writeAudit(profile: ReturnType<typeof useAuth>['profile'], action: string, detail: string, entityId: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), {
    action,
    module: 'Aprovações',
    detail,
    entityId,
    userId: profile.uid,
    userName: profile.displayName,
    userEmail: profile.email,
    createdAt: serverTimestamp(),
  })
}

export function ApprovalsPageEnhanced() {
  const { profile } = useAuth()
  const email = profile?.email?.trim().toLowerCase() ?? ''
  const isDirector = isOfficialDirectorEmail(email) && profile?.role === 'diretor'
  const isMasterTester = email === PRIMARY_ADMIN_EMAIL && profile?.role === 'master'
  const canDecide = isDirector || isMasterTester
  const records = useExpenses()
  const queue = records.filter((item) => ['enviado_aprovacao', 'em_analise'].includes(item.status))
  const [decision, setDecision] = useState<{ item: AnyRecord; status: DecisionStatus } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function approve(item: AnyRecord) {
    if (!canDecide) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'expenses', item.id), {
        status: 'aprovado',
        approvalNote: null,
        decisionBy: profile?.uid,
        decisionByName: profile?.displayName,
        decisionByEmail: profile?.email,
        decisionAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const actor = profile?.displayName || profile?.email || 'Usuário autorizado'
      await writeAudit(profile, 'Despesa: Aprovado', `${expenseBeneficiary(item)} — ${money.format(Number(item.valorTotal ?? 0))} — Autorizado por ${actor}`, item.id)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDecision() {
    if (!canDecide || !decision) return
    if (!reason.trim()) { showRequiredFieldErrors('.decision-modal', ['approval-reason']); return }
    clearRequiredFieldErrors('.decision-modal')
    setBusy(true)
    try {
      const label = expenseStatusLabels[decision.status]
      const detail = `${expenseBeneficiary(decision.item)} — ${money.format(Number(decision.item.valorTotal ?? 0))} — Motivo/justificativa: ${reason.trim()}`
      await updateDoc(doc(db, 'expenses', decision.item.id), {
        status: decision.status,
        approvalNote: reason.trim(),
        decisionBy: profile?.uid,
        decisionByName: profile?.displayName,
        decisionByEmail: profile?.email,
        decisionAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await writeAudit(profile, `Despesa: ${label}`, detail, decision.item.id)
      setDecision(null)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  function openDecision(item: AnyRecord, status: DecisionStatus) {
    if (!canDecide) return
    setReason('')
    setDecision({ item, status })
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Fluxo de aprovação</span><h1>Aprovações</h1><p>Todos os colaboradores ativos podem acompanhar a fila. Flávio Marques é o autorizador oficial de pagamentos; o Administrador Master Fernando possui as mesmas ações para testes e homologação do sistema.</p></div></div>
    {!canDecide && <div className="warning-box"><Eye size={18} /><span><strong>Modo consulta:</strong> você pode acompanhar todos os itens da fila de aprovação, mas não pode Aprovar, Devolver ou Rejeitar.</span></div>}
    {isMasterTester && <div className="warning-box"><BadgeCheck size={18} /><span><strong>Modo Master de homologação:</strong> você pode Aprovar, Devolver e Rejeitar para testar integralmente o fluxo. Todas as decisões ficam registradas na Auditoria com seu usuário.</span></div>}
    <section className="page-card module-card approval-card">
      {queue.length === 0 ? <div className="module-empty"><FileCheck2 size={34} /><strong>Nenhuma aprovação pendente</strong><span>As despesas enviadas ou reenviadas pela operação aparecerão nesta fila.</span></div> : <div className="approval-list">{queue.map((item) => <article className="approval-item" key={item.id}><div><WorkflowStatusBadge status={item.status} label={expenseStatusLabels[item.status] || item.status} /><h3>{expenseBeneficiary(item)}</h3><p>{item.cpfCnpj || item.cnpjCpf || 'Documento não informado'} · {item.competencia || 'Sem competência'} · {item.categoria || 'Sem categoria'}</p></div><strong className="expense-text">{money.format(Number(item.valorTotal ?? 0))}</strong>{canDecide ? <div className="row-actions"><button className="small-success-button" disabled={busy} onClick={() => approve(item)}><BadgeCheck size={15} /> Aprovar</button><button className="small-neutral-button" disabled={busy} onClick={() => openDecision(item, 'devolvido')}>Devolver</button><button className="small-expense-button" disabled={busy} onClick={() => openDecision(item, 'rejeitado')}>Rejeitar</button></div> : <div className="row-actions"><span className="status-badge neutral">Somente consulta</span></div>}</article>)}</div>}
    </section>

    {decision && canDecide && <div className="modal-backdrop"><section className={`decision-modal ${decision.status}`} role="dialog" aria-modal="true"><div className="modal-toolbar"><div><span className="eyebrow">{isMasterTester ? 'Administrador Master · Homologação' : 'Diretoria autorizadora'}</span><h2>{decision.status === 'devolvido' ? 'Devolver para correção' : 'Rejeitar despesa'}</h2></div><button className="icon-button" type="button" onClick={() => setDecision(null)}><X size={20} /></button></div><div className="decision-warning"><AlertTriangle size={20} /><div><strong>{expenseBeneficiary(decision.item)}</strong><span>{money.format(Number(decision.item.valorTotal ?? 0))}</span></div></div><label className="decision-reason"><span>{decision.status === 'devolvido' ? 'O que precisa ser corrigido?' : 'Justificativa da rejeição'}</span><textarea data-required-key="approval-reason" rows={5} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Digite o motivo completo. Ele ficará registrado na Auditoria." /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDecision(null)}>Cancelar</button><button className={decision.status === 'rejeitado' ? 'expense-button' : 'warning-action-button'} type="button" disabled={busy} onClick={confirmDecision}>{busy ? 'Registrando...' : decision.status === 'devolvido' ? 'Confirmar devolução' : 'Confirmar rejeição'}</button></div></section></div>}
  </>
}
