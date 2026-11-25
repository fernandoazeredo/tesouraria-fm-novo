import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, writeBatch, type DocumentData } from 'firebase/firestore'
import { CheckCircle2, Landmark, Upload } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { parseOfx, readOfxFile } from '../lib/ofx'
import { confirmableReceivables, creditsFromOfx, suggestCredits, type IncomingCredit } from '../lib/incomingCredits'
import { ensureOfficialDemonstrative } from '../lib/officialDemonstrative'
import './IncomingCreditsPage.css'

type AnyRecord = { id: string } & DocumentData
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const br = (date: string) => date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—'

function useLive<T = AnyRecord>(name: string) {
  const [rows, setRows] = useState<T[]>([])
  const [error, setError] = useState('')
  useEffect(() => onSnapshot(collection(db, name), (s) => { setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as T)); setError('') }, () => setError('Sem permissão para ler os dados desta tela.')), [name])
  return { rows, error }
}

export function IncomingCreditsPage() {
  const { profile } = useAuth()
  const { rows: credits, error } = useLive<IncomingCredit>('bankCredits')
  const { rows: receivables } = useLive('receivables')
  const canUpload = profile?.role === 'master' || profile?.role === 'tesouraria'
  const [status, setStatus] = useState<'todos' | 'livres' | 'vinculados'>('todos')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [choice, setChoice] = useState<Record<string, string>>({})

  const term = search.trim().toLowerCase()
  const visible = useMemo(() => credits.filter((c) => (status === 'todos' || (status === 'livres' ? !c.matchedReceivableId : !!c.matchedReceivableId))
    && (!term || `${c.memo} ${c.name} ${br(c.date)} ${money.format(c.amount)}`.toLowerCase().includes(term))), [credits, status, term])
  const groups = useMemo(() => {
    const map = new Map<string, IncomingCredit[]>()
    for (const c of [...visible].sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)) map.set(c.date, [...(map.get(c.date) || []), c])
    return [...map.entries()]
  }, [visible])
  const visibleTotal = visible.reduce((s, c) => s + c.amount, 0)
  const pending = confirmableReceivables(receivables).sort((a, b) => String(a.dataPrevista || '').localeCompare(String(b.dataPrevista || '')))
  const byId = new Map(receivables.map((r) => [r.id, r]))

  async function audit(action: string, detail: string, entityId?: string) {
    if (!profile) return
    await addDoc(collection(db, 'auditLogs'), { action, module: 'Conferência de Entradas', detail, entityId: entityId ?? null, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() }).catch(() => undefined)
  }

  async function upload(file: File) {
    if (!profile) return
    setBusy(true); setMessage('')
    try {
      if (!/\.ofx$/i.test(file.name)) throw new Error('Envie o extrato no formato OFX (Itaú).')
      const incoming = creditsFromOfx(parseOfx(await readOfxFile(file)))
      const known = new Set(credits.map((c) => c.id))
      const fresh = incoming.filter((c) => !known.has(c.id))
      for (let i = 0; i < fresh.length; i += 400) {
        const batch = writeBatch(db)
        fresh.slice(i, i + 400).forEach(({ id, ...c }) => batch.set(doc(db, 'bankCredits', id), { ...c, importedBy: profile.uid, importedByName: profile.displayName ?? profile.email ?? '', importedAt: serverTimestamp(), matchedReceivableId: null }))
        await batch.commit()
      }
      setMessage(`${incoming.length} ${incoming.length === 1 ? 'entrada lida' : 'entradas lidas'} no extrato · ${fresh.length} ${fresh.length === 1 ? 'nova' : 'novas'} · ${incoming.length - fresh.length} já ${incoming.length - fresh.length === 1 ? 'estava' : 'estavam'} carregadas.`)
      await audit('Extrato de entradas carregado', `${file.name} · ${fresh.length} créditos novos`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Não foi possível ler o extrato.')
    } finally { setBusy(false) }
  }

  async function confirm(receivable: AnyRecord, credit: IncomingCredit) {
    if (!profile) return
    const label = String(receivable.processo || receivable.reclamante || receivable.descricao || receivable.id)
    if (!window.confirm(`Confirmar recebimento?\n\n${label}\n${money.format(credit.amount)} · crédito de ${br(credit.date)}\n${credit.memo}\n\nA receita passa a "Recebida" e este crédito fica vinculado a ela.`)) return
    setBusy(true); setMessage('')
    try {
      const by = profile.displayName ?? profile.email ?? ''
      const batch = writeBatch(db)
      batch.update(doc(db, 'receivables', receivable.id), { status: 'recebido_tesouraria', bankCreditId: credit.id, receiptDate: credit.date, updatedAt: serverTimestamp(), bankConfirmedBy: profile.uid, bankConfirmedByName: by, bankConfirmedAt: serverTimestamp() })
      batch.update(doc(db, 'bankCredits', credit.id), { matchedReceivableId: receivable.id, matchedAt: serverTimestamp(), matchedBy: profile.uid, matchedByName: by })
      await batch.commit()
      await audit('Recebimento confirmado pelo extrato', `${label} · ${money.format(credit.amount)} · crédito ${br(credit.date)}`, receivable.id)
      // Demonstrativo oficial: gera quando o perfil tem permissão; senão a Tesouraria gera ao encerrar.
      await ensureOfficialDemonstrative('revenue', { ...receivable, status: 'recebido_tesouraria', receiptDate: credit.date }, { generatedBy: profile.uid }).catch(() => undefined)
      setMessage(`${label}: recebimento confirmado.`)
    } catch {
      setMessage('Não foi possível confirmar. O crédito pode já ter sido usado em outra receita, ou o valor/data não confere. Atualize a página e tente de novo.')
    } finally { setBusy(false) }
  }

  return <div className="icp">
    <div className="page-heading">
      <div><span className="eyebrow">Receitas</span><h1>Conferência de Entradas</h1>
        <p>Entradas do extrato Itaú (OFX). Confirme aqui as receitas previstas que caíram na conta: elas passam direto a Recebidas.</p></div>
      {canUpload && <label className={`icp-upload ${busy ? 'busy' : ''}`}><Upload size={18} /> Extrato Bancário
        <input type="file" accept=".ofx" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} /></label>}
    </div>
    {error && <p className="icp-msg error" role="alert">{error}</p>}
    {message && <p className="icp-msg" role="status">{message}</p>}

    <section className="page-card icp-pending">
      <div className="card-title-row"><h2>Receitas previstas aguardando extrato</h2><small>{pending.length}</small></div>
      {pending.length === 0 ? <p className="dash-empty">Nenhuma receita prevista aguardando confirmação. Acordos parcelados continuam sendo confirmados pela Tesouraria.</p> : <div className="icp-pending-list">{pending.map((r) => {
        const options = suggestCredits(r, credits)
        const selected = options.find((c) => c.id === choice[r.id]) || options[0]
        return <div key={r.id} className="icp-rec">
          <span className="desc"><span>{String(r.processo || r.descricao || 'Receita')}</span><small>{String(r.reclamante || '')}{r.dataPrevista ? ` · previsto ${br(String(r.dataPrevista).slice(0, 10))}` : ''}</small></span>
          <strong className="icp-value">{money.format(Number(r.valorAlvara || 0))}</strong>
          {options.length === 0 ? <small className="icp-none">Nenhum crédito com esse valor no extrato.</small> : <span className="icp-rec-actions">
            <select aria-label="Crédito do extrato" value={selected?.id} onChange={(e) => setChoice((p) => ({ ...p, [r.id]: e.target.value }))}>
              {options.map((c) => <option key={c.id} value={c.id}>{br(c.date)} · {money.format(c.amount)} · {c.memo.slice(0, 40)}</option>)}
            </select>
            <button className="small-revenue-button" disabled={busy || !selected} onClick={() => selected && void confirm(r, selected)}>Confirmar recebimento</button>
          </span>}
        </div>
      })}</div>}
    </section>

    <section className="page-card icp-table-card">
      <div className="card-title-row icp-toolbar">
        <div className="icp-sheet-title"><h2><Landmark size={17} /> Extrato de entradas · Itaú PJ</h2>{visible.length > 0 && <small>Período {br(visible.reduce((m, c) => c.date < m ? c.date : m, visible[0].date))} a {br(visible.reduce((m, c) => c.date > m ? c.date : m, visible[0].date))}</small>}</div>
        <div className="icp-filters">
          <input type="search" placeholder="Buscar por valor, data ou histórico" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar entradas" />
          <select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="todos">Todas</option><option value="livres">Disponíveis</option><option value="vinculados">Vinculadas</option>
          </select>
        </div>
      </div>
      {credits.length === 0 ? <p className="dash-empty">{canUpload ? 'Clique em Extrato Bancário e carregue o OFX do Itaú.' : 'Nenhum extrato carregado ainda.'}</p>
        : groups.length === 0 ? <p className="dash-empty">Nenhuma entrada encontrada com esse filtro.</p> : <>
        <div className="icp-row icp-head"><span>Data</span><span>Lançamento</span><span>Conferência</span><span>Valor (R$)</span></div>
        {groups.map(([date, rows]) => <div key={date} className="icp-day">
          {rows.map((c) => {
            const linked = c.matchedReceivableId ? byId.get(c.matchedReceivableId) : null
            return <div key={c.id} className={`icp-row ${c.matchedReceivableId ? 'done' : ''}`}>
              <span className="date">{br(date)}</span>
              <span className="memo" title={`${c.memo} ${c.name}`.trim()}>{c.memo || c.name || 'Crédito'}</span>
              <span className="state">{c.matchedReceivableId ? <><CheckCircle2 size={13} /> {String(linked?.processo || linked?.reclamante || 'Vinculado')}{c.matchedByName ? ` · ${c.matchedByName}` : ''}</> : '—'}</span>
              <strong>{num.format(c.amount)} C</strong>
            </div>
          })}
          <div className="icp-row icp-subtotal"><span>{br(date)}</span><span>TOTAL DE ENTRADAS DO DIA</span><span /><strong>{num.format(rows.reduce((t, c) => t + c.amount, 0))}</strong></div>
        </div>)}
        <div className="icp-row icp-grand"><span /><span>TOTAL DE ENTRADAS NO PERÍODO · {visible.length} {visible.length === 1 ? 'lançamento' : 'lançamentos'}</span><span /><strong>{num.format(visibleTotal)}</strong></div>
      </>}
    </section>
  </div>
}
