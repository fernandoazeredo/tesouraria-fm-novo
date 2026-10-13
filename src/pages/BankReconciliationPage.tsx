import { useEffect, useMemo, useState } from 'react'
import { addDoc, arrayUnion, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Landmark, Link2, LockKeyhole, RefreshCw, Search, Trash2, Undo2, Upload } from 'lucide-react'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_BANK_ACCOUNT_ID, normalizeBankAccountId } from '../data/bankAccounts'
import { deleteObject, getDownloadURL, listAll, ref as storageRef, uploadBytes } from 'firebase/storage'
import { parseOfx, readOfxFile } from '../lib/ofx'
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

function safeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo'
}

async function deleteStorageTree(path: string) {
  const root = storageRef(storage, path)
  const result = await listAll(root)
  await Promise.all(result.items.map((item) => deleteObject(item)))
  for (const prefix of result.prefixes) {
    await deleteStorageTree(prefix.fullPath)
  }
}

export function BankReconciliationPage() {
  const { profile } = useAuth()
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7))
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [statementBusy, setStatementBusy] = useState(false)

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
  const statementId = `${competence}__Todas`
  const statement = statements.find((item) => item.id === statementId) ?? null

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
        bankAccountId: normalizeBankAccountId(String(item.paymentBankAccountId || '')),
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
        label: String(item.descricao || item.description || item.processo || item.reclamante || item.origem || 'Receita'),
        bankAccountId: normalizeBankAccountId(String(item.receivingBankAccountId || '')),
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

  const activeStatementVersions = useMemo(() => new Set(
    statements.map((item) => String(item.activeVersionId || '')).filter(Boolean)
  ), [statements])

  const activeMonthRows = useMemo(() => transactions
    .filter((item) => String(item.competence) === competence
      && String(item.bankAccountId || DEFAULT_BANK_ACCOUNT_ID) === DEFAULT_BANK_ACCOUNT_ID
      && Array.isArray(item.statementVersions)
      && item.statementVersions.some((version: unknown) => activeStatementVersions.has(String(version)))),
    [transactions, competence, activeStatementVersions])

  const monthTransactions = useMemo(() => activeMonthRows
    .filter((item) => String(item.movementClass || 'conciliavel') === 'conciliavel')
    .sort((a, b) => String(a.date).localeCompare(String(b.date))), [activeMonthRows])

  const informationalBalanceCount = activeMonthRows.filter((item) => item.movementClass === 'saldo').length
  const automaticInvestmentCount = activeMonthRows.filter((item) => item.movementClass === 'aplicacao_automatica').length

  const activeTransactionIds = useMemo(() => new Set(monthTransactions.map((item) => item.id)), [monthTransactions])
  const monthReconciliations = useMemo(() => reconciliations.filter((item) =>
    String(item.competence) === competence && activeTransactionIds.has(String(item.bankTransactionId))
  ), [reconciliations, competence, activeTransactionIds])
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

  async function uploadStatement(file: File) {
    if (!profile || file.size > 30 * 1024 * 1024) {
      if (file.size > 30 * 1024 * 1024) setMessage('O extrato ultrapassa o limite de 30 MB.')
      return
    }

    setStatementBusy(true)
    setMessage('')
    try {
      const isOfx = /\.ofx$/i.test(file.name)
      const parsedOfx = isOfx ? parseOfx(await readOfxFile(file)) : null
      if (isOfx && !parsedOfx?.transactions.length) throw new Error('O arquivo OFX não contém movimentações bancárias reconhecíveis.')

      if (parsedOfx) {
        const affectedMonths = Array.from(new Set(parsedOfx.transactions.map((item) => item.date.slice(0, 7))))
        const previousCoveredMonths = Array.isArray(statement?.coveredMonths) ? statement.coveredMonths.map(String) : (statement ? [competence] : [])
        const monthsThatWillChange = Array.from(new Set([...affectedMonths, ...previousCoveredMonths]))
        const closedMonths = monthsThatWillChange.filter((month) => periods.some((item) => item.id === `${month}__itau` && item.status === 'fechada'))
        if (closedMonths.length) {
          setMessage(`Não é possível substituir/importar o OFX porque a Conciliação Bancária está fechada em: ${closedMonths.join(', ')}. O Administrador Master deve reabrir a competência antes.`)
          return
        }
      }

      const path = `extratos-bancarios/${competence}/Todas/${Date.now()}-${safeName(file.name)}`
      const target = storageRef(storage, path)
      await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' })
      const downloadUrl = await getDownloadURL(target)

      let importedTransactionCount = 0
      let ofxBankId = ''
      let ofxAccountId = ''
      let activeVersionId: string | null = null
      let coveredMonths: string[] = []
      let discardedTransactionCount = 0
      let balanceCount = 0
      let automaticInvestmentCount = 0
      let reconcilableCount = 0

      if (parsedOfx) {
        const parsed = parsedOfx
        activeVersionId = `${statementId}__${Date.now()}__${safeName(file.name)}`
        coveredMonths = Array.from(new Set(parsed.transactions.map((item) => item.date.slice(0, 7))))
        discardedTransactionCount = parsed.discardedCount
        balanceCount = parsed.balanceCount
        automaticInvestmentCount = parsed.automaticInvestmentCount
        reconcilableCount = parsed.reconcilableCount

        const ops = parsed.transactions.map((transaction) => {
          const transactionCompetence = transaction.date.slice(0, 7)
          const reconciliationPeriodId = `${transactionCompetence}__itau`
          const transactionId = `itau__${transaction.identityKey}`
          return { transaction, transactionCompetence, reconciliationPeriodId, transactionId }
        })

        for (let start = 0; start < ops.length; start += 400) {
          const batch = writeBatch(db)
          ops.slice(start, start + 400).forEach(({ transaction, transactionCompetence, reconciliationPeriodId, transactionId }) => {
            batch.set(doc(db, 'bankTransactions', transactionId), {
              ...transaction,
              competence: transactionCompetence,
              reconciliationPeriodId,
              unit: 'Todas',
              bankAccountId: 'itau',
              bankId: parsed.bankId,
              branchId: parsed.branchId,
              accountId: parsed.accountId,
              currency: parsed.currency,
              statementVersions: arrayUnion(activeVersionId),
              lastStatementId: statementId,
              lastStatementStoragePath: path,
              lastImportedBy: profile.uid,
              lastImportedByName: profile.displayName,
              lastImportedByEmail: profile.email,
              lastImportedAt: serverTimestamp(),
            }, { merge: true })
          })
          await batch.commit()
        }

        importedTransactionCount = parsed.transactions.length
        ofxBankId = parsed.bankId
        ofxAccountId = parsed.accountId
      }

      await setDoc(doc(db, 'bankStatements', statementId), {
        competence, unit: 'Todas', fileName: file.name, storagePath: path, downloadUrl, size: file.size,
        type: file.type || 'application/octet-stream', bankAccountId: isOfx ? 'itau' : null,
        importedTransactionCount, discardedTransactionCount,
        balanceCount, automaticInvestmentCount, reconcilableCount,
        ofxBankId: ofxBankId || null, ofxAccountId: ofxAccountId || null,
        activeVersionId, coveredMonths,
        previousVersionId: statement?.activeVersionId || null,
        previousStoragePath: statement?.storagePath || null,
        uploadedBy: profile.uid, uploadedByName: profile.displayName, uploadedByEmail: profile.email, uploadedAt: serverTimestamp(),
      })

      await audit('Extrato bancário consolidado anexado', `${competence} · Todas · ${file.name}${importedTransactionCount ? ` · ${importedTransactionCount} movimentação(ões) OFX importada(s)` : ''}`, statementId)
      setMessage(importedTransactionCount
        ? `Extrato OFX anexado com sucesso. ${reconcilableCount} movimento(s) conciliável(is), ${balanceCount} linha(s) de saldo e ${automaticInvestmentCount} movimentação(ões) automática(s) de aplicação/resgate/rendimento foram identificados.`
        : 'Extrato consolidado anexado com sucesso. Ele será incluído automaticamente no ZIP da Contabilidade.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível enviar o extrato consolidado.')
    } finally {
      setStatementBusy(false)
    }
  }

  async function deleteStatementCompletely() {
    if (!profile || !statement || !isMaster) return
    if (!window.confirm(`Apagar definitivamente o extrato "${statement.fileName}"?\n\nIsso removerá o arquivo, as movimentações importadas por ele e os ZIPs já gerados desta competência. Esta ação não pode ser desfeita.`)) return

    const statementVersionPrefix = `${statementId}__`
    const relatedTransactions = transactions.filter((item) =>
      Array.isArray(item.statementVersions)
      && item.statementVersions.some((version: unknown) => String(version).startsWith(statementVersionPrefix))
    )

    const affectedClosedPeriods = Array.from(new Set(
      relatedTransactions
        .map((item) => String(item.reconciliationPeriodId || ''))
        .filter((periodKey) => periodKey && periods.some((p) => p.id === periodKey && p.status === 'fechada'))
    ))

    if (affectedClosedPeriods.length) {
      setMessage(`Não é possível apagar este extrato porque há Conciliação Bancária fechada em: ${affectedClosedPeriods.map((item) => item.replace('__itau', '')).join(', ')}. Reabra a competência antes de apagar.`)
      return
    }

    setStatementBusy(true)
    setMessage('')
    try {
      const deletedTransactionIds = new Set<string>()

      for (let start = 0; start < relatedTransactions.length; start += 350) {
        const batch = writeBatch(db)
        relatedTransactions.slice(start, start + 350).forEach((item) => {
          const versions = Array.isArray(item.statementVersions) ? item.statementVersions.map(String) : []
          const remainingVersions = versions.filter((version) => !version.startsWith(statementVersionPrefix))
          if (remainingVersions.length === 0) {
            batch.delete(doc(db, 'bankTransactions', item.id))
            deletedTransactionIds.add(item.id)
          } else {
            batch.update(doc(db, 'bankTransactions', item.id), {
              statementVersions: remainingVersions,
              lastStatementId: item.lastStatementId === statementId ? null : item.lastStatementId ?? null,
              lastStatementStoragePath: item.lastStatementId === statementId ? null : item.lastStatementStoragePath ?? null,
            })
          }
        })
        await batch.commit()
      }

      const relatedReconciliations = reconciliations.filter((item) => deletedTransactionIds.has(String(item.bankTransactionId)))
      for (let start = 0; start < relatedReconciliations.length; start += 400) {
        const batch = writeBatch(db)
        relatedReconciliations.slice(start, start + 400).forEach((item) => {
          batch.delete(doc(db, 'bankReconciliations', item.id))
        })
        await batch.commit()
      }

      // Remove todas as cópias históricas do extrato da competência/unidade.
      await deleteStorageTree(`extratos-bancarios/${competence}/Todas`)

      // Remove ZIPs já gerados que poderiam conter o extrato apagado.
      await deleteStorageTree(`envios-contabilidade/${competence}`)

      await deleteDoc(doc(db, 'bankStatements', statementId))
      await audit(
        'Extrato bancário apagado definitivamente',
        `${competence} · Todas · ${statement.fileName} · ${relatedTransactions.length} movimentação(ões) revisada(s) · ${deletedTransactionIds.size} removida(s) · ZIPs da competência removidos`,
        statementId
      )
      setMessage('Extrato apagado definitivamente. Arquivo, movimentações exclusivas e ZIPs da competência foram removidos.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível apagar completamente o extrato. Nenhuma nova exclusão deve ser tentada até revisar a Auditoria e o estado da competência.')
    } finally {
      setStatementBusy(false)
    }
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
      <div className="bank-statement-box"><div><Landmark size={21} /><div><strong>Extrato consolidado do banco</strong><span>Opcional para gerar o pacote mensal. Se anexado, será incluído no ZIP. Aceita PDF, OFX, CSV e Excel.</span>{statement && <small><CheckCircle2 size={13} /> {statement.fileName}</small>}</div></div><div className="bank-statement-actions"><label className="secondary-button accounting-file-button"><Upload size={17} /> {statementBusy ? 'Enviando...' : statement ? 'Substituir extrato' : 'Anexar extrato'}<input type="file" hidden accept=".pdf,.ofx,.csv,.xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadStatement(file); e.currentTarget.value = '' }} /></label>{statement && isMaster && <button className="expense-button" type="button" disabled={statementBusy} onClick={() => void deleteStatementCompletely()}><Trash2 size={17} /> {statementBusy ? 'Processando...' : 'Apagar extrato'}</button>}</div></div>
      <div className="reconciliation-toolbar">
        <label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label>
        <label><span>Status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>Todos</option><option>Conciliado</option><option>Correspondência provável</option><option>Sem correspondência</option></select></label>
        <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no extrato" /></div>
      </div>

      <div className="reconciliation-summary">
        <article><Landmark /><span>Movimentos conciliáveis</span><strong>{monthTransactions.length}</strong></article>
        <article><CheckCircle2 /><span>Conciliados</span><strong>{summary.conciliados}</strong></article>
        <article><Link2 /><span>Correspondência provável</span><strong>{summary.provaveis}</strong></article>
        <article><AlertTriangle /><span>Sem correspondência</span><strong>{summary.sem}</strong></article>
        <article><AlertTriangle /><span>Lançamento não localizado no banco</span><strong>{unmatchedSystem.length}</strong></article>
        <article><Landmark /><span>Saldos informativos ignorados</span><strong>{informationalBalanceCount}</strong></article>
        <article><RefreshCw /><span>Aplicações automáticas ignoradas</span><strong>{automaticInvestmentCount}</strong></article>
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

      {monthTransactions.length === 0 ? <div className="module-empty"><Landmark size={34} /><strong>Nenhum OFX importado para esta competência</strong><span>Anexe o extrato OFX do Itaú acima.</span></div> : <div className="reconciliation-list">
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
