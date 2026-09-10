import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { BadgeDollarSign, CheckCircle2, FileText, RefreshCw, Search, Send, Users, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { isOfficialDirectorEmail, useAuth } from '../auth/AuthContext'

type AnyRecord = { id: string } & DocumentData
type PaymentKind = 'client' | 'agent'
type InstallmentStatus = 'pendente' | 'aguardando_aprovacao' | 'aprovada' | 'paga'
type Installment = {
  number: number
  value: number
  dueDate: string
  status: InstallmentStatus
  paid: boolean
  paidDate: string
  approvedAt?: string
  approvedBy?: string
  approvedByName?: string
  paidRecordedAt?: string
  paidBy?: string
  paidByName?: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const today = () => new Date().toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()
const toNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[char] || char))
const dateBr = (value: unknown) => { const text = String(value ?? ''); if (!text) return '—'; const [year, month, day] = text.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : text }

const financialComponentCards = [
  { name: 'Imposto de Renda', label: 'Imposto de Renda' },
  { name: 'INSS', label: 'INSS' },
  { name: 'INSS Empregador', label: 'INSS Empregador' },
  { name: 'Honorários do Escritório', label: 'Honorários do Escritório' },
  { name: 'Honorários Perito', label: 'Honorários Perito' },
  { name: 'Ressarcimento de Custas', label: 'Ressarcimento de Custas' },
  { name: 'Despesas Bancárias / Tarifas', label: 'Despesas Bancárias / Tarifas' },
  { name: 'Outras Deduções / Participações - Geral 1', label: 'Outras Deduções / Participações 1' },
  { name: 'Outras Deduções / Participações - Geral 2', label: 'Outras Deduções / Participações 2' },
  { name: 'Outras Deduções / Participações', label: 'Comissões / Participações' },
] as const

function useCollectionRecords(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, name), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [name])
  return { records, loading }
}

function componentOf(item: AnyRecord, name: string) {
  const components = Array.isArray(item.components) ? item.components : []
  return components.find((component) => String(component?.nome ?? '').toLowerCase() === name.toLowerCase()) as DocumentData | undefined
}
function componentValue(item: AnyRecord, name: string) { return toNumber(componentOf(item, name)?.valor) }
function componentPercent(item: AnyRecord, name: string) { return toNumber(componentOf(item, name)?.percentual) }
function eligibleReceivable(item: AnyRecord) { return ['recebido_tesouraria', 'encerrado'].includes(String(item.status ?? '')) }

function addMonths(dateValue: string, months: number) {
  if (!dateValue) return ''
  const date = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateValue
  const originalDay = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(originalDay, lastDay))
  return date.toISOString().slice(0, 10)
}

function normalizeInstallment(item: DocumentData, index: number): Installment {
  const paid = Boolean(item?.paid) || item?.status === 'paga'
  const status = paid
    ? 'paga'
    : item?.status === 'aguardando_aprovacao' || item?.status === 'aprovada' || item?.status === 'pendente'
      ? item.status as InstallmentStatus
      : 'pendente'
  return {
    number: toNumber(item?.number) || index + 1,
    value: toNumber(item?.value),
    dueDate: String(item?.dueDate || ''),
    status,
    paid,
    paidDate: String(item?.paidDate || ''),
    approvedAt: item?.approvedAt ? String(item.approvedAt) : undefined,
    approvedBy: item?.approvedBy ? String(item.approvedBy) : undefined,
    approvedByName: item?.approvedByName ? String(item.approvedByName) : undefined,
    paidRecordedAt: item?.paidRecordedAt ? String(item.paidRecordedAt) : undefined,
    paidBy: item?.paidBy ? String(item.paidBy) : undefined,
    paidByName: item?.paidByName ? String(item.paidByName) : undefined,
  }
}

function makeInstallments(amount: number, count: number, firstDueDate: string): Installment[] {
  const safeCount = Math.max(1, Math.min(60, Math.trunc(count || 1)))
  const cents = Math.round(amount * 100)
  const base = Math.floor(cents / safeCount)
  let distributed = 0
  return Array.from({ length: safeCount }, (_, index) => {
    const installmentCents = index === safeCount - 1 ? cents - distributed : base
    distributed += installmentCents
    return { number: index + 1, value: installmentCents / 100, dueDate: addMonths(firstDueDate, index), status: 'pendente', paid: false, paidDate: '' }
  })
}

