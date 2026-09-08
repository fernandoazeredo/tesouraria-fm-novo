import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { CheckCircle2, FileText, Plus, RefreshCw, Search, Send, Trash2, Users, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { isOfficialDirectorEmail, useAuth } from '../auth/AuthContext'
import '../agent-commissions-v4.css'

type AnyRecord = { id: string } & DocumentData
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
type Deduction = { id: string; date: string; description: string; value: number }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const decimalBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()
const toNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0 }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))
const dateBr = (value: unknown) => { const text = String(value ?? ''); if (!text) return '—'; const [year, month, day] = text.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : text }

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
function sourceGrossCommission(source: AnyRecord) { return toNumber(source.agentCommissionValue) || toNumber(componentOf(source, 'Outras Deduções / Participações')?.valor) }
function sourceCommissionPercent(source: AnyRecord) { return toNumber(componentOf(source, 'Outras Deduções / Participações')?.percentual) }
function beneficiary(source: AnyRecord) { return String(source.agentName || 'Agente não informado') }
function eligible(source: AnyRecord) { return ['recebido_tesouraria', 'encerrado'].includes(String(source.status ?? '')) && sourceGrossCommission(source) > 0 && Boolean(String(source.agentName || '').trim()) }

function parseBrazilianNumber(value: string) {
  const cleaned = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '')
  if (!cleaned) return 0
  let normalized = cleaned
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.')
  else {
    const dots = cleaned.match(/\./g)?.length ?? 0
    if (dots > 1 || (dots === 1 && /^-?\d{1,3}\.\d{3}$/.test(cleaned))) normalized = cleaned.replace(/\./g, '')
  }
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function MoneyInputBR({ value, onChange, disabled = false, ariaLabel }: { value: number; onChange: (value: number) => void; disabled?: boolean; ariaLabel?: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value > 0 ? decimalBR.format(value) : '')
  useEffect(() => { if (!focused) setText(value > 0 ? decimalBR.format(value) : '') }, [focused, value])
  return <input type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} placeholder="0,00" value={text}
    onFocus={(event) => { setFocused(true); event.currentTarget.select() }}
    onChange={(event) => { setText(event.target.value); onChange(Math.max(0, parseBrazilianNumber(event.target.value))) }}
    onBlur={() => { setFocused(false); setText(value > 0 ? decimalBR.format(value) : '') }} />
}

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

