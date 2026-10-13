import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, Eye, FileCheck2, X } from 'lucide-react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, type DocumentData } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { PRIMARY_ADMIN_EMAIL, isOfficialDirectorEmail, useAuth } from '../auth/AuthContext'
import { WorkflowStatusBadge } from '../components/WorkflowStatusBadge'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
type AnyRecord = { id: string } & DocumentData
type QueueType = 'expense' | 'commission' | 'alvaraTransfer' | 'societaryTransfer'
type DecisionStatus = 'devolvido' | 'rejeitado'
type ApprovalItem = {
  key: string
  type: QueueType
  record: AnyRecord
  title: string
  subtitle: string
  value: number
  status: string
}

const expenseStatusLabels: Record<string, string> = {
  enviado_aprovacao: 'Enviado para Aprovação',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido p/ Correção',
  rejeitado: 'Rejeitado',
}
const queueStatusLabels: Record<string, string> = {
  aguardando_aprovacao: 'Aguardando aprovação',
  enviado_aprovacao: 'Enviado para Aprovação',
  em_analise: 'Em Análise',
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function expenseBeneficiary(item: AnyRecord) {
  return String(item.fornecedor || item.favorecido || item.nomeFornecedor || item.nomeFavorecido || item.nome || 'Demonstrativo de despesa')
}

function useCollectionRecords(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, () => setRecords([])), [name])
  return records
}

function installmentArray(record: AnyRecord) {
  return Array.isArray(record.installments) ? record.installments as DocumentData[] : []
}

function approvedInstallments(record: AnyRecord) {
  const now = new Date().toISOString()
  return installmentArray(record).map((item) => ({
    ...item,
    status: item?.paid || item?.status === 'paga' ? 'paga' : 'aprovada',
    ...(item?.paid || item?.status === 'paga' ? {} : {
      approvedAt: now,
    }),
  }))
}

