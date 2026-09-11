import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { FileText, RefreshCw, Search, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'
import '../fiscal-notes-v3.css'

type AnyRecord = { id: string } & DocumentData

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const toNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))
const dateBr = (value: unknown) => {
  const text = String(value ?? '')
  if (!text) return '—'
  const [year, month, day] = text.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : text
}

function useCollectionRecords(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [name])
  return { records, loading }
}

function componentValue(item: AnyRecord, name: string) {
  const components = Array.isArray(item.components) ? item.components : []
  const component = components.find((row: DocumentData) => String(row?.nome ?? '').toLowerCase() === name.toLowerCase())
  return toNumber(component?.valor)
}

function eligibleReceivable(item: AnyRecord) {
  return ['recebido_tesouraria', 'encerrado'].includes(String(item.status ?? ''))
}

function invoiceValue(source: AnyRecord) {
  return toNumber(source.invoiceValue) || componentValue(source, 'Honorários do Escritório')
}

function statusLabel(note?: AnyRecord) {
  if (note?.status === 'emitida') return 'Emitida'
  if (note?.status === 'cancelada') return 'Cancelada'
  return 'Pendente'
}

function statusClass(note?: AnyRecord) {
  if (note?.status === 'emitida') return 'workflow-success'
  if (note?.status === 'cancelada') return 'workflow-danger'
  return 'workflow-warning'
}

async function audit(profile: ReturnType<typeof useAuth>['profile'], action: string, detail: string, entityId: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), {
    action,
    module: 'Nota Fiscal',
    detail,
    entityId,
    userId: profile.uid,
    userName: profile.displayName,
    userEmail: profile.email,
    createdAt: serverTimestamp(),
  })
}

function FiscalNoteModal({ source, note, onClose }: { source: AnyRecord; note?: AnyRecord; onClose: () => void }) {
  const { profile } = useAuth()
  const canEdit = ['master', 'diretor', 'gerente', 'tesouraria'].includes(String(profile?.role ?? ''))
  const value = invoiceValue(source)
  const [number, setNumber] = useState(String(note?.number || ''))
  const [issueDate, setIssueDate] = useState(String(note?.issueDate || ''))
  const [status, setStatus] = useState(String(note?.status || 'pendente'))
  const [notes, setNotes] = useState(String(note?.notes || ''))
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!profile || !canEdit) return
    if (status === 'emitida') {
      const missingKeys: string[] = []
      if (!number.trim()) missingKeys.push('fiscal-number')
      if (!issueDate) missingKeys.push('fiscal-date')
      if (missingKeys.length) { showRequiredFieldErrors('.obligation-modal', missingKeys); return }
    }
    clearRequiredFieldErrors('.obligation-modal')
    setBusy(true)
    try {
      await setDoc(doc(db, 'fiscalNotes', source.id), {
        sourceReceivableId: source.id,
        processo: source.processo || '',
        clientName: source.titular || source.reclamante || '',
        cpf: source.cpf || '',
        email: source.emailNf || '',
        address: source.enderecoNf || '',
        invoiceValue: value,
        number: number.trim(),
        issueDate,
        status,
        notes: notes.trim(),
        sourceSnapshot: {
          unidade: source.unidade || '', natureza: source.natureza || '', processo: source.processo || '',
          reclamante: source.reclamante || '', reclamada: source.reclamada || '', titular: source.titular || '',
          cpf: source.cpf || '', emailNf: source.emailNf || '', enderecoNf: source.enderecoNf || '',
          valorAlvara: toNumber(source.valorAlvara), invoiceValue: value,
        },
        updatedBy: profile.uid,
        updatedByName: profile.displayName,
        updatedAt: serverTimestamp(),
        createdBy: note?.createdBy || profile.uid,
        createdAt: note?.createdAt || serverTimestamp(),
      }, { merge: false })
      await audit(
        profile,
        status === 'emitida' ? 'NFS-e registrada como emitida' : status === 'cancelada' ? 'NFS-e registrada como cancelada' : 'Controle de NFS-e atualizado',
        `Processo ${source.processo || '—'} — ${money.format(value)}${number.trim() ? ` — NFS-e ${number.trim()}` : ''}`,
        source.id,
      )
      onClose()
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível atualizar o controle da NFS-e.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop"><section className="decision-modal obligation-modal" role="dialog" aria-modal="true">
    <div className="modal-toolbar"><div><span className="eyebrow">Nota Fiscal / NFS-e</span><h2>Dados para emissão</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={20} /></button></div>
    <div className="fiscal-client-card"><div><span>Cliente</span><strong>{source.titular || source.reclamante || '—'}</strong></div><div><span>CPF</span><strong>{source.cpf || '—'}</strong></div><div><span>E-mail</span><strong>{source.emailNf || '—'}</strong></div><div><span>Endereço</span><strong>{source.enderecoNf || '—'}</strong></div><div><span>Processo</span><strong>{source.processo || '—'}</strong></div><div className="fiscal-value"><span>Valor da NFS-e / Honorários</span><strong>{money.format(value)}</strong></div></div>
    <div className="obligation-form-grid fiscal-form-grid"><label><span>Status da NFS-e</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="pendente">Pendente de emissão</option><option value="emitida">Emitida</option><option value="cancelada">Cancelada</option></select></label><label><span>Número da NFS-e</span><input data-required-key="fiscal-number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Ex.: 0085967" /></label><label><span>Data de emissão</span><input data-required-key="fiscal-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label></div>
    <label className="obligation-notes"><span>Observações</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Fechar</button>{canEdit && <button className="revenue-button" type="button" disabled={busy} onClick={() => void save()}><FileText size={16} /> Salvar controle da NFS-e</button>}</div>
  </section></div>
}

