import { getCurrentInstitutionalSettings } from '../hooks/useInstitutionalSettings'
import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { Copy, FileText, RefreshCw, Search, X } from 'lucide-react'
import { NFSE_FIXED_FIELDS, buildNfseDescription } from '../lib/nfseTemplate'
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

function fiscalClientName(source: AnyRecord) {
  return String(source.reclamante || source.titular || '')
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


type FichaData = {
  source: AnyRecord
  value: number
  description: string
  competence: string
  phone: string
  address: { cep?: unknown; street?: unknown; number?: unknown; complement?: unknown; district?: unknown; city?: unknown }
}

function fichaFromNote(source: AnyRecord, note?: AnyRecord): FichaData {
  return {
    source,
    value: invoiceValue(source),
    description: String(note?.description || buildNfseDescription(source)),
    competence: String(note?.competence || source.receiptDate || source.data || '').slice(0, 10),
    phone: String(note?.tomadorPhone || ''),
    address: (note?.tomadorAddress ?? {}) as FichaData['address'],
  }
}

function printFicha({ source, value, description, competence, phone, address }: FichaData) {
  const inst = getCurrentInstitutionalSettings()
  const v = (value: unknown) => escapeHtml(String(value ?? '').trim() || '—')
  const row = (label: string, value: unknown) => `<tr><th>${escapeHtml(label)}</th><td>${v(value)}</td></tr>`
  const section = (n: string, title: string, rows: string) => `<h2><span>${n}</span>${escapeHtml(title)}</h2><table>${rows}</table>`
  const w = window.open('', '_blank')
  if (!w) { window.alert('Libere pop-ups para baixar a ficha.'); return }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha NFS-e - ${escapeHtml(fiscalClientName(source))}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,Helvetica,sans-serif;color:#17202b;font-size:12px}h1{margin:0;font-size:18px;color:#17344f}.sub{color:#5b6775;margin:4px 0 16px}h2{display:flex;align-items:center;gap:8px;margin:18px 0 6px;font-size:13px;text-transform:uppercase;color:#24557d;border-bottom:2px solid #24557d;padding-bottom:4px}h2 span{background:#24557d;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px}table{width:100%;border-collapse:collapse}th{width:38%;text-align:left;font-weight:normal;color:#5b6775;padding:6px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top}td{padding:6px 8px;border-bottom:1px solid #e3e8ee;font-weight:bold}.value td{font-size:15px;color:#0b6b3a}.footer{margin-top:18px;color:#687585;font-size:9px}</style></head><body>
<h1>Ficha para emissão de NFS-e — Emissor Nacional</h1><div class="sub">Processo ${v(source.processo)} · Gerada em ${new Date().toLocaleString('pt-BR')}</div>
${section('1', 'Pessoas — Prestador', row('CNPJ', inst.cnpj) + row('Razão social', inst.razaoSocial) + row('Município', 'Rio de Janeiro/RJ'))}
${section('1', 'Pessoas — Tomador', row('CPF', source.cpf) + row('Nome', fiscalClientName(source)) + row('CEP', address.cep) + row('Logradouro', address.street) + row('Número', address.number) + row('Complemento', address.complement) + row('Bairro', address.district) + row('Município/UF', address.city) + row('Telefone', phone) + row('E-mail', source.emailNf) + (address.street ? '' : row('Endereço (cadastro da receita)', source.enderecoNf)))}
${section('2', 'Serviço', row('Data de competência', competence ? dateBr(competence) : '') + NFSE_FIXED_FIELDS.slice(0, 3).map((item) => row(item.label, item.value)).join('') + row('Descrição do serviço', description))}
${section('3', 'Valores e tributação', '<tr class="value"><th>Valor do serviço</th><td>' + escapeHtml(money.format(value)) + '</td></tr>' + NFSE_FIXED_FIELDS.slice(3).map((item) => row(item.label, item.value)).join(''))}
<div class="footer">${escapeHtml(inst.razaoSocial)} · Tesouraria FM · Dados fixos conforme NFS-e nº 303${source.unidade === 'SP' ? ' · ATENÇÃO: unidade SP — conferir local e códigos' : ''}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`
  w.document.write(html)
  w.document.close()
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
  const [description, setDescription] = useState(String(note?.description || buildNfseDescription(source)))
  const [competence, setCompetence] = useState(String(note?.competence || source.receiptDate || source.data || '').slice(0, 10))
  const savedAddress = (note?.tomadorAddress ?? {}) as Record<string, unknown>
  const [cep, setCep] = useState(String(savedAddress.cep ?? ''))
  const [street, setStreet] = useState(String(savedAddress.street ?? ''))
  const [streetNumber, setStreetNumber] = useState(String(savedAddress.number ?? ''))
  const [complement, setComplement] = useState(String(savedAddress.complement ?? ''))
  const [district, setDistrict] = useState(String(savedAddress.district ?? ''))
  const [city, setCity] = useState(String(savedAddress.city ?? 'Rio de Janeiro/RJ'))
  const [phone, setPhone] = useState(String(note?.tomadorPhone ?? ''))
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState(false)

  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(''), 1500) } catch { /* clipboard indisponível */ }
  }
  const copyButton = (key: string, text: string) => <button className="fiscal-copy-button" type="button" title="Copiar" onClick={() => void copy(key, text)} disabled={!text.trim()}>{copied === key ? 'Copiado' : <Copy size={14} />}</button>

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
        clientName: fiscalClientName(source),
        cpf: source.cpf || '',
        email: source.emailNf || '',
        address: source.enderecoNf || '',
        invoiceValue: value,
        number: number.trim(),
        issueDate,
        status,
        notes: notes.trim(),
        description: description.trim(),
        competence,
        tomadorPhone: phone.trim(),
        tomadorAddress: { cep: cep.trim(), street: street.trim(), number: streetNumber.trim(), complement: complement.trim(), district: district.trim(), city: city.trim() },
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
    <div className="fiscal-client-card"><div><span>Cliente</span><strong>{fiscalClientName(source) || '—'} {copyButton('name', fiscalClientName(source))}</strong></div><div><span>CPF</span><strong>{source.cpf || '—'} {copyButton('cpf', String(source.cpf || ''))}</strong></div><div><span>E-mail</span><strong>{source.emailNf || '—'} {copyButton('email', String(source.emailNf || ''))}</strong></div><div><span>Endereço</span><strong>{source.enderecoNf || '—'}</strong></div><div><span>Processo</span><strong>{source.processo || '—'}</strong></div><div className="fiscal-value"><span>Valor da NFS-e / Honorários</span><strong>{money.format(value)} {copyButton('value', value.toFixed(2).replace('.', ','))}</strong></div></div>
    <h3 className="fiscal-section-title">Endereço e telefone do tomador</h3>
    <div className="obligation-form-grid fiscal-form-grid fiscal-address-grid">
      <label><span>CEP</span><input value={cep} onChange={(event) => setCep(event.target.value)} placeholder="00000-000" /></label>
      <label className="fiscal-span-2"><span>Logradouro</span><input value={street} onChange={(event) => setStreet(event.target.value)} placeholder="Ex.: R Joaquim Martins" /></label>
      <label><span>Número</span><input value={streetNumber} onChange={(event) => setStreetNumber(event.target.value)} /></label>
      <label><span>Complemento</span><input value={complement} onChange={(event) => setComplement(event.target.value)} placeholder="Ex.: casa 10" /></label>
      <label><span>Bairro</span><input value={district} onChange={(event) => setDistrict(event.target.value)} /></label>
      <label><span>Município/UF</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
      <label><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(21) 90000-0000" /></label>
    </div>
    <h3 className="fiscal-section-title">Serviço</h3>
    <div className="obligation-form-grid fiscal-form-grid"><label><span>Competência</span><input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} /></label></div>
    <label className="obligation-notes"><span>Descrição do serviço {copyButton('description', description)}</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="fiscal-fixed-card"><span className="fiscal-fixed-title">Dados fixos do escritório no Emissor{source.unidade === 'SP' ? ' — atenção: unidade SP, conferir local e códigos' : ''}</span>{NFSE_FIXED_FIELDS.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
    <h3 className="fiscal-section-title">Controle da NFS-e</h3>
    <div className="obligation-form-grid fiscal-form-grid"><label><span>Status da NFS-e</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="pendente">Pendente de emissão</option><option value="emitida">Emitida</option><option value="cancelada">Cancelada</option></select></label><label><span>Número da NFS-e</span><input data-required-key="fiscal-number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Ex.: 0085967" /></label><label><span>Data de emissão</span><input data-required-key="fiscal-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label></div>
    <label className="obligation-notes"><span>Observações</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Fechar</button><button className="secondary-button" type="button" onClick={() => printFicha({ source, value, description, competence, phone, address: { cep, street, number: streetNumber, complement, district, city } })}><FileText size={16} /> Baixar ficha para emissão</button>{canEdit && <button className="revenue-button" type="button" disabled={busy} onClick={() => void save()}><FileText size={16} /> Salvar controle da NFS-e</button>}</div>
  </section></div>
}

function printExtract(sources: AnyRecord[], noteMap: Map<string, AnyRecord>) {
  if (!sources.length) {
    window.alert('Não há registros para gerar o extrato de NFS-e.')
    return
  }
  const rows = sources.map((source) => {
    const note = noteMap.get(source.id)
    return `<tr><td>${escapeHtml(source.processo || '—')}</td><td>${escapeHtml(fiscalClientName(source) || '—')}</td><td>${escapeHtml(source.cpf || '—')}</td><td>${escapeHtml(source.emailNf || '—')}</td><td class="num">${escapeHtml(money.format(invoiceValue(source)))}</td><td>${escapeHtml(statusLabel(note))}</td><td>${escapeHtml(note?.number || '—')}</td><td>${escapeHtml(dateBr(note?.issueDate))}</td></tr>`
  }).join('')
  const w = window.open('', '_blank', 'width=1200,height=820')
  if (!w) {
    window.alert('O navegador bloqueou a janela do relatório. Libere pop-ups para gerar o extrato.')
    return
  }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato de NFS-e</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,Helvetica,sans-serif;color:#17202b;font-size:11px}h1{text-align:center;margin:0 0 6px;font-size:20px}.sub{text-align:center;margin-bottom:18px;color:#5b6775}table{width:100%;border-collapse:collapse}th{background:#24557d;color:white;padding:8px;text-align:left}td{padding:7px;border-bottom:1px solid #ddd;vertical-align:top}.num{text-align:right;white-space:nowrap}tbody tr:nth-child(even){background:#f6f8fa}.footer{margin-top:16px;color:#687585;font-size:9px}</style></head><body><h1>${escapeHtml(getCurrentInstitutionalSettings().razaoSocial)}</h1><div class="sub">Extrato de NFS-e — Status e numeração das Notas Fiscais de Serviço</div><table><thead><tr><th>Processo</th><th>Cliente</th><th>CPF</th><th>E-mail</th><th>Valor</th><th>Status NFS-e</th><th>Nº NFS-e</th><th>Emissão</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Controle de Despesas e Receitas · Gerado em ${new Date().toLocaleString('pt-BR')}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`)
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
    <div className="page-heading"><div><span className="eyebrow">Apoio à emissão</span><h1>Nota Fiscal</h1><p>Os dados do cliente e o valor dos honorários são trazidos automaticamente do Demonstrativo de Recebimento de Honorários.</p></div><div className="quick-actions"><a className="nfse-logo-button" href="https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional%2fNotas%2fEmitidas" target="_blank" rel="noopener noreferrer" title="Emissão de NFS-e — Portal Nacional" aria-label="Emissão de NFS-e"><img src="/nfse-logo.png" alt="NFS-e — Emissão de Nota Fiscal de Serviço Eletrônica" /></a><button className="secondary-button" type="button" onClick={() => printExtract(sources, noteMap)}><FileText size={17} /> Gerar Extrato NFS-e</button></div></div>
    <div className="obligation-metrics fiscal-metrics"><article><span>Notas pendentes</span><strong>{pending}</strong></article><article><span>Notas emitidas</span><strong>{issued}</strong></article><article><span>Valor total dos honorários</span><strong>{money.format(total)}</strong></article></div>
    <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por processo, cliente, CPF, status ou nº da NFS-e" /></div></div>
      {loadingReceivables || loadingNotes ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando Notas Fiscais</strong></div> : sources.length === 0 ? <div className="module-empty"><FileText size={34} /><strong>Nenhum honorário disponível para emissão</strong></div> : <div className="obligation-list fiscal-v3-list"><div className="obligation-list-row obligation-list-head"><span>Processo / Cliente</span><span>CPF</span><span>E-mail</span><span>Valor</span><span>Status NFS-e</span><span>Nº NFSe e Data</span><span>Ação</span></div>{sources.map((source) => {
        const note = noteMap.get(source.id)
        return <div className="obligation-list-row" key={source.id}><span><strong>{source.processo || '—'}</strong><small>{fiscalClientName(source) || '—'}</small></span><span>{source.cpf || '—'}</span><span className="fiscal-email-cell">{source.emailNf || '—'}</span><span><strong>{money.format(invoiceValue(source))}</strong></span><span><b className={`workflow-status-badge ${statusClass(note)}`}>{statusLabel(note)}</b></span><span className="fiscal-number-cell"><strong>{note?.number || '—'}</strong>{note?.issueDate && <small>{dateBr(note.issueDate)}</small>}</span><span className="fiscal-actions-cell"><button className="small-neutral-button" type="button" onClick={() => setTarget(source)}>{note ? 'Abrir controle' : 'Preparar NFS-e'}</button><button className="small-neutral-button" type="button" title="Baixar ficha para emissão" onClick={() => printFicha(fichaFromNote(source, note))}>Ficha</button></span></div>
      })}</div>}
    </section>
    {target && <FiscalNoteModal source={target} note={noteMap.get(target.id)} onClose={() => setTarget(null)} />}
  </>
}