function sourceAmount(source: AnyRecord, kind: PaymentKind) {
  return kind === 'client' ? toNumber(source.valorLiquidoCliente) : toNumber(source.agentCommissionValue) || componentValue(source, 'Outras Deduções / Participações')
}
function sourceBeneficiary(source: AnyRecord, kind: PaymentKind) { return kind === 'client' ? String(source.titular || source.reclamante || 'Cliente') : String(source.agentName || 'Agente não informado') }
function planInstallments(plan?: AnyRecord): Installment[] { return (Array.isArray(plan?.installments) ? plan!.installments : []).map((item: DocumentData, index: number) => normalizeInstallment(item, index)) }
function planPaidValue(plan?: AnyRecord) { return planInstallments(plan).reduce((sum, item) => sum + (item.paid ? toNumber(item.value) : 0), 0) }
function nextInstallment(plan?: AnyRecord) { return planInstallments(plan).filter((item) => !item.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] }
function statusLabel(plan?: AnyRecord) {
  if (!plan) return 'Aguardando programação'
  const labels: Record<string, string> = { aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', rejeitado: 'Rejeitado', parcialmente_pago: 'Parcialmente pago', pago: 'Pago integralmente' }
  return labels[String(plan.status ?? '')] || String(plan.status ?? 'Aguardando programação')
}
function statusClass(plan?: AnyRecord) {
  if (!plan) return 'workflow-neutral'
  if (plan.status === 'pago' || plan.status === 'aprovado') return 'workflow-success'
  if (plan.status === 'rejeitado') return 'workflow-danger'
  if (plan.status === 'aguardando_aprovacao') return 'workflow-warning'
  if (plan.status === 'parcialmente_pago') return 'workflow-info'
  return 'workflow-neutral'
}
function installmentLabel(status: InstallmentStatus) {
  return { pendente: 'Pendente', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada', paga: 'Paga' }[status]
}
function installmentClass(status: InstallmentStatus) {
  if (status === 'paga' || status === 'aprovada') return 'workflow-success'
  if (status === 'aguardando_aprovacao') return 'workflow-warning'
  return 'workflow-neutral'
}

async function audit(profile: ReturnType<typeof useAuth>['profile'], module: string, action: string, detail: string, entityId: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), { action, module, detail, entityId, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() })
}

