import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc, type DocumentData } from 'firebase/firestore'
import { Archive, CheckCircle2, WalletCards } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { db } from '../lib/firebase'
import '../expense-settlement.css'

type AnyRecord = { id: string } & DocumentData

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function beneficiary(item: AnyRecord) {
  return String(item.fornecedor || item.favorecido || item.nomeFornecedor || item.nomeFavorecido || item.nome || 'Despesa')
}

export function ExpenseSettlementPanel() {
  const location = useLocation()
  const { profile } = useAuth()
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [busyId, setBusyId] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [host, setHost] = useState<HTMLElement | null>(null)

  const canOperate = profile?.role === 'master' || profile?.role === 'tesouraria'

  useEffect(() => {
    if (location.pathname !== '/despesas') {
      setHost(null)
      return
    }

    const locate = () => {
      const element = document.querySelector<HTMLElement>('.main-content')
      if (element) setHost(element)
      return Boolean(element)
    }

    if (locate()) return

    // Em F5/acesso direto, o componente pode montar antes de .main-content existir.
    // O observer mantém o painel sincronizado sem depender de navegação prévia.
    const observer = new MutationObserver(() => {
      if (locate()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const fallback = window.setTimeout(() => {
      locate()
      observer.disconnect()
    }, 3000)

    return () => {
      observer.disconnect()
      window.clearTimeout(fallback)
    }
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname !== '/despesas' || !canOperate || !profile?.uid) {
      setRecords([])
      return
    }
    return onSnapshot(collection(db, 'expenses'), (snapshot) => {
      setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    }, () => setRecords([]))
  }, [location.pathname, canOperate, profile?.uid])

  const operational = useMemo(
    () => records
      .filter((item) => item.status === 'aprovado' || item.status === 'pago')
      .sort((a, b) => String(b.competencia ?? '').localeCompare(String(a.competencia ?? '')) || beneficiary(a).localeCompare(beneficiary(b))),
    [records],
  )

  async function audit(action: string, item: AnyRecord) {
    if (!profile) return
    await addDoc(collection(db, 'auditLogs'), {
      action,
      module: 'Despesas',
      detail: `${beneficiary(item)} — ${money.format(Number(item.valorTotal) || 0)}`,
      entityId: item.id,
      userId: profile.uid,
      userName: profile.displayName,
      userEmail: profile.email,
      createdAt: serverTimestamp(),
    })
  }

  async function markPaid(item: AnyRecord) {
    const paymentDate = dates[item.id] || String(item.paymentDate || '') || todayIso()
    if (!window.confirm(`Marcar esta despesa como PAGA em ${paymentDate.split('-').reverse().join('/')}?`)) return
    setBusyId(item.id)
    try {
      await updateDoc(doc(db, 'expenses', item.id), {
        status: 'pago',
        paymentDate,
        paidAt: serverTimestamp(),
        paidBy: profile?.uid ?? null,
        paidByName: profile?.displayName ?? profile?.email ?? null,
        updatedAt: serverTimestamp(),
      })
      await audit('Despesa marcada como paga', item)
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível marcar a despesa como paga. Confira sua permissão e tente novamente.')
    } finally {
      setBusyId('')
    }
  }

  async function archive(item: AnyRecord) {
    if (!window.confirm('Arquivar esta despesa paga? Ela continuará registrada nos relatórios, DRE e Auditoria.')) return
    setBusyId(item.id)
    try {
      await updateDoc(doc(db, 'expenses', item.id), {
        status: 'arquivado',
        archivedAt: serverTimestamp(),
        archivedBy: profile?.uid ?? null,
        archivedByName: profile?.displayName ?? profile?.email ?? null,
        updatedAt: serverTimestamp(),
      })
      await audit('Despesa arquivada após pagamento', item)
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível arquivar a despesa. Confira sua permissão e tente novamente.')
    } finally {
      setBusyId('')
    }
  }

  if (location.pathname !== '/despesas' || !canOperate || !host) return null

  return createPortal(
    <section className="page-card expense-settlement-panel">
      <div className="expense-settlement-heading">
        <div>
          <span className="eyebrow">Baixa financeira</span>
          <h2>Pagamento e Arquivamento de Despesas</h2>
          <p>Fluxo operacional após a aprovação: <strong>Aprovado → Pago → Arquivado</strong>.</p>
        </div>
        <span className="status-badge success">{operational.length} pendência(s)</span>
      </div>

      {operational.length === 0 ? (
        <div className="expense-settlement-empty"><CheckCircle2 size={28} /><strong>Nenhuma despesa aguardando baixa</strong><span>As despesas aprovadas ou pagas aparecerão aqui automaticamente.</span></div>
      ) : (
        <div className="expense-settlement-list">
          {operational.map((item) => {
            const approved = item.status === 'aprovado'
            const date = dates[item.id] || String(item.paymentDate || '') || todayIso()
            return <article key={item.id}>
              <div className="expense-settlement-info">
                <strong>{beneficiary(item)}</strong>
                <span>{item.competencia || 'Sem competência'} · {item.categoria || 'Sem categoria'}</span>
                <small>{item.expenseAccountCode || item.classificacaoContabil || '—'} · {item.expenseAccountName || item.categoria || 'Não classificada'}</small>
              </div>
              <div className="expense-settlement-value">
                <span className={`status-badge ${approved ? 'success' : 'revenue'}`}>{approved ? 'Aprovado' : 'Pago'}</span>
                <strong>{money.format(Number(item.valorTotal) || 0)}</strong>
              </div>
              <div className="expense-settlement-actions">
                {approved ? <>
                  <label><span>Data do pagamento</span><input type="date" value={date} onChange={(e) => setDates((current) => ({ ...current, [item.id]: e.target.value }))} /></label>
                  <button className="small-success-button" type="button" disabled={busyId === item.id} onClick={() => void markPaid(item)}><WalletCards size={15} /> {busyId === item.id ? 'Salvando...' : 'Marcar como Pago'}</button>
                </> : <button className="small-neutral-button" type="button" disabled={busyId === item.id} onClick={() => void archive(item)}><Archive size={15} /> {busyId === item.id ? 'Arquivando...' : 'Arquivar'}</button>}
              </div>
            </article>
          })}
        </div>
      )}
    </section>,
    host,
  )
}