function normalizeInstallment(item: DocumentData, index: number): Installment {
  const paid = Boolean(item?.paid) || item?.status === 'paga'
  const status: InstallmentStatus = paid ? 'paga' : ['pendente', 'aguardando_aprovacao', 'aprovada'].includes(String(item?.status)) ? item.status as InstallmentStatus : 'pendente'
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
function normalizeDeductions(plan?: AnyRecord): Deduction[] {
  const rows = Array.isArray(plan?.deductions) ? plan!.deductions : []
  return rows.map((item: DocumentData, index: number) => ({ id: String(item?.id || `ded-${index}`), date: String(item?.date || ''), description: String(item?.description || ''), value: toNumber(item?.value) }))
}
function planInstallments(plan?: AnyRecord) { return (Array.isArray(plan?.installments) ? plan!.installments : []).map((item: DocumentData, index: number) => normalizeInstallment(item, index)) }
function paidValue(plan?: AnyRecord) { return planInstallments(plan).reduce((sum, item) => sum + (item.paid ? item.value : 0), 0) }
function deductionTotal(plan?: AnyRecord) { return toNumber(plan?.deductionTotal) || normalizeDeductions(plan).reduce((sum, item) => sum + item.value, 0) }
function netDue(source: AnyRecord, plan?: AnyRecord) { return plan && (plan.netAmountDue != null || plan.amountDue != null) ? toNumber(plan.netAmountDue ?? plan.amountDue) : Math.max(0, sourceGrossCommission(source) - deductionTotal(plan)) }
function nextInstallment(plan?: AnyRecord) { return planInstallments(plan).filter((item) => !item.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] }
function statusLabel(plan?: AnyRecord) {
  if (!plan) return 'Aguardando programação'
  const labels: Record<string, string> = { aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', rejeitado: 'Rejeitado', parcialmente_pago: 'Parcialmente pago', pago: 'Pago integralmente' }
  return labels[String(plan.status ?? '')] || String(plan.status ?? '')
}
function statusClass(plan?: AnyRecord) {
  if (!plan) return 'workflow-neutral'
  if (plan.status === 'pago' || plan.status === 'aprovado') return 'workflow-success'
  if (plan.status === 'rejeitado') return 'workflow-danger'
  if (plan.status === 'aguardando_aprovacao') return 'workflow-warning'
  if (plan.status === 'parcialmente_pago') return 'workflow-info'
  return 'workflow-neutral'
}
function installmentLabel(status: InstallmentStatus) { return { pendente: 'Pendente', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada', paga: 'Paga' }[status] }
function installmentClass(status: InstallmentStatus) { return status === 'paga' || status === 'aprovada' ? 'workflow-success' : status === 'aguardando_aprovacao' ? 'workflow-warning' : 'workflow-neutral' }

async function audit(profile: ReturnType<typeof useAuth>['profile'], action: string, detail: string, entityId: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), { action, module: 'Comissões de Agentes', detail, entityId, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() })
}

function openPdfPrint(body: string) {
  const reportWindow = window.open('', '_blank', 'width=1120,height=820')
  if (!reportWindow) { window.alert('O navegador bloqueou a janela do relatório. Libere pop-ups para gerar o PDF.'); return }
  reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de Comissões</title><style>
    @page{size:A4 portrait;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:11px}h1{text-align:center;font-size:18px;font-weight:500;margin:0 0 24px}.generated{margin-bottom:22px}.meta{display:grid;grid-template-columns:180px 1fr;gap:8px 14px;margin-bottom:25px}.meta b{font-size:11px}.section{page-break-inside:avoid;margin-bottom:26px}.page-break{page-break-before:always}table{width:100%;border-collapse:collapse}th{background:#24557d;color:#fff;padding:8px;text-align:center}td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}tbody tr:nth-child(odd){background:#f5f5f5}.num{text-align:right;white-space:nowrap}.center{text-align:center}.balance{font-weight:700}.summary{margin-top:18px;font-size:13px}.summary b{font-size:14px}.note{margin-top:8px;color:#555}.company{font-weight:700}.process{font-size:10px;line-height:1.4}.footer{margin-top:26px;border-top:1px solid #bbb;padding-top:7px;color:#666;font-size:9px}
  </style></head><body>${body}<div class="footer">FLÁVIO MARQUES ADVOGADOS ASSOCIADOS · Controle de Despesas e Receitas · Relatório gerado em ${new Date().toLocaleString('pt-BR')}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`)
  reportWindow.document.close()
}

function generatePdf(sources: AnyRecord[], planMap: Map<string, AnyRecord>) {
  if (!sources.length) { window.alert('Não há comissões no filtro atual.'); return }
  const sections = sources.map((source, sectionIndex) => {
    const plan = planMap.get(source.id)
    const gross = sourceGrossCommission(source)
    const deductions = normalizeDeductions(plan)
    const installments = planInstallments(plan).filter((item) => item.paid)
    const account = String(plan?.accountingAccount || '—')
    let balance = 0
    const rows: string[] = []
    balance += gross
    rows.push(`<tr><td class="center">${escapeHtml(dateBr(source.data))}</td><td><div class="process">REF. RECEBIMENTO DE HONORÁRIOS<br>PROCESSO Nº ${escapeHtml(source.processo || '—')} · Autor: ${escapeHtml(source.reclamante || '—')} x ${escapeHtml(source.reclamada || '—')}</div></td><td class="num">${money.format(0)}</td><td class="num">${money.format(gross)}</td><td class="num balance">${money.format(balance)}</td></tr>`)
    for (const deduction of deductions) {
      balance -= deduction.value
      rows.push(`<tr><td class="center">${escapeHtml(dateBr(deduction.date))}</td><td>REF. ${escapeHtml((deduction.description || 'DEDUÇÃO').toUpperCase())} · PROCESSO Nº ${escapeHtml(source.processo || '—')}</td><td class="num">${escapeHtml(money.format(deduction.value))}</td><td class="num">${money.format(0)}</td><td class="num balance">${escapeHtml(money.format(balance))}</td></tr>`)
    }
    for (const installment of installments) {
      balance -= installment.value
      rows.push(`<tr><td class="center">${escapeHtml(dateBr(installment.paidDate))}</td><td>REF. PAGAMENTO PARTICIPAÇÃO · PARCELA ${installment.number}</td><td class="num">${escapeHtml(money.format(installment.value))}</td><td class="num">${money.format(0)}</td><td class="num balance">${escapeHtml(money.format(balance))}</td></tr>`)
    }
    const monthText = source.data ? new Date(`${String(source.data).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase() : '—'
    return `<section class="section${sectionIndex ? ' page-break' : ''}"><h1>Relatório de Comissões - Flávio Marques Advogados Associados</h1><div class="generated">Documento gerado em ${new Date().toLocaleString('pt-BR')}</div><div class="meta"><b>Relatório:</b><span>${escapeHtml(beneficiary(source))}</span><b>Conta Contábil:</b><span>${escapeHtml(account)}</span><b>Mês:</b><span>${escapeHtml(monthText)}</span><b>Ano:</b><span>${escapeHtml(String(source.data || '').slice(0,4) || '—')}</span><b>Saldo Anterior:</b><span>${money.format(0)}</span></div><table><thead><tr><th>Data</th><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Saldo</th></tr></thead><tbody>${rows.join('')}</tbody></table><div class="summary">SALDO FINAL <b>${escapeHtml(money.format(Math.max(0, balance)))}</b></div><div class="note">Comissão bruta: ${escapeHtml(money.format(gross))} · Deduções: ${escapeHtml(money.format(deductions.reduce((sum, item) => sum + item.value, 0)))} · Líquido programável: ${escapeHtml(money.format(netDue(source, plan)))}</div></section>`
  }).join('')
  openPdfPrint(sections)
}

function CommissionModal({ source, plan, onClose }: { source: AnyRecord; plan?: AnyRecord; onClose: () => void }) {
  const { profile } = useAuth()
  const canOperate = profile?.role === 'master' || profile?.role === 'tesouraria'
  const canApprove = profile?.role === 'master' || Boolean(profile && isOfficialDirectorEmail(profile.email) && profile.role === 'diretor')
  const gross = sourceGrossCommission(source)
  const editable = !plan || plan.status === 'rejeitado'
  const execution = Boolean(plan && ['aprovado', 'parcialmente_pago', 'pago'].includes(String(plan.status)))
  const [accountingAccount, setAccountingAccount] = useState(String(plan?.accountingAccount || ''))
  const [deductions, setDeductions] = useState<Deduction[]>(() => normalizeDeductions(plan))
  const [paymentType, setPaymentType] = useState<'avista' | 'parcelado'>(plan?.paymentType === 'parcelado' ? 'parcelado' : 'avista')
  const [count, setCount] = useState(Math.max(1, toNumber(plan?.installmentCount) || 1))
  const [firstDueDate, setFirstDueDate] = useState(String(plan?.firstDueDate || today()))
  const [installments, setInstallments] = useState<Installment[]>(() => { const rows = planInstallments(plan); return rows.length ? rows : makeInstallments(gross, 1, today()) })
  const [approvalNote, setApprovalNote] = useState(String(plan?.approvalNote || ''))
  const [notes, setNotes] = useState(String(plan?.notes || ''))
  const [busy, setBusy] = useState(false)

  const totalDeductions = useMemo(() => deductions.reduce((sum, item) => sum + toNumber(item.value), 0), [deductions])
  const netAmount = Math.max(0, Number((gross - totalDeductions).toFixed(2)))
  const sumInstallments = installments.reduce((sum, item) => sum + item.value, 0)

  useEffect(() => {
    if (!editable || !canOperate) return
    const quantity = paymentType === 'avista' ? 1 : Math.max(2, count)
    setInstallments(makeInstallments(netAmount, quantity, firstDueDate))
  }, [netAmount, paymentType, count, firstDueDate, editable, canOperate])

  function patchDeduction(index: number, patch: Partial<Deduction>) { setDeductions((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item)) }
  function addDeduction() { setDeductions((current) => [...current, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, date: today(), description: '', value: 0 }]) }
  function removeDeduction(index: number) { setDeductions((current) => current.filter((_, i) => i !== index)) }
  function patchInstallment(index: number, patch: Partial<Installment>) { setInstallments((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item)) }

  async function saveSchedule() {
    if (!profile || !canOperate || !editable) return
    if (totalDeductions >= gross) { window.alert('O total das deduções deve ser menor que a comissão bruta para existir valor líquido a pagar.'); return }
    if (deductions.some((item) => item.value > 0 && (!item.description.trim() || !item.date))) { window.alert('Informe data e descrição para todas as deduções com valor.'); return }
    if (Math.abs(sumInstallments - netAmount) > 0.02) { window.alert(`A soma das parcelas deve ser igual ao valor líquido após deduções (${money.format(netAmount)}).`); return }
    if (installments.some((item) => !item.dueDate || item.value <= 0)) { window.alert('Informe valor e data de todas as parcelas.'); return }
    setBusy(true)
    try {
      const cleanDeductions = deductions.filter((item) => item.value > 0).map((item) => ({ ...item, description: item.description.trim() }))
      const scheduled = installments.map((item, index) => ({ ...item, number: index + 1, status: 'aguardando_aprovacao' as InstallmentStatus, paid: false, paidDate: '' }))
      await setDoc(doc(db, 'agentCommissions', source.id), {
        sourceReceivableId: source.id, sourceType: 'comissao_agente', processo: source.processo || '', reclamante: source.reclamante || '', reclamada: source.reclamada || '', beneficiary: beneficiary(source),
        amountReceived: toNumber(source.valorAlvara), grossAmount: gross, deductions: cleanDeductions, deductionTotal: cleanDeductions.reduce((sum, item) => sum + item.value, 0), netAmountDue: netAmount, amountDue: netAmount,
        accountingAccount: accountingAccount.trim(), paymentType, installmentCount: scheduled.length, firstDueDate: scheduled[0]?.dueDate || firstDueDate, installments: scheduled,
        status: 'aguardando_aprovacao', notes: notes.trim(), approvalNote: '', approvedBy: null, approvedByName: null, approvedAt: null,
        sourceSnapshot: { unidade: source.unidade || '', data: source.data || '', natureza: source.natureza || '', processo: source.processo || '', reclamante: source.reclamante || '', reclamada: source.reclamada || '', origem: source.origem || '', agentName: source.agentName || '', valorAlvara: toNumber(source.valorAlvara), agentCommissionValue: gross },
        createdBy: plan?.createdBy || profile.uid, createdByName: plan?.createdByName || profile.displayName, createdAt: plan?.createdAt || serverTimestamp(), updatedBy: profile.uid, updatedByName: profile.displayName, updatedAt: serverTimestamp(),
      }, { merge: false })
      await audit(profile, 'Programação de comissão enviada para aprovação', `Processo ${source.processo || '—'} · ${beneficiary(source)} · Bruto ${money.format(gross)} · Deduções ${money.format(totalDeductions)} · Líquido ${money.format(netAmount)}`, source.id)
      onClose()
    } catch (error) { console.error(error); window.alert('Não foi possível salvar a programação da comissão.') } finally { setBusy(false) }
  }

  async function decide(status: 'aprovado' | 'rejeitado') {
    if (!profile || !canApprove || !plan) return
    setBusy(true)
    try {
      const decidedAt = nowIso()
      const decidedInstallments = installments.map((item) => ({ ...item, status: status === 'aprovado' ? 'aprovada' as InstallmentStatus : 'pendente' as InstallmentStatus, approvedAt: status === 'aprovado' ? decidedAt : undefined, approvedBy: status === 'aprovado' ? profile.uid : undefined, approvedByName: status === 'aprovado' ? profile.displayName : undefined }))
      await setDoc(doc(db, 'agentCommissions', source.id), { status, installments: decidedInstallments, approvalNote: approvalNote.trim(), approvedBy: profile.uid, approvedByName: profile.displayName, approvedByEmail: profile.email, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })
      await audit(profile, status === 'aprovado' ? 'Comissão líquida e parcelas aprovadas' : 'Comissão rejeitada', `Processo ${source.processo || '—'} · Líquido ${money.format(netDue(source, plan))}${approvalNote.trim() ? ` · ${approvalNote.trim()}` : ''}`, source.id)
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
      await setDoc(doc(db, 'agentCommissions', source.id), { installments: finalized, status: nextStatus, paidValue: finalized.reduce((sum, item) => sum + (item.paid ? item.value : 0), 0), updatedBy: profile.uid, updatedByName: profile.displayName, updatedAt: serverTimestamp() }, { merge: true })
      for (let index = 0; index < finalized.length; index += 1) if (finalized[index].paid && !previous[index]?.paid) await audit(profile, `Parcela ${finalized[index].number} da comissão paga`, `Processo ${source.processo || '—'} · ${beneficiary(source)} · ${money.format(finalized[index].value)} em ${dateBr(finalized[index].paidDate)}`, source.id)
      await audit(profile, 'Execução da comissão atualizada', `Processo ${source.processo || '—'} · ${paidCount}/${finalized.length} parcela(s) paga(s)`, source.id)
      onClose()
    } catch (error) { console.error(error); window.alert('Não foi possível atualizar o pagamento da comissão.') } finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><section className="decision-modal obligation-modal commission-v4-modal" role="dialog" aria-modal="true">
    <div className="modal-toolbar"><div><span className="eyebrow">Comissões de Agentes</span><h2>{plan ? 'Controle da comissão' : 'Nova programação da comissão'}</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={20} /></button></div>

    <div className="commission-v4-source"><div><span>Processo</span><strong>{source.processo || '—'}</strong></div><div><span>Agente</span><strong>{beneficiary(source)}</strong></div><div><span>Reclamante</span><strong>{source.reclamante || '—'}</strong></div><div><span>Reclamada</span><strong>{source.reclamada || '—'}</strong></div><div><span>Comissão original</span><strong>{sourceCommissionPercent(source) ? `${sourceCommissionPercent(source).toLocaleString('pt-BR')}%` : '—'}</strong></div><div className="gross"><span>Comissão bruta</span><strong>{money.format(gross)}</strong></div></div>

    <section className="commission-deductions-box">
      <div className="commission-section-title"><div><strong>Deduções da comissão</strong><span>Inclua dedução compensatória ou qualquer outro desconto. O valor líquido é recalculado automaticamente.</span></div>{canOperate && editable && <button className="secondary-button" type="button" onClick={addDeduction}><Plus size={15} /> Adicionar dedução</button>}</div>
      <label className="commission-account-field"><span>Conta contábil / referência da comissão (opcional)</span><input value={accountingAccount} disabled={!canOperate || !editable} onChange={(event) => setAccountingAccount(event.target.value)} placeholder="Ex.: 4.02.03.14 - Agente (Participação no Processo - Alvará/Acordo)" /></label>
      <div className="commission-deduction-table"><div className="commission-deduction-row head"><span>Data</span><span>Histórico / Motivo</span><span>Valor da dedução</span><span></span></div>{deductions.length === 0 ? <div className="commission-no-deduction">Nenhuma dedução lançada.</div> : deductions.map((item, index) => <div className="commission-deduction-row" key={item.id}><input type="date" value={item.date} disabled={!canOperate || !editable} onChange={(event) => patchDeduction(index, { date: event.target.value })} /><input value={item.description} disabled={!canOperate || !editable} onChange={(event) => patchDeduction(index, { description: event.target.value })} placeholder="Ex.: Dedução compensatória" /><MoneyInputBR value={item.value} disabled={!canOperate || !editable} ariaLabel={`Valor da dedução ${index + 1}`} onChange={(value) => patchDeduction(index, { value })} />{canOperate && editable ? <button type="button" className="icon-button deduction-remove" title="Excluir dedução" onClick={() => removeDeduction(index)}><Trash2 size={15} /></button> : <span />}</div>)}</div>
      <div className="commission-calculation"><div><span>Comissão bruta</span><strong>{money.format(gross)}</strong></div><div><span>(-) Total de deduções</span><strong>{money.format(totalDeductions)}</strong></div><div className="net"><span>VALOR LÍQUIDO A PAGAR AO AGENTE</span><strong>{money.format(netAmount)}</strong></div></div>
    </section>

    {!execution && <div className="obligation-form-grid"><label><span>Forma de pagamento</span><select value={paymentType} disabled={!canOperate || !editable} onChange={(event) => { const value = event.target.value as 'avista' | 'parcelado'; setPaymentType(value); if (value === 'avista') setCount(1) }}><option value="avista">À vista</option><option value="parcelado">Parcelado</option></select></label><label><span>Número de parcelas</span><input type="number" min="1" max="60" value={paymentType === 'avista' ? 1 : count} disabled={!canOperate || !editable || paymentType === 'avista'} onChange={(event) => setCount(Math.max(1, Number(event.target.value)))} /></label><label><span>Primeira data prevista</span><input type="date" value={firstDueDate} disabled={!canOperate || !editable} onChange={(event) => setFirstDueDate(event.target.value)} /></label></div>}

    <div className="obligation-installments"><div className="obligation-installment-head enhanced"><span>Parcela</span><span>Valor líquido</span><span>Data prevista</span><span>Status</span><span>Pago</span><span>Data do pagamento</span></div>{installments.map((item, index) => <div className="obligation-installment-row enhanced" key={item.number}><strong>{index + 1}/{installments.length}</strong><MoneyInputBR value={item.value} disabled={execution || !canOperate || !editable} onChange={(value) => patchInstallment(index, { value })} /><input type="date" value={item.dueDate} disabled={execution || !canOperate || !editable} onChange={(event) => patchInstallment(index, { dueDate: event.target.value })} /><b className={`workflow-status-badge ${installmentClass(item.status)}`}>{installmentLabel(item.status)}</b><label className="obligation-paid-check"><input type="checkbox" checked={Boolean(item.paid)} disabled={!execution || !canOperate || plan?.status === 'pago'} onChange={(event) => patchInstallment(index, { paid: event.target.checked, status: event.target.checked ? 'paga' : 'aprovada', paidDate: event.target.checked ? (item.paidDate || today()) : '' })} /><span>{item.paid ? 'Sim' : 'Não'}</span></label><input type="date" value={item.paidDate || ''} disabled={!execution || !canOperate || !item.paid || plan?.status === 'pago'} onChange={(event) => patchInstallment(index, { paidDate: event.target.value })} /></div>)}<div className="obligation-installment-total enhanced"><span>Total programado</span><strong className={Math.abs(sumInstallments - netAmount) > .02 ? 'expense-text' : ''}>{money.format(sumInstallments)}</strong></div></div>

    <label className="obligation-notes"><span>Observações</span><textarea rows={3} value={notes} disabled={execution || !canOperate || !editable} onChange={(event) => setNotes(event.target.value)} /></label>

    <div className="modal-actions">
      <button className="secondary-button" type="button" onClick={onClose}>Fechar</button>
      {canOperate && editable && <button className="primary-button" type="button" disabled={busy} onClick={saveSchedule}><Send size={16} /> Enviar para aprovação</button>}
      {canApprove && plan?.status === 'aguardando_aprovacao' && <><button className="small-expense-button" type="button" disabled={busy} onClick={() => decide('rejeitado')}>Rejeitar</button><button className="small-success-button" type="button" disabled={busy} onClick={() => decide('aprovado')}><CheckCircle2 size={16} /> Aprovar líquido e parcelas</button></>}
      {canOperate && execution && plan?.status !== 'pago' && <button className="primary-button" type="button" disabled={busy} onClick={saveExecution}><CheckCircle2 size={16} /> Salvar pagamentos</button>}
    </div>
  </section></div>
}

export function AgentCommissionsPageV4() {
  const { records: receivables, loading: loadingReceivables } = useCollectionRecords('receivables')
  const { records: plans, loading: loadingPlans } = useCollectionRecords('agentCommissions')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<AnyRecord | null>(null)
  const planMap = useMemo(() => new Map(plans.map((item) => [String(item.sourceReceivableId || item.id), item])), [plans])
  const sources = useMemo(() => receivables.filter(eligible).filter((item) => `${item.processo ?? ''} ${item.agentName ?? ''} ${item.reclamante ?? ''} ${item.reclamada ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? ''))), [receivables, search])
  const totals = useMemo(() => sources.reduce((acc, source) => {
    const plan = planMap.get(source.id)
    const gross = sourceGrossCommission(source)
    const deductions = deductionTotal(plan)
    const net = netDue(source, plan)
    const paid = paidValue(plan)
    acc.gross += gross; acc.deductions += deductions; acc.net += net; acc.paid += paid; acc.pending += Math.max(0, net - paid); if (plan?.status === 'aguardando_aprovacao') acc.approvals += 1
    return acc
  }, { gross: 0, deductions: 0, net: 0, paid: 0, pending: 0, approvals: 0 }), [planMap, sources])
  const loading = loadingReceivables || loadingPlans

  return <>
    <div className="page-heading"><div><span className="eyebrow">Controle financeiro separado</span><h1>Comissões de Agentes</h1><p>Controle da comissão bruta, deduções, valor líquido, aprovação e pagamento à vista ou parcelado.</p></div><div className="quick-actions commission-report-actions"><button className="secondary-button commission-report-button" type="button" onClick={() => generatePdf(sources, planMap)}><FileText size={17} /> Gerar PDF do relatório</button></div></div>
    <div className="commission-v4-metrics"><article><span>Comissões brutas</span><strong>{money.format(totals.gross)}</strong></article><article><span>Deduções</span><strong>{money.format(totals.deductions)}</strong></article><article><span>Líquido a pagar</span><strong>{money.format(totals.net)}</strong></article><article><span>Já pago</span><strong>{money.format(totals.paid)}</strong></article><article><span>Saldo</span><strong>{money.format(totals.pending)}</strong></article><article><span>Aguardando aprovação</span><strong>{totals.approvals}</strong></article></div>
    <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por processo, agente, reclamante ou reclamada" /></div></div>{loading ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando comissões</strong></div> : sources.length === 0 ? <div className="module-empty"><Users size={34} /><strong>Nenhuma comissão disponível</strong><span>As comissões aparecem depois que a Tesouraria confirma o recebimento do Alvará.</span></div> : <div className="commission-v4-list"><div className="commission-v4-row head"><span>Processo / Agente</span><span>Bruto</span><span>Deduções</span><span>Líquido</span><span>Já pago</span><span>Saldo</span><span>Próxima parcela</span><span>Status</span><span>Ação</span></div>{sources.map((source) => { const plan = planMap.get(source.id); const gross = sourceGrossCommission(source); const deductions = deductionTotal(plan); const net = netDue(source, plan); const paid = paidValue(plan); const next = nextInstallment(plan); return <div className="commission-v4-row" key={source.id}><span><strong>{source.processo || '—'}</strong><small>{beneficiary(source)}</small></span><span><strong>{money.format(gross)}</strong></span><span><strong>{money.format(deductions)}</strong></span><span><strong>{money.format(net)}</strong></span><span><strong>{money.format(paid)}</strong></span><span><strong>{money.format(Math.max(0, net - paid))}</strong></span><span>{next ? <><strong>{money.format(next.value)}</strong><small>{dateBr(next.dueDate)}</small></> : <strong>—</strong>}</span><span><b className={`workflow-status-badge ${statusClass(plan)}`}>{statusLabel(plan)}</b></span><span><button className="small-neutral-button" type="button" onClick={() => setTarget(source)}>{plan ? 'Abrir controle' : 'Programar'}</button></span></div>})}</div>}</section>
    {target && <CommissionModal source={target} plan={planMap.get(target.id)} onClose={() => setTarget(null)} />}
  </>
}