function printExtract(sources: AnyRecord[], noteMap: Map<string, AnyRecord>) {
  if (!sources.length) {
    window.alert('Não há registros para gerar o extrato de NFS-e.')
    return
  }
  const rows = sources.map((source) => {
    const note = noteMap.get(source.id)
    return `<tr><td>${escapeHtml(source.processo || '—')}</td><td>${escapeHtml(source.titular || source.reclamante || '—')}</td><td>${escapeHtml(source.cpf || '—')}</td><td>${escapeHtml(source.emailNf || '—')}</td><td class="num">${escapeHtml(money.format(invoiceValue(source)))}</td><td>${escapeHtml(statusLabel(note))}</td><td>${escapeHtml(note?.number || '—')}</td><td>${escapeHtml(dateBr(note?.issueDate))}</td></tr>`
  }).join('')
  const w = window.open('', '_blank', 'width=1200,height=820')
  if (!w) {
    window.alert('O navegador bloqueou a janela do relatório. Libere pop-ups para gerar o extrato.')
    return
  }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato de NFS-e</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,Helvetica,sans-serif;color:#17202b;font-size:11px}h1{text-align:center;margin:0 0 6px;font-size:20px}.sub{text-align:center;margin-bottom:18px;color:#5b6775}table{width:100%;border-collapse:collapse}th{background:#24557d;color:white;padding:8px;text-align:left}td{padding:7px;border-bottom:1px solid #ddd;vertical-align:top}.num{text-align:right;white-space:nowrap}tbody tr:nth-child(even){background:#f6f8fa}.footer{margin-top:16px;color:#687585;font-size:9px}</style></head><body><h1>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</h1><div class="sub">Extrato de NFS-e — Status e numeração das Notas Fiscais de Serviço</div><table><thead><tr><th>Processo</th><th>Cliente</th><th>CPF</th><th>E-mail</th><th>Valor</th><th>Status NFS-e</th><th>Nº NFS-e</th><th>Emissão</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Controle de Despesas e Receitas · Gerado em ${new Date().toLocaleString('pt-BR')}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`)
  w.document.close()
}

export function FiscalNotesPageV3() {
  const { records: receivables, loading: loadingReceivables } = useCollectionRecords('receivables')
  const { records: notes, loading: loadingNotes } = useCollectionRecords('fiscalNotes')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<AnyRecord | null>(null)
  const noteMap = useMemo(() => new Map(notes.map((item) => [item.id, item])), [notes])

  const sources = useMemo(() => receivables.filter((item) => {
    if (!eligibleReceivable(item) || invoiceValue(item) <= 0) return false
    const note = noteMap.get(item.id)
    const haystack = `${item.processo ?? ''} ${item.reclamante ?? ''} ${item.titular ?? ''} ${item.cpf ?? ''} ${item.emailNf ?? ''} ${note?.number ?? ''} ${statusLabel(note)}`.toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  }), [noteMap, receivables, search])

  const pending = sources.filter((source) => !noteMap.get(source.id) || noteMap.get(source.id)?.status === 'pendente').length
  const issued = sources.filter((source) => noteMap.get(source.id)?.status === 'emitida').length
  const total = sources.reduce((sum, source) => sum + invoiceValue(source), 0)

  return <>
    <div className="page-heading"><div><span className="eyebrow">Apoio à emissão</span><h1>Nota Fiscal</h1><p>Os dados do cliente e o valor dos honorários são trazidos automaticamente do Demonstrativo de Recebimento de Honorários.</p></div><div className="quick-actions"><button className="secondary-button" type="button" onClick={() => printExtract(sources, noteMap)}><FileText size={17} /> Gerar Extrato NFS-e</button></div></div>
    <div className="obligation-metrics fiscal-metrics"><article><span>Notas pendentes</span><strong>{pending}</strong></article><article><span>Notas emitidas</span><strong>{issued}</strong></article><article><span>Valor total dos honorários</span><strong>{money.format(total)}</strong></article></div>
    <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por processo, cliente, CPF, status ou nº da NFS-e" /></div></div>
      {loadingReceivables || loadingNotes ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando Notas Fiscais</strong></div> : sources.length === 0 ? <div className="module-empty"><FileText size={34} /><strong>Nenhum honorário disponível para emissão</strong></div> : <div className="obligation-list fiscal-v3-list"><div className="obligation-list-row obligation-list-head"><span>Processo / Cliente</span><span>CPF</span><span>E-mail</span><span>Valor</span><span>Status NFS-e</span><span>Nº NFSe e Data</span><span>Ação</span></div>{sources.map((source) => {
        const note = noteMap.get(source.id)
        return <div className="obligation-list-row" key={source.id}><span><strong>{source.processo || '—'}</strong><small>{source.titular || source.reclamante || '—'}</small></span><span>{source.cpf || '—'}</span><span className="fiscal-email-cell">{source.emailNf || '—'}</span><span><strong>{money.format(invoiceValue(source))}</strong></span><span><b className={`workflow-status-badge ${statusClass(note)}`}>{statusLabel(note)}</b></span><span className="fiscal-number-cell"><strong>{note?.number || '—'}</strong>{note?.issueDate && <small>{dateBr(note.issueDate)}</small>}</span><span><button className="small-neutral-button" type="button" onClick={() => setTarget(source)}>{note ? 'Abrir controle' : 'Preparar NFS-e'}</button></span></div>
      })}</div>}
    </section>
    {target && <FiscalNoteModal source={target} note={noteMap.get(target.id)} onClose={() => setTarget(null)} />}
  </>
}
