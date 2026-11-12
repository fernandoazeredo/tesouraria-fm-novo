import { useEffect, useState } from 'react'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { PRIMARY_ADMIN_EMAIL, useAuth } from '../auth/AuthContext'
import { useBankAccounts, type BankAccount } from '../data/bankAccounts'

type Row = BankAccount & { isNew?: boolean }

/** Card "Bancos e Contas" em Configurações: as contas salvas aqui alimentam os menus de Despesas e Receitas. */
export function BankAccountsPanel() {
  const { profile } = useAuth()
  const master = profile?.role === 'master' && profile.email?.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL
  const saved = useBankAccounts(false)
  const [rows, setRows] = useState<Row[]>(saved)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setRows(saved) }, [saved, dirty])

  const update = (index: number, patch: Partial<Row>) => { setDirty(true); setRows((list) => list.map((row, i) => i === index ? { ...row, ...patch } : row)) }
  const add = () => { setDirty(true); setRows((list) => [...list, { id: 'conta-' + Date.now().toString(36), bank: '', agency: '', account: '', holder: '', holderType: 'PJ', active: true, isNew: true }]) }
  const remove = (index: number) => { setDirty(true); setRows((list) => list.filter((_, i) => i !== index)) }
  const cancel = () => { setRows(saved); setDirty(false); setMessage('Alterações descartadas.') }

  const save = async () => {
    if (!master || !profile || busy) return
    const accounts: BankAccount[] = rows.map(({ isNew: _isNew, ...row }) => ({
      ...row, bank: row.bank.trim(), agency: row.agency.trim(), account: row.account.trim(), holder: row.holder.trim(), active: row.active !== false,
    }))
    if (accounts.some((row) => !row.bank || !row.agency || !row.account)) { setMessage('Preencha Banco, Agência e Conta em todas as linhas.'); return }
    if (!accounts.some((row) => row.active)) { setMessage('Deixe pelo menos uma conta ativa.'); return }
    if (!window.confirm('Confirmar as alterações em Bancos e Contas? Elas passam a valer em Despesas e Receitas.')) return
    setBusy(true); setMessage('')
    try {
      const batch = writeBatch(db)
      batch.set(doc(db, 'appConfig', 'bankAccounts'), { accounts, updatedAt: serverTimestamp(), updatedBy: profile.uid })
      batch.set(doc(collection(db, 'auditLogs')), {
        action: 'Bancos e contas alterados', module: 'Configurações',
        detail: accounts.map((row) => `${row.bank} · Ag. ${row.agency} · C/C ${row.account}${row.active ? '' : ' (inativa)'}`).join('\n'),
        userId: profile.uid, userName: profile.displayName, userEmail: profile.email || '', createdAt: serverTimestamp(),
      })
      await batch.commit()
      setDirty(false)
      setMessage('Bancos e contas salvos. Já valem em Despesas e Receitas.')
    } catch (error) {
      setMessage('Não foi possível salvar: ' + String(error))
    } finally { setBusy(false) }
  }

  const disabled = !master || busy
  return <section className="page-card">
    <span className="eyebrow">Dados bancários</span>
    <h2>Bancos e Contas</h2>
    <p>As contas ativas aparecem nos menus de conta de pagamento (Despesas) e de recebimento (Receitas). Conta inativa sai dos menus, mas continua nos lançamentos antigos.</p>
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table className="cash-flow-table" style={{ minWidth: 760 }}>
        <thead><tr><th>Banco</th><th>Agência</th><th>Conta</th><th>Titular</th><th>Tipo</th><th>Ativa</th><th></th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id}>
          <td><input aria-label="Banco" value={row.bank} disabled={disabled} onChange={(e) => update(index, { bank: e.target.value })} /></td>
          <td><input aria-label="Agência" value={row.agency} disabled={disabled} onChange={(e) => update(index, { agency: e.target.value })} style={{ maxWidth: 110 }} /></td>
          <td><input aria-label="Conta" value={row.account} disabled={disabled} onChange={(e) => update(index, { account: e.target.value })} style={{ maxWidth: 140 }} /></td>
          <td><input aria-label="Titular" value={row.holder} placeholder={row.holderType === 'PJ' ? 'Razão Social do escritório' : ''} disabled={disabled} onChange={(e) => update(index, { holder: e.target.value })} /></td>
          <td><select aria-label="Tipo" value={row.holderType} disabled={disabled} onChange={(e) => update(index, { holderType: e.target.value as BankAccount['holderType'] })}><option value="PJ">PJ</option><option value="PF / Sócio">PF / Sócio</option></select></td>
          <td style={{ textAlign: 'center' }}><input aria-label="Ativa" type="checkbox" checked={row.active !== false} disabled={disabled} onChange={(e) => update(index, { active: e.target.checked })} /></td>
          <td>{row.isNew && !disabled && <button type="button" className="secondary-button" onClick={() => remove(index)}>Remover</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {master && <div className="quick-actions" style={{ marginTop: 14 }}>
      <button type="button" className="secondary-button" disabled={busy} onClick={add}>Adicionar conta</button>
      <button type="button" className="secondary-button" disabled={busy || !dirty} onClick={cancel}>Cancelar alterações</button>
      <button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar bancos e contas'}</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>
}