function openPdfPrint(title: string, body: string) {
  const reportWindow = window.open('', '_blank', 'width=1120,height=820')
  if (!reportWindow) { window.alert('O navegador bloqueou a janela do relatório. Libere pop-ups para gerar o PDF.'); return }
  reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:11px}h1{margin:0;text-align:center;font-size:18px}h2{font-size:13px;margin:14px 0 7px}.company{text-align:center;font-weight:700;font-size:12px;margin-bottom:3px}.subtitle{text-align:center;margin:3px 0 14px}.section{page-break-inside:avoid;margin-bottom:18px;border:1px solid #222}.meta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #222}.meta div{padding:5px 7px;border-right:1px solid #222;min-height:34px}.meta div:nth-child(4n){border-right:0}.meta b{display:block;font-size:9px;text-transform:uppercase;margin-bottom:3px}.wide{grid-column:span 2}.value{font-weight:700}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:6px;text-align:left;vertical-align:top}th{background:#efefef;text-align:center;font-size:9px;text-transform:uppercase}.num{text-align:right}.center{text-align:center}.total-row td{font-weight:700;background:#f7f7f7}.summary{margin-top:12px;display:flex;gap:20px;justify-content:flex-end}.summary b{font-size:12px}.footer{margin-top:18px;border-top:1px solid #999;padding-top:6px;color:#555;font-size:9px}.page-break{page-break-before:always}
  </style></head><body>${body}<div class="footer">FLÁVIO MARQUES ADVOGADOS ASSOCIADOS · Controle de Despesas e Receitas · Relatório gerado em ${new Date().toLocaleString('pt-BR')}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`)
  reportWindow.document.close()
}

function generatePaymentPdf(kind: PaymentKind, sources: AnyRecord[], planMap: Map<string, AnyRecord>) {
  const title = kind === 'client' ? 'REPASSE DE ALVARÁS' : 'RELATÓRIO DE COMISSÕES DE AGENTES'
  if (!sources.length) { window.alert('Não há registros no filtro atual para gerar o relatório.'); return }
  const sections = sources.map((source, index) => {
    const plan = planMap.get(source.id)
    const amount = sourceAmount(source, kind)
    const paid = planPaidValue(plan)
    const installments = planInstallments(plan)
    const percent = componentPercent(source, 'Outras Deduções / Participações')
    const header = `<div class="meta"><div class="wide"><b>${kind === 'client' ? 'Cliente / Titular' : 'Agente'}</b>${escapeHtml(sourceBeneficiary(source, kind))}</div><div><b>Data do recebimento</b>${escapeHtml(dateBr(source.data))}</div><div><b>Valor recebido</b><span class="value">${escapeHtml(money.format(toNumber(source.valorAlvara)))}</span></div><div class="wide"><b>Processo</b>${escapeHtml(source.processo || '—')}</div><div><b>Reclamante</b>${escapeHtml(source.reclamante || '—')}</div><div><b>Reclamada</b>${escapeHtml(source.reclamada || '—')}</div>${kind === 'client' ? `<div><b>CPF</b>${escapeHtml(source.cpf || '—')}</div><div><b>Banco / Agência / Conta</b>${escapeHtml(`${source.banco || '—'} / ${source.agencia || '—'} / ${source.conta || '—'}`)}</div><div><b>PIX</b>${escapeHtml(source.pix || '—')}</div>` : `<div><b>Comissão</b>${percent ? `${percent.toLocaleString('pt-BR')}%` : '—'}</div>`}</div>`
    const rows = installments.length ? installments.map((item) => `<tr><td class="center">${item.number}</td><td class="num">${escapeHtml(money.format(item.value))}</td><td class="center">${escapeHtml(dateBr(item.dueDate))}</td><td class="center">${escapeHtml(installmentLabel(item.status))}</td><td class="center">${escapeHtml(dateBr(item.paidDate))}</td></tr>`).join('') : `<tr><td colspan="5" class="center">Pagamento ainda não programado</td></tr>`
    return `<section class="section${index ? ' page-break' : ''}">${header}<table><thead><tr><th>Parcela</th><th>Valor</th><th>Data prevista</th><th>Status</th><th>Data pagamento</th></tr></thead><tbody>${rows}<tr class="total-row"><td>TOTAL DEVIDO</td><td class="num">${escapeHtml(money.format(amount))}</td><td>JÁ PAGO</td><td class="num">${escapeHtml(money.format(paid))}</td><td>SALDO: ${escapeHtml(money.format(Math.max(0, amount - paid)))}</td></tr></tbody></table><div class="summary"><span>Status consolidado: <b>${escapeHtml(statusLabel(plan))}</b></span></div></section>`
  }).join('')
  openPdfPrint(title, `<div class="company">FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</div><h1>${escapeHtml(title)}</h1><div class="subtitle">Controle financeiro por pagamento efetivo</div>${sections}`)
}

function SourceSnapshot({ source, kind }: { source: AnyRecord; kind: PaymentKind }) {
  return <div className="obligation-source-grid">
    <div><span>Processo</span><strong>{source.processo || '—'}</strong></div>
    <div><span>{kind === 'client' ? 'Cliente / Titular' : 'Agente'}</span><strong>{sourceBeneficiary(source, kind)}</strong></div>
    <div><span>Valor recebido</span><strong>{money.format(toNumber(source.valorAlvara))}</strong></div>
    <div><span>Reclamante</span><strong>{source.reclamante || '—'}</strong></div>
    <div><span>Reclamada</span><strong>{source.reclamada || '—'}</strong></div>
    {kind === 'client' && <><div><span>Banco</span><strong>{source.banco || '—'}</strong></div><div><span>Agência / Conta</span><strong>{source.agencia || '—'} / {source.conta || '—'}</strong></div><div><span>CPF</span><strong>{source.cpf || '—'}</strong></div><div><span>PIX</span><strong>{source.pix || '—'}</strong></div></>}
    <div className="obligation-source-value"><span>{kind === 'client' ? 'Valor líquido devido ao cliente' : 'Comissão devida'}</span><strong>{money.format(sourceAmount(source, kind))}</strong></div>
  </div>
}

function PaymentPlanModal({ source, plan, kind, collectionName, onClose }: { source: AnyRecord; plan?: AnyRecord; kind: PaymentKind; collectionName: string; onClose: () => void }) {
  const { profile } = useAuth()
  const canOperate = profile?.role === 'master' || profile?.role === 'tesouraria'
  const canApprove = profile?.role === 'master' || Boolean(profile && isOfficialDirectorEmail(profile.email) && profile.role === 'diretor')
  const amount = sourceAmount(source, kind)
  const isExecutionStage = Boolean(plan && ['aprovado', 'parcialmente_pago', 'pago'].includes(String(plan.status)))
  const [paymentType, setPaymentType] = useState<'avista' | 'parcelado'>(plan?.paymentType === 'parcelado' ? 'parcelado' : 'avista')
  const [count, setCount] = useState(Math.max(1, toNumber(plan?.installmentCount) || 1))
  const [firstDueDate, setFirstDueDate] = useState(String(plan?.firstDueDate || today()))
  const [installments, setInstallments] = useState<Installment[]>(() => {
    const existing = planInstallments(plan)
    return existing.length ? existing : makeInstallments(amount, 1, today())
  })
  const [approvalNote, setApprovalNote] = useState(String(plan?.approvalNote || ''))
  const [notes, setNotes] = useState(String(plan?.notes || ''))
  const [busy, setBusy] = useState(false)
  const moduleName = kind === 'client' ? 'Repasse de Alvarás' : 'Comissões de Agentes'
  const sum = installments.reduce((total, item) => total + toNumber(item.value), 0)

  function regenerate() {
    const quantity = paymentType === 'avista' ? 1 : Math.max(2, count)
    setCount(quantity)
    setInstallments(makeInstallments(amount, quantity, firstDueDate))
  }
  function patchInstallment(index: number, patch: Partial<Installment>) { setInstallments((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item)) }

  async function saveSchedule() {
    if (!profile || !canOperate) return
    if (kind === 'client' && (!String(source.banco || '').trim() || !String(source.agencia || '').trim() || !String(source.conta || '').trim() || !String(source.titular || '').trim() || !String(source.cpf || '').trim())) {
      window.alert('Para realizar o repasse ao cliente, preencha Banco, Agência, Conta, Nome/Titular e CPF no recebimento de origem.')
      return
    }
    if (!installments.length || installments.some((item) => !item.dueDate || toNumber(item.value) <= 0)) { window.alert('Informe valor e data de todas as parcelas.'); return }
    if (Math.abs(sum - amount) > 0.02) { window.alert(`A soma das parcelas deve ser igual ao valor devido (${money.format(amount)}).`); return }
    setBusy(true)
    try {
      const scheduled = installments.map((item, index) => ({ ...item, number: index + 1, status: 'aguardando_aprovacao' as InstallmentStatus, paid: false, paidDate: '', paidRecordedAt: undefined, paidBy: undefined, paidByName: undefined }))
      await setDoc(doc(db, collectionName, source.id), {
        sourceReceivableId: source.id,
        sourceType: kind === 'client' ? 'repasse_cliente' : 'comissao_agente',
        processo: source.processo || '', reclamante: source.reclamante || '', reclamada: source.reclamada || '', beneficiary: sourceBeneficiary(source, kind),
        amountReceived: toNumber(source.valorAlvara), amountDue: amount, paymentType, installmentCount: scheduled.length, firstDueDate: scheduled[0]?.dueDate || firstDueDate,
        installments: scheduled, status: 'aguardando_aprovacao', notes: notes.trim(), approvalNote: '', approvedBy: null, approvedByName: null, approvedAt: null,
        sourceSnapshot: { unidade: source.unidade || '', data: source.data || '', natureza: source.natureza || '', processo: source.processo || '', reclamante: source.reclamante || '', reclamada: source.reclamada || '', origem: source.origem || '', banco: source.banco || '', agencia: source.agencia || '', conta: source.conta || '', titular: source.titular || '', cpf: source.cpf || '', pix: source.pix || '', agentName: source.agentName || '', valorAlvara: toNumber(source.valorAlvara), valorLiquidoCliente: toNumber(source.valorLiquidoCliente), agentCommissionValue: sourceAmount(source, 'agent') },
        createdBy: plan?.createdBy || profile.uid, createdByName: plan?.createdByName || profile.displayName, createdAt: plan?.createdAt || serverTimestamp(), updatedBy: profile.uid, updatedByName: profile.displayName, updatedAt: serverTimestamp(),
      }, { merge: false })
      await audit(profile, moduleName, 'Programação enviada para aprovação', `Processo ${source.processo || '—'} — ${sourceBeneficiary(source, kind)} — ${money.format(amount)} em ${scheduled.length} parcela(s)`, source.id)
      onClose()
    } catch (error) { console.error(error); window.alert('Não foi possível salvar a programação.') } finally { setBusy(false) }
  }

  async function decide(status: 'aprovado' | 'rejeitado') {
    if (!profile || !canApprove || !plan) return
    setBusy(true)
    try {
      const decidedAt = nowIso()
      const decidedInstallments = installments.map((item) => ({
        ...item,
        status: status === 'aprovado' ? 'aprovada' as InstallmentStatus : 'pendente' as InstallmentStatus,
        approvedAt: status === 'aprovado' ? decidedAt : undefined,
        approvedBy: status === 'aprovado' ? profile.uid : undefined,
        approvedByName: status === 'aprovado' ? profile.displayName : undefined,
      }))
      await setDoc(doc(db, collectionName, source.id), { status, installments: decidedInstallments, approvalNote: approvalNote.trim(), approvedBy: profile.uid, approvedByName: profile.displayName, approvedByEmail: profile.email, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })
      await audit(profile, moduleName, status === 'aprovado' ? 'Pagamento e parcelas aprovados' : 'Pagamento rejeitado', `Processo ${source.processo || '—'} — ${money.format(amount)}${approvalNote.trim() ? ` — ${approvalNote.trim()}` : ''}`, source.id)
      onClose()
    } catch (error) { console.error(error); window.alert('Não foi possível registrar a decisão.') } finally { setBusy(false) }
  }

  async function saveExecution() {
    if (!profile || !canOperate || !plan) return
    const previous = planInstallments(plan)
    const recordedAt = nowIso()
    const finalized = installments.map((item, index) => {
      const wasPaid = Boolean(previous[index]?.paid)
      if (item.paid) return { ...item, status: 'paga' as InstallmentStatus, paidDate: item.paidDate || today(), paidRecordedAt: wasPaid ? item.paidRecordedAt : recordedAt, paidBy: wasPaid ? item.paidBy : profile.uid, paidByName: wasPaid ? item.paidByName : profile.displayName }
      return { ...item, status: 'aprovada' as InstallmentStatus, paidDate: '', paidRecordedAt: undefined, paidBy: undefined, paidByName: undefined }
    })
    const paidCount = finalized.filter((item) => item.paid).length
    const nextStatus = paidCount === 0 ? 'aprovado' : paidCount === finalized.length ? 'pago' : 'parcialmente_pago'
    setBusy(true)
    try {
      await setDoc(doc(db, collectionName, source.id), { installments: finalized, status: nextStatus, paidValue: finalized.reduce((total, item) => total + (item.paid ? toNumber(item.value) : 0), 0), updatedBy: profile.uid, updatedByName: profile.displayName, updatedAt: serverTimestamp() }, { merge: true })
      for (let index = 0; index < finalized.length; index += 1) {
        if (finalized[index].paid && !previous[index]?.paid) await audit(profile, moduleName, `Parcela ${finalized[index].number} paga`, `Processo ${source.processo || '—'} — ${sourceBeneficiary(source, kind)} — ${money.format(finalized[index].value)} em ${dateBr(finalized[index].paidDate)}`, source.id)
        if (!finalized[index].paid && previous[index]?.paid) await audit(profile, moduleName, `Pagamento da parcela ${finalized[index].number} desmarcado`, `Processo ${source.processo || '—'} — ${money.format(finalized[index].value)}`, source.id)
      }
      await audit(profile, moduleName, 'Execução de pagamento atualizada', `Processo ${source.processo || '—'} — ${paidCount}/${finalized.length} parcela(s) paga(s)`, source.id)
      onClose()
    } catch (error) { console.error(error); window.alert('Não foi possível atualizar a execução do pagamento.') } finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><section className="decision-modal obligation-modal" role="dialog" aria-modal="true">
    <div className="modal-toolbar"><div><span className="eyebrow">{moduleName}</span><h2>{plan ? 'Programação do pagamento' : 'Nova programação'}</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={20} /></button></div>
    <SourceSnapshot source={source} kind={kind} />
    {!isExecutionStage && <><div className="obligation-form-grid"><label><span>Forma de pagamento</span><select value={paymentType} disabled={!canOperate || plan?.status === 'aguardando_aprovacao'} onChange={(event) => { const value = event.target.value as 'avista' | 'parcelado'; setPaymentType(value); if (value === 'avista') setCount(1) }}><option value="avista">À vista</option><option value="parcelado">Parcelado</option></select></label><label><span>Número de parcelas</span><input type="number" min="1" max="60" value={paymentType === 'avista' ? 1 : count} disabled={!canOperate || paymentType === 'avista' || plan?.status === 'aguardando_aprovacao'} onChange={(event) => setCount(Math.max(1, Number(event.target.value)))} /></label><label><span>Primeira data prevista</span><input type="date" value={firstDueDate} disabled={!canOperate || plan?.status === 'aguardando_aprovacao'} onChange={(event) => setFirstDueDate(event.target.value)} /></label></div>{canOperate && plan?.status !== 'aguardando_aprovacao' && <button className="secondary-button obligation-generate" type="button" onClick={regenerate}>Gerar / atualizar parcelas</button>}</>}
    <div className="obligation-installments"><div className="obligation-installment-head enhanced"><span>Parcela</span><span>Valor</span><span>Data prevista</span><span>Status</span><span>Pago</span><span>Data do pagamento</span></div>{installments.map((item, index) => <div className="obligation-installment-row enhanced" key={item.number}><strong>{index + 1}/{installments.length}</strong><input type="number" min="0" step="0.01" value={item.value} disabled={isExecutionStage || !canOperate || plan?.status === 'aguardando_aprovacao'} onChange={(event) => patchInstallment(index, { value: Number(event.target.value) })} /><input type="date" value={item.dueDate} disabled={isExecutionStage || !canOperate || plan?.status === 'aguardando_aprovacao'} onChange={(event) => patchInstallment(index, { dueDate: event.target.value })} /><b className={`workflow-status-badge ${installmentClass(item.status)}`}>{installmentLabel(item.status)}</b><label className="obligation-paid-check"><input type="checkbox" checked={Boolean(item.paid)} disabled={!isExecutionStage || !canOperate || plan?.status === 'pago'} onChange={(event) => patchInstallment(index, { paid: event.target.checked, status: event.target.checked ? 'paga' : 'aprovada', paidDate: event.target.checked ? (item.paidDate || today()) : '' })} /><span>{item.paid ? 'Sim' : 'Não'}</span></label><input type="date" value={item.paidDate || ''} disabled={!isExecutionStage || !canOperate || !item.paid || plan?.status === 'pago'} onChange={(event) => patchInstallment(index, { paidDate: event.target.value })} /></div>)}<div className="obligation-installment-total enhanced"><span>Total programado</span><strong className={Math.abs(sum - amount) > .02 ? 'expense-text' : ''}>{money.format(sum)}</strong></div></div>
    <label className="obligation-notes"><span>Observações</span><textarea rows={3} value={notes} disabled={isExecutionStage || !canOperate || plan?.status === 'aguardando_aprovacao'} onChange={(event) => setNotes(event.target.value)} /></label>
    {plan?.status === 'aguardando_aprovacao' && <div className="obligation-approval-box"><strong>Aprovação do pagamento</strong><span>A aprovação é do repasse/comissão, não do recebimento do Alvará. Todas as parcelas passam de “Aguardando aprovação” para “Aprovada”.</span><textarea rows={2} placeholder="Observação da aprovação / motivo da rejeição (opcional)" value={approvalNote} disabled={!canApprove} onChange={(event) => setApprovalNote(event.target.value)} /></div>}
    {plan?.approvalNote && plan.status !== 'aguardando_aprovacao' && <div className="obligation-approval-note"><strong>Observação da decisão:</strong> {plan.approvalNote}</div>}
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Fechar</button>{canOperate && (!plan || plan.status === 'rejeitado') && <button className="revenue-button" type="button" disabled={busy} onClick={() => void saveSchedule()}><Send size={16} /> Enviar para aprovação</button>}{canApprove && plan?.status === 'aguardando_aprovacao' && <><button className="expense-button" type="button" disabled={busy} onClick={() => void decide('rejeitado')}>Rejeitar</button><button className="revenue-button" type="button" disabled={busy} onClick={() => void decide('aprovado')}><CheckCircle2 size={16} /> Aprovar pagamento</button></>}{canOperate && plan && ['aprovado', 'parcialmente_pago'].includes(String(plan.status)) && <button className="revenue-button" type="button" disabled={busy} onClick={() => void saveExecution()}><CheckCircle2 size={16} /> Salvar pagamentos</button>}</div>
  </section></div>
}

function PaymentControlPage({ kind }: { kind: PaymentKind }) {
  const collectionName = kind === 'client' ? 'alvaraTransfers' : 'agentCommissions'
  const title = kind === 'client' ? 'Repasse de Alvarás' : 'Comissões de Agentes'
  const subtitle = kind === 'client' ? 'Dinheiro de terceiro: controle separado de Despesas, com saída registrada pela data efetiva de cada pagamento.' : 'Controle separado das participações de agentes, com programação, aprovação e execução por parcela.'
  const { records: receivables, loading: loadingReceivables } = useCollectionRecords('receivables')
  const { records: plans, loading: loadingPlans } = useCollectionRecords(collectionName)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<AnyRecord | null>(null)
  const planMap = useMemo(() => new Map(plans.map((item) => [item.id, item])), [plans])
  const eligibleReceivables = useMemo(() => receivables.filter(eligibleReceivable), [receivables])
  const sources = useMemo(() => eligibleReceivables.filter((item) => {
    const amount = sourceAmount(item, kind)
    if (amount <= 0) return false
    if (kind === 'agent' && !String(item.agentName || '').trim()) return false
    return `${item.processo ?? ''} ${item.reclamante ?? ''} ${item.reclamada ?? ''} ${sourceBeneficiary(item, kind)}`.toLowerCase().includes(search.toLowerCase())
  }), [eligibleReceivables, kind, search])
  const totals = useMemo(() => sources.reduce((acc, source) => {
    const plan = planMap.get(source.id)
    const due = sourceAmount(source, kind)
    const paid = planPaidValue(plan)
    acc.received += toNumber(source.valorAlvara)
    acc.due += due
    acc.paid += paid
    acc.pending += Math.max(0, due - paid)
    if (plan?.status === 'aguardando_aprovacao') acc.approvals += 1
    acc.overdue += planInstallments(plan).filter((item) => !item.paid && item.dueDate && item.dueDate < today() && ['aprovado', 'parcialmente_pago'].includes(String(plan?.status))).length
    return acc
  }, { received: 0, due: 0, paid: 0, pending: 0, approvals: 0, overdue: 0 }), [kind, planMap, sources])
  const financialBreakdown = useMemo(() => {
    const values = financialComponentCards.map((card) => ({
      ...card,
      value: eligibleReceivables.reduce((sum, source) => sum + componentValue(source, card.name), 0),
    }))
    return { values, total: values.reduce((sum, item) => sum + item.value, 0) }
  }, [eligibleReceivables])
  const loading = loadingReceivables || loadingPlans
  const Icon = kind === 'client' ? BadgeDollarSign : Users

  return <><div className="page-heading"><div><span className="eyebrow">Controle financeiro separado</span><h1>{title}</h1><p>{subtitle}</p></div><div className="quick-actions"><button className="secondary-button" type="button" onClick={() => generatePaymentPdf(kind, sources, planMap)}><FileText size={17} /> Gerar PDF do relatório</button></div></div>
    <div className="obligation-metrics enhanced"><article><span>Valor recebido</span><strong>{money.format(totals.received)}</strong></article><article><span>{kind === 'client' ? 'Líquido devido' : 'Comissões devidas'}</span><strong>{money.format(totals.due)}</strong></article><article><span>Já pago</span><strong>{money.format(totals.paid)}</strong></article><article><span>Saldo a pagar</span><strong>{money.format(totals.pending)}</strong></article><article><span>Aguardando aprovação</span><strong>{totals.approvals}</strong></article><article><span>Parcelas vencidas</span><strong>{totals.overdue}</strong></article></div>
    {kind === 'client' && <section className="page-card module-card"><div className="module-toolbar"><div><span className="eyebrow">Informação financeira acumulada</span><h2>Composição dos Demonstrativos de Alvarás</h2><p>Valores extraídos automaticamente dos demonstrativos confirmados pela Tesouraria. Este quadro é informativo e não altera o fluxo de aprovação, baixa ou Contabilidade.</p></div></div><div className="obligation-metrics enhanced">{financialBreakdown.values.map((item) => <article key={item.name}><span>{item.label}</span><strong>{money.format(item.value)}</strong></article>)}<article><span>Total dos componentes</span><strong>{money.format(financialBreakdown.total)}</strong></article></div></section>}
    <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por processo, cliente, parte ou beneficiário" /></div></div>{loading ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando controle</strong></div> : sources.length === 0 ? <div className="module-empty"><Icon size={34} /><strong>Nenhum valor disponível para este controle</strong><span>Os registros entram automaticamente depois que a Tesouraria confirma o recebimento do Alvará.</span></div> : <div className="obligation-list enhanced"><div className="obligation-list-row obligation-list-head enhanced"><span>Processo / Beneficiário</span><span>Valor recebido</span><span>Valor devido</span><span>Já pago</span><span>Saldo</span><span>Próxima parcela</span><span>Status</span><span>Ação</span></div>{sources.map((source) => {
      const plan = planMap.get(source.id)
      const due = sourceAmount(source, kind)
      const paid = planPaidValue(plan)
      const next = nextInstallment(plan)
      return <div className="obligation-list-row enhanced" key={source.id}><span><strong>{source.processo || '—'}</strong><small>{sourceBeneficiary(source, kind)}</small></span><span><strong>{money.format(toNumber(source.valorAlvara))}</strong><small>{dateBr(source.data)}</small></span><span><strong>{money.format(due)}</strong></span><span><strong>{money.format(paid)}</strong></span><span><strong>{money.format(Math.max(0, due - paid))}</strong></span><span>{next ? <><strong>{money.format(next.value)}</strong><small>{dateBr(next.dueDate)} · {installmentLabel(next.status)}</small></> : <strong>—</strong>}</span><span><b className={`workflow-status-badge ${statusClass(plan)}`}>{statusLabel(plan)}</b></span><span><button className="small-neutral-button" type="button" onClick={() => setTarget(source)}>{plan ? 'Abrir controle' : 'Programar pagamento'}</button></span></div>
    })}</div>}</section>
    {target && <PaymentPlanModal source={target} plan={planMap.get(target.id)} kind={kind} collectionName={collectionName} onClose={() => setTarget(null)} />}</>
}

export function AlvaraTransfersPageV3() { return <PaymentControlPage kind="client" /> }
export function AgentCommissionsPageV3() { return <PaymentControlPage kind="agent" /> }
