import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Landmark, Link2, LockKeyhole, RefreshCw, Search, Undo2 } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_BANK_ACCOUNT_ID } from '../data/bankAccounts'
import './BankReconciliationPage.css'

type AnyRecord = { id: string } & DocumentData
type Candidate = {
  key: string
  collection: string
  id: string
  type: string
  date: string
  amount: number
  label: string
  bankAccountId?: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function useLiveCollection(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))), [name])
  return records
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function daysBetween(a: string, b: string) {
  if (!a || !b) return 999
  const left = new Date(`${a}T12:00:00`).getTime()
  const right = new Date(`${b}T12:00:00`).getTime()
  return Math.abs(Math.round((left - right) / 86400000))
}

function txDescription(tx: AnyRecord) {
  return String(tx.memo || tx.name || tx.refNum || tx.type || 'Movimento bancário')
}

export function BankReconciliationPage() {
  const { profile } = useAuth()
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7))
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const transactions = useLiveCollection('bankTransactions')
  const statements = useLiveCollection('bankStatements')
  const reconciliations = useLiveCollection('bankReconciliations')
  const periods = useLiveCollection('bankReconciliationPeriods')
  const expenses = useLiveCollection('expenses')
  const receivables = useLiveCollection('receivables')
  const transfers = useLiveCollection('alvaraTransfers')
  const commissions = useLiveCollection('agentCommissions')
  const societaryTransfers = useLiveCollection('societaryTransfers')

  const periodId = `${competence}__${DEFAULT_BANK_ACCOUNT_ID}`
  const period = periods.find((item) => item.id === periodId)
  const closed = period?.status === 'fechada'
  const isMaster = profile?.role === 'master'

  const candidates = useMemo<Candidate[]>(() => {
    const rows: Candidate[] = []

    for (const item of expenses) {
      if (!['pago', 'arquivado'].includes(String(item.status))) continue
      const date = String(item.paymentDate || '').slice(0, 10)
      if (date.slice(0, 7) !== competence) continue
      rows.push({
        key: `expenses:${item.id}`,
        collection: 'expenses',
        id: item.id,
        type: 'Despesa',
        date,
        amount: -Math.abs(toNumber(item.valorTotal)),
        label: String(item.fornecedor || item.nome || 'Despesa'),
        bankAccountId: String(item.paymentBankAccountId || ''),
      })
    }

    for (const item of receivables) {
      if (!['recebido_tesouraria', 'encerrado'].includes(String(item.status))) continue
      const date = String(item.receiptDate || item.data || '').slice(0, 10)
      if (date.slice(0, 7) !== competence) continue
      rows.push({
        key: `receivables:${item.id}`,
        collection: 'receivables',
        id: item.id,
        type: 'Receita',
        date,
        amount: Math.abs(toNumber(item.valorAlvara)),
        label: String(item.processo || item.reclamante || 'Receita'),
        bankAccountId: String(item.receivingBankAccountId || ''),
      })
    }

    const addInstallments = (plans: AnyRecord[], collectionName: string, type: string) => {
      for (const plan of plans) {
        const installments = Array.isArray(plan.installments) ? plan.installments : []
        installments.forEach((installment: DocumentData, index: number) => {
          const date = String(installment?.paidDate || '').slice(0, 10)
          if (!installment?.paid || date.slice(0, 7) !== competence) return
          rows.push({
            key: `${collectionName}:${plan.id}:${index}`,
            collection: collectionName,
            id: plan.id,
            type,
            date,
            amount: -Math.abs(toNumber(installment?.value)),
            label: String(plan.processo || plan.beneficiary || type),
          })
        })
      }
    }

    addInstallments(transfers, 'alvaraTransfers', 'Repasse de Alvará')
    addInstallments(commissions, 'agentCommissions', 'Comissão de Agente')

    for (const item of societaryTransfers) {
      if (String(item.status) !== 'pago') continue
      const date = String(item.paymentDate || '').slice(0, 10)
      if (date.slice(0, 7) !== competence) continue
      rows.push({
        key: `societaryTransfers:${item.id}`,
        collection: 'societaryTransfers',
        id: item.id,
        type: 'Repasse Societário',
        date,
        amount: -Math.abs(toNumber(item.paidValue || item.transferValue)),
        label: String(item.beneficiary || 'Repasse Societário'),
      })
    }

    return rows
  }, [expenses, receivables, transfers, commissions, societaryTransfers, competence])

  const activeStatement = statements.find((item) => item.id === `${competence}__Todas` && /\\.ofx$/i.test(String(item.fileName || '')))
    ?? statements.find((item) => String(item.competence) === competence && /\\.ofx$/i.test(String(item.fileName || '')))
    ?? null
  const monthTransactions = useMemo(() => transactions
    .filter((item) => String(item.competence) === competence
      && item.statementActive !== false
      && String(item.bankAccountId || DEFAULT_BANK_ACCOUNT_ID) === DEFAULT_BANK_ACCOUNT_ID)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))), [transactions, competence, activeStatement?.storagePath])

  const monthReconciliations = useMemo(() => reconciliations.filter((item) => String(item.competence) === competence), [reconciliations, competence])
  const reconciliationByTransaction = useMemo(() => new Map(monthReconciliations.map((item) => [String(item.bankTransactionId), item])), [monthReconciliations])
  const usedCandidateKeys = useMemo(() => new Set(monthReconciliations.map((item) => String(item.candidateKey))), [monthReconciliations])

  function suggestionsFor(tx: AnyRecord) {
    const amount = toNumber(tx.amount)
    return candidates
      .filter((candidate) =>
        Math.abs(candidate.amount - amount) < 0.005
        && !usedCandidateKeys.has(candidate.key)
        && (!candidate.bankAccountId || candidate.bankAccountId === DEFAULT_BANK_ACCOUNT_ID)
      )
      .map((candidate) => {
        const delta = daysBetween(candidate.date, String(tx.date || ''))
        const sameBank = !candidate.bankAccountId || candidate.bankAccountId === DEFAULT_BANK_ACCOUNT_ID
        const confidence = delta === 0 && sameBank ? 'alta' : delta <= 2 ? 'media' : 'baixa'
        return { candidate, delta, confidence }
      })
      .filter((item) => item.delta <= 2)
      .sort((a, b) => a.delta - b.delta || (a.confidence === 'alta' ? -1 : 1))
  }

  function rowStatus(tx: AnyRecord) {
    if (reconciliationByTransaction.has(tx.id)) return 'Conciliado'
    return suggestionsFor(tx).length ? 'Correspondência provável' : 'Sem correspondência'
  }

  const unmatchedSystem = candidates.filter((candidate) => !usedCandidateKeys.has(candidate.key))
  const summary = monthTransactions.reduce((acc, tx) => {
    const status = rowStatus(tx)
    if (status === 'Conciliado') acc.conciliados += 1
    else if (status === 'Correspondência provável') acc.provaveis += 1
    else acc.sem += 1
    return acc
  }, { conciliados: 0, provaveis: 0, sem: 0 })

  const filteredTransactions = monthTransactions.filter((tx) => {
    const status = rowStatus(tx)
    const haystack = `${txDescription(tx)} ${tx.amount} ${tx.date}`.toLowerCase()
    return (statusFilter === 'Todos' || statusFilter === status) && (!search.trim() || haystack.includes(search.trim().toLowerCase()))
  })

  async function audit(action: string, detail: string, entityId?: string) {
    if (!profile) return
    await addDoc(collection(db, 'auditLogs'), {
      action, module: 'Conciliação Bancária', detail, entityId: entityId || null,
      userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp(),
    })
  }

  async function reconcile(tx: AnyRecord, candidate: Candidate) {
    if (!profile || closed) return
    setBusy(tx.id); setMessage('')
    try {
      const id = `${tx.id}__${candidate.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      await setDoc(doc(db, 'bankReconciliations', id), {
        competence,
        bankTransactionId: tx.id,
        candidateKey: candidate.key,
        periodId,
        sourceCollection: candidate.collection,
        sourceId: candidate.id,
        sourceType: candidate.type,
        bankDate: tx.date,
        systemDate: candidate.date,
        amount: toNumber(tx.amount),
        matchedBy: profile.uid,
        matchedByName: profile.displayName,
        matchedByEmail: profile.email,
        matchedAt: serverTimestamp(),
      })
      await audit('Conciliação bancária confirmada', `${competence} · ${candidate.type} · ${money.format(Math.abs(candidate.amount))}`, id)
      setMessage('Conciliação confirmada.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível confirmar a conciliação.')
    } finally { setBusy('') }
  }

  async function undo(item: AnyRecord) {
    if (!profile || closed) return
    setBusy(item.id); setMessage('')
    try {
      await deleteDoc(doc(db, 'bankReconciliations', item.id))
      await audit('Conciliação bancária desfeita', `${competence} · ${money.format(Math.abs(toNumber(item.amount)))}`, item.id)
      setMessage('Conciliação desfeita.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível desfazer a conciliação.')
    } finally { setBusy('') }
  }

  async function closePeriod() {
    if (!profile || closed) return
    if (summary.provaveis || summary.sem || unmatchedSystem.length) {
      if (!window.confirm(`Existem pendências na conciliação: ${summary.provaveis} correspondência(s) provável(is), ${summary.sem} movimento(s) bancário(s) sem correspondência e ${unmatchedSystem.length} lançamento(s) não localizado(s) no banco. Fechar mesmo assim?`)) return
    } else if (!window.confirm(`Fechar a Conciliação Bancária de ${competence}?`)) return
    setBusy('close'); setMessage('')
    try {
      await setDoc(doc(db, 'bankReconciliationPeriods', periodId), {
        competence,
        bankAccountId: DEFAULT_BANK_ACCOUNT_ID,
        status: 'fechada',
        transactionCount: monthTransactions.length,
        reconciledCount: summary.conciliados,
        probableCount: summary.provaveis,
        unmatchedBankCount: summary.sem,
        unmatchedSystemCount: unmatchedSystem.length,
        closedBy: profile.uid,
        closedByName: profile.displayName,
        closedByEmail: profile.email,
        closedAt: serverTimestamp(),
      })
      await audit('Conciliação bancária fechada', `${competence} · ${summary.conciliados}/${monthTransactions.length} movimento(s) conciliado(s)`, periodId)
      setMessage('Conciliação bancária fechada.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível fechar a conciliação.')
    } finally { setBusy('') }
  }

  async function reopenPeriod() {
    if (!profile || !closed || !isMaster) return
    const reason = window.prompt('Informe a justificativa para reabrir a Conciliação Bancária:')
    if (!reason?.trim()) return
    setBusy('reopen'); setMessage('')
    try {
      await setDoc(doc(db, 'bankReconciliationPeriods', periodId), {
        status: 'aberta',
        reopenedBy: profile.uid,
        reopenedByName: profile.displayName,
        reopenedByEmail: profile.email,
        reopenedReason: reason.trim(),
        reopenedAt: serverTimestamp(),
      }, { merge: true })
      await audit('Conciliação bancária reaberta', `${competence} · Motivo: ${reason.trim()}`, periodId)
      setMessage('Conciliação bancária reaberta.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível reabrir a conciliação.')
    } finally { setBusy('') }
  }

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Fechamento financeiro</span><h1>Conciliação Bancária</h1><p>Compare as movimentações do extrato bancário com os lançamentos financeiros registrados no sistema.</p></div>
    </div>

    <section className="page-card reconciliation-panel">
      <div className="reconciliation-toolbar">
        <label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label>
        <label><span>Status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>Todos</option><option>Conciliado</option><option>Correspondência provável</option><option>Sem correspondência</option></select></label>
        <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no extrato" /></div>
      </div>

      <div className="reconciliation-summary">
        <article><Landmark /><span>Movimentos no banco</span><strong>{monthTransactions.length}</strong></article>
        <article><CheckCircle2 /><span>Conciliados</span><strong>{summary.conciliados}</strong></article>
        <article><Link2 /><span>Correspondência provável</span><strong>{summary.provaveis}</strong></article>
        <article><AlertTriangle /><span>Sem correspondência</span><strong>{summary.sem}</strong></article>
        <article><AlertTriangle /><span>Lançamento não localizado no banco</span><strong>{unmatchedSystem.length}</strong></article>
      </div>

      <div className={closed ? 'reconciliation-state is-closed' : 'reconciliation-state'}>
        <strong>{closed ? 'Conciliação fechada' : 'Conciliação aberta'}</strong>
        <span>{closed ? 'As correspondências deste período estão bloqueadas.' : 'Confirme as correspondências antes de fechar a competência.'}</span>
        <div>
          {!closed && <button className="primary-button" type="button" disabled={Boolean(busy) || monthTransactions.length === 0} onClick={() => void closePeriod()}><LockKeyhole size={16} /> {busy === 'close' ? 'Fechando...' : 'Fechar Conciliação'}</button>}
          {closed && isMaster && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void reopenPeriod()}><Undo2 size={16} /> {busy === 'reopen' ? 'Reabrindo...' : 'Reabrir Conciliação'}</button>}
        </div>
      </div>

      {message && <div className="accounting-feedback" role="status">{message}</div>}

      {monthTransactions.length === 0 ? <div className="module-empty"><Landmark size={34} /><strong>Nenhum OFX importado para esta competência</strong><span>Anexe o extrato OFX do Itaú na tela Contabilidade.</span></div> : <div className="reconciliation-list">
        {filteredTransactions.map((tx) => {
          const reconciliation = reconciliationByTransaction.get(tx.id)
          const status = rowStatus(tx)
          const suggestions = reconciliation ? [] : suggestionsFor(tx).slice(0, 3)
          return <article key={tx.id} className="reconciliation-row">
            <div className="reconciliation-bank"><small>{tx.date || '—'}</small><strong>{txDescription(tx)}</strong><span>{tx.fitId || tx.id}</span></div>
            <div className={toNumber(tx.amount) >= 0 ? 'reconciliation-amount credit' : 'reconciliation-amount debit'}>{money.format(toNumber(tx.amount))}</div>
            <div className="reconciliation-match">
              <span className={`reconciliation-badge ${status === 'Conciliado' ? 'ok' : status === 'Correspondência provável' ? 'probable' : 'missing'}`}>{status}</span>
              {reconciliation && <div className="matched-detail"><strong>{reconciliation.sourceType}</strong><span>{reconciliation.systemDate || '—'} · {money.format(Math.abs(toNumber(reconciliation.amount)))}</span>{!closed && <button className="small-neutral-button" type="button" disabled={Boolean(busy)} onClick={() => void undo(reconciliation)}><Undo2 size={13} /> Desfazer</button>}</div>}
              {!reconciliation && suggestions.map(({ candidate, confidence }) => <div className="candidate" key={candidate.key}><div><strong>{candidate.type} · {candidate.label}</strong><span>{candidate.date} · {money.format(Math.abs(candidate.amount))} · confiança {confidence}</span></div><button className="small-success-button" type="button" disabled={closed || Boolean(busy)} onClick={() => void reconcile(tx, candidate)}><CheckCircle2 size={13} /> Conciliar</button></div>)}
            </div>
          </article>
        })}
      </div>}
    </section>

    <section className="page-card">
      <div className="card-title-row"><div><h2>Lançamentos não localizados no banco</h2><p>Registros financeiros do sistema que ainda não possuem correspondência confirmada no extrato.</p></div><span className="status-badge">{unmatchedSystem.length}</span></div>
      {unmatchedSystem.length === 0 ? <div className="module-empty"><CheckCircle2 size={30} /><strong>Nenhuma pendência deste tipo</strong></div> : <div className="unmatched-system-list">{unmatchedSystem.map((item) => <article key={item.key}><strong>{item.type} · {item.label}</strong><span>{item.date} · {money.format(Math.abs(item.amount))}</span></article>)}</div>}
    </section>
  </>
}