function pendingInstallments(record: AnyRecord) {
  return installmentArray(record).map((item) => ({
    ...item,
    status: item?.paid || item?.status === 'paga' ? 'paga' : 'pendente',
  }))
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

  const expenses = useCollectionRecords('expenses')
  const commissions = useCollectionRecords('agentCommissions')
  const alvaraTransfers = useCollectionRecords('alvaraTransfers')
  const societaryTransfers = useCollectionRecords('societaryTransfers')

  const queue = useMemo<ApprovalItem[]>(() => {
    const rows: ApprovalItem[] = []

    expenses
      .filter((item) => ['enviado_aprovacao', 'em_analise'].includes(String(item.status ?? '')))
      .forEach((item) => rows.push({
        key: `expense__${item.id}`,
        type: 'expense',
        record: item,
        title: expenseBeneficiary(item),
        subtitle: `${item.competencia || 'Sem competência'} · ${item.categoria || 'Sem categoria'}`,
        value: toNumber(item.valorTotal),
        status: String(item.status || ''),
      }))

    commissions
      .filter((item) => item.status === 'aguardando_aprovacao')
      .forEach((item) => rows.push({
        key: `commission__${item.id}`,
        type: 'commission',
        record: item,
        title: `Comissão · ${item.beneficiary || item.sourceSnapshot?.agentName || 'Agente não informado'}`,
        subtitle: `Processo ${item.processo || item.sourceSnapshot?.processo || '—'} · Líquido após deduções`,
        value: toNumber(item.netAmountDue ?? item.amountDue),
        status: String(item.status || ''),
      }))

    alvaraTransfers
      .filter((item) => item.status === 'aguardando_aprovacao')
      .forEach((item) => rows.push({
        key: `alvaraTransfer__${item.id}`,
        type: 'alvaraTransfer',
        record: item,
        title: `Repasse de Alvará · ${item.beneficiary || 'Cliente'}`,
        subtitle: `Processo ${item.processo || item.sourceSnapshot?.processo || '—'}`,
        value: toNumber(item.amountDue),
        status: String(item.status || ''),
      }))

    societaryTransfers
      .filter((item) => item.status === 'aguardando_aprovacao')
      .forEach((item) => rows.push({
        key: `societaryTransfer__${item.id}`,
        type: 'societaryTransfer',
        record: item,
        title: `Repasse Societário · ${item.beneficiary || 'Beneficiário'}`,
        subtitle: `Processo ${item.processo || '—'} · ${toNumber(item.percent).toLocaleString('pt-BR')}%`,
        value: toNumber(item.transferValue),
        status: String(item.status || ''),
      }))

    return rows
  }, [alvaraTransfers, commissions, expenses, societaryTransfers])

  const [decision, setDecision] = useState<{ item: ApprovalItem; status: DecisionStatus } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  function typeLabel(type: QueueType) {
    return {
      expense: 'Despesa',
      commission: 'Comissão de Agente',
      alvaraTransfer: 'Repasse de Alvará',
      societaryTransfer: 'Repasse Societário',
    }[type]
  }

  async function approve(item: ApprovalItem) {
    if (!canDecide || !profile) return
    setBusy(true)
    try {
      if (item.type === 'expense') {
        await updateDoc(doc(db, 'expenses', item.record.id), {
          status: 'aprovado',
          approvalNote: null,
          decisionBy: profile.uid,
          decisionByName: profile.displayName,
          decisionByEmail: profile.email,
          decisionAt: serverTimestamp(),
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else if (item.type === 'commission') {
        await updateDoc(doc(db, 'agentCommissions', item.record.id), {
          status: 'aprovado',
          installments: approvedInstallments(item.record),
          approvalNote: '',
          approvedBy: profile.uid,
          approvedByName: profile.displayName,
          approvedByEmail: profile.email,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else if (item.type === 'alvaraTransfer') {
        await updateDoc(doc(db, 'alvaraTransfers', item.record.id), {
          status: 'aprovado',
          installments: approvedInstallments(item.record),
          approvalNote: '',
          approvedBy: profile.uid,
          approvedByName: profile.displayName,
          approvedByEmail: profile.email,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await updateDoc(doc(db, 'societaryTransfers', item.record.id), {
          status: 'aprovado',
          approvedPercent: toNumber(item.record.percent),
          approvedValue: toNumber(item.record.transferValue),
          approvedBy: profile.uid,
          approvedByName: profile.displayName,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }

      const actor = profile.displayName || profile.email || 'Usuário autorizado'
      await writeAudit(profile, `${typeLabel(item.type)}: Aprovado`, `${item.title} — ${money.format(item.value)} — Autorizado por ${actor}`, item.record.id)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDecision() {
    if (!canDecide || !decision || !profile) return
    if (!reason.trim()) { showRequiredFieldErrors('.decision-modal', ['approval-reason']); return }
    clearRequiredFieldErrors('.decision-modal')
    setBusy(true)
    try {
      const { item, status } = decision
      const actionLabel = status === 'devolvido' ? 'Devolvido para correção' : 'Rejeitado'

      if (item.type === 'expense') {
        await updateDoc(doc(db, 'expenses', item.record.id), {
          status,
          approvalNote: reason.trim(),
          decisionBy: profile.uid,
          decisionByName: profile.displayName,
          decisionByEmail: profile.email,
          decisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else if (item.type === 'commission') {
        await updateDoc(doc(db, 'agentCommissions', item.record.id), {
          status,
          installments: pendingInstallments(item.record),
          approvalNote: reason.trim(),
          decisionBy: profile.uid,
          decisionByName: profile.displayName,
          decisionByEmail: profile.email,
          decisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else if (item.type === 'alvaraTransfer') {
        await updateDoc(doc(db, 'alvaraTransfers', item.record.id), {
          status,
          installments: pendingInstallments(item.record),
          approvalNote: reason.trim(),
          decisionBy: profile.uid,
          decisionByName: profile.displayName,
          decisionByEmail: profile.email,
          decisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await updateDoc(doc(db, 'societaryTransfers', item.record.id), {
          status,
          rejectionReason: status === 'rejeitado' ? reason.trim() : null,
          returnReason: status === 'devolvido' ? reason.trim() : null,
          decisionBy: profile.uid,
          decisionByName: profile.displayName,
          decisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }

      await writeAudit(profile, `${typeLabel(item.type)}: ${actionLabel}`, `${item.title} — ${money.format(item.value)} — Motivo/justificativa: ${reason.trim()}`, item.record.id)
      setDecision(null)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  function openDecision(item: ApprovalItem, status: DecisionStatus) {
    if (!canDecide) return
    setReason('')
    setDecision({ item, status })
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Fluxo de aprovação</span><h1>Aprovações</h1><p>Fila central de despesas, comissões e repasses aguardando decisão. Flávio Marques é o autorizador oficial de pagamentos; o Administrador Master possui as mesmas ações para testes e homologação.</p></div></div>
    {!canDecide && <div className="warning-box"><Eye size={18} /><span><strong>Modo consulta:</strong> você pode acompanhar todos os itens da fila de aprovação, mas não pode Aprovar, Devolver ou Rejeitar.</span></div>}
    {isMasterTester && <div className="warning-box"><BadgeCheck size={18} /><span><strong>Modo Master de homologação:</strong> você pode Aprovar, Devolver e Rejeitar para testar integralmente o fluxo. Todas as decisões ficam registradas na Auditoria com seu usuário.</span></div>}
    <section className="page-card module-card approval-card">
      {queue.length === 0 ? <div className="module-empty"><FileCheck2 size={34} /><strong>Nenhuma aprovação pendente</strong><span>Despesas, comissões e repasses enviados para aprovação aparecerão nesta fila central.</span></div> : <div className="approval-list">{queue.map((item) => <article className="approval-item" key={item.key}><div><WorkflowStatusBadge status={item.status} label={queueStatusLabels[item.status] || expenseStatusLabels[item.status] || item.status} /><h3>{item.title}</h3><p>{item.subtitle}</p><small>{typeLabel(item.type)}</small></div><strong className={item.type === 'expense' ? 'expense-text' : 'revenue-text'}>{money.format(item.value)}</strong>{canDecide ? <div className="row-actions"><button className="small-success-button" disabled={busy} onClick={() => void approve(item)}><BadgeCheck size={15} /> Aprovar</button><button className="small-neutral-button" disabled={busy} onClick={() => openDecision(item, 'devolvido')}>Devolver</button><button className="small-expense-button" disabled={busy} onClick={() => openDecision(item, 'rejeitado')}>Rejeitar</button></div> : <div className="row-actions"><span className="status-badge neutral">Somente consulta</span></div>}</article>)}</div>}
    </section>

    {decision && canDecide && <div className="modal-backdrop"><section className={`decision-modal ${decision.status}`} role="dialog" aria-modal="true"><div className="modal-toolbar"><div><span className="eyebrow">{isMasterTester ? 'Administrador Master · Homologação' : 'Diretoria autorizadora'}</span><h2>{decision.status === 'devolvido' ? 'Devolver para correção' : 'Rejeitar item'}</h2></div><button className="icon-button" type="button" onClick={() => setDecision(null)}><X size={20} /></button></div><div className="decision-warning"><AlertTriangle size={20} /><div><strong>{decision.item.title}</strong><span>{money.format(decision.item.value)}</span></div></div><label className="decision-reason"><span>{decision.status === 'devolvido' ? 'O que precisa ser corrigido?' : 'Justificativa da rejeição'}</span><textarea data-required-key="approval-reason" rows={5} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Digite o motivo completo. Ele ficará registrado na Auditoria." /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDecision(null)}>Cancelar</button><button className={decision.status === 'rejeitado' ? 'expense-button' : 'warning-action-button'} type="button" disabled={busy} onClick={() => void confirmDecision()}>{busy ? 'Registrando...' : decision.status === 'devolvido' ? 'Confirmar devolução' : 'Confirmar rejeição'}</button></div></section></div>}
  </>
}
