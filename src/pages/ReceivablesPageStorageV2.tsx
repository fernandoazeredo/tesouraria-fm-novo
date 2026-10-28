import { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, arrayUnion, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, type DocumentData } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTask } from 'firebase/storage'
import { BadgeDollarSign, CheckCircle2, ExternalLink, FileText, Paperclip, PencilLine, Plus, RefreshCw, Search, Send, Trash2, Upload, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { FinancialMovementCard } from '../components/FinancialMovementCard'
import { WorkflowStatusBadge } from '../components/WorkflowStatusBadge'
import { DEFAULT_BANK_ACCOUNT_ID, getBankAccount, type BankAccount } from '../data/bankAccounts'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'
import { isEffectiveAlvaraReceivable } from '../lib/receivableClassification'
import { canEditReceivable, isAllowedReceivableTransition, receivableAuditAction, receivableEditMode, restoreComponents, stripImmutableFields, type ReceivableSaveStatus } from '../lib/receivableEditing'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const decimalBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type AnyRecord = { id: string } & DocumentData
type RevenueComponent = { nome: string; percentual: number; valor: number; detalhe?: string }
type AttachmentMeta = { name: string; url: string; path: string; size: number; type: string; uploadedAt: string; uploadedBy: string }
type UploadItem = { id: string; name: string; size: number; progress: number; status: 'uploading' | 'success' | 'error'; meta?: AttachmentMeta; error?: string; existing?: boolean }

const statusLabels: Record<string, string> = {
  rascunho: 'Rascunho', enviado_tesouraria: 'Enviado à Tesouraria', recebido_tesouraria: 'Recebido pela Tesouraria', devolvido: 'Devolvido para Correção', encerrado: 'Encerrado / Arquivado',
}

function safeFileName(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo' }
function toNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` }
function attachmentsOf(item: AnyRecord): AttachmentMeta[] { return Array.isArray(item.attachments) ? item.attachments as AttachmentMeta[] : [] }
function componentLabel(name: string) { return name.startsWith('Outras Deduções / Participações') ? 'Outras Deduções / Participações' : name }
function isDynamicComponent(name: string) { return name.startsWith('Outras Deduções / Participações - Adicional ') }

function normalizeBrazilianDecimal(value: string) {
  const cleaned = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '')
  if (!cleaned) return ''
  if (cleaned.includes(',')) return cleaned.replace(/\./g, '').replace(',', '.')
  const dots = cleaned.match(/\./g)?.length ?? 0
  if (dots > 1 || (dots === 1 && /^-?\d{1,3}\.\d{3}$/.test(cleaned))) return cleaned.replace(/\./g, '')
  return cleaned
}

function parseBrazilianNumber(value: string) {
  const normalized = normalizeBrazilianDecimal(value)
  if (!normalized) return 0
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function roundPercentTextCustom(value: string) {
  const normalized = normalizeBrazilianDecimal(value)
  if (!normalized || normalized.startsWith('-')) return 0
  const match = normalized.match(/^(\d+)(?:\.(\d*))?$/)
  if (!match) return 0
  const integerPart = BigInt(match[1] || '0')
  const decimals = `${match[2] || ''}000`
  const hundredths = BigInt(decimals.slice(0, 2) || '0')
  const thirdDecimalDigit = Number(decimals[2] || '0')
  const basisPoints = integerPart * 100n + hundredths + (thirdDecimalDigit >= 6 ? 1n : 0n)
  return Number(basisPoints) / 100
}

function percentFromMoneyCustom(value: number, total: number) {
  const valueCents = BigInt(Math.max(0, Math.round(value * 100)))
  const totalCents = BigInt(Math.max(0, Math.round(total * 100)))
  if (totalCents === 0n) return 0
  const thousandthsOfPercent = (valueCents * 100000n) / totalCents
  const hundredthsOfPercent = thousandthsOfPercent / 10n
  const thirdDecimalDigit = Number(thousandthsOfPercent % 10n)
  const basisPoints = hundredthsOfPercent + (thirdDecimalDigit >= 6 ? 1n : 0n)
  return Number(basisPoints) / 100
}

function normalizePercentStored(value: number) {
  return Math.max(0, Math.round(value * 100)) / 100
}

function BrazilianMoneyInput({ value, onChange, ariaLabel, validationKey }: { value: number; onChange: (value: number) => void; ariaLabel?: string; validationKey?: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value > 0 ? decimalBR.format(value) : '')

  useEffect(() => {
    if (!focused) setText(value > 0 ? decimalBR.format(value) : '')
  }, [focused, value])

  return <span className="money-input-with-preview">
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      data-required-key={validationKey}
      placeholder="0,00"
      value={text}
      onFocus={(event) => {
        setFocused(true)
        event.currentTarget.select()
      }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        onChange(Math.max(0, parseBrazilianNumber(next)))
      }}
      onBlur={() => {
        setFocused(false)
        setText(value > 0 ? decimalBR.format(value) : '')
      }}
    />
    <small>{money.format(value)}</small>
  </span>
}

function BrazilianPercentInput({ value, onChange, ariaLabel }: { value: number; onChange: (value: number) => void; ariaLabel?: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value > 0 ? decimalBR.format(value) : '')

  useEffect(() => {
    if (!focused) setText(value > 0 ? decimalBR.format(normalizePercentStored(value)) : '')
  }, [focused, value])

  return <input
    type="text"
    inputMode="decimal"
    aria-label={ariaLabel}
    placeholder="0,00"
    value={text}
    onFocus={(event) => {
      setFocused(true)
      event.currentTarget.select()
    }}
    onChange={(event) => {
      const next = event.target.value
      setText(next)
      onChange(roundPercentTextCustom(next))
    }}
    onBlur={() => {
      setFocused(false)
      const rounded = normalizePercentStored(value)
      setText(value > 0 ? decimalBR.format(rounded) : '')
    }}
  />
}

function useReceivables() {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, 'receivables'), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [])
  return { records, loading }
}

async function audit(profile: ReturnType<typeof useAuth>['profile'], action: string, detail: string, entityId: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), { action, module: 'Recebimento de Alvarás', detail, entityId, userId: profile.uid, userName: profile.displayName, userEmail: profile.email, createdAt: serverTimestamp() })
}

const DEFAULT_REVENUE_COMPONENTS: RevenueComponent[] = [
  { nome: 'Imposto de Renda', percentual: 0, valor: 0 },
  { nome: 'INSS', percentual: 0, valor: 0 },
  { nome: 'INSS Empregador', percentual: 0, valor: 0 },
  { nome: 'Honorários do Escritório', percentual: 0, valor: 0 },
  { nome: 'Honorários Perito', percentual: 0, valor: 0 },
  { nome: 'Ressarcimento de Custas', percentual: 0, valor: 0 },
  { nome: 'Despesas Bancárias / Tarifas', percentual: 0, valor: 0 },
  { nome: 'Outras Deduções / Participações - Geral 1', percentual: 0, valor: 0, detalhe: '' },
  { nome: 'Outras Deduções / Participações - Geral 2', percentual: 0, valor: 0, detalhe: '' },
  { nome: 'Outras Deduções / Participações', percentual: 0, valor: 0, detalhe: '' },
]

function existingUploads(record?: AnyRecord | null): UploadItem[] {
  return attachmentsOf(record ?? { id: '' }).map((meta, index) => ({ id: `existing-${index}-${meta.path}`, name: meta.name, size: toNumber(meta.size), progress: 100, status: 'success', meta, existing: true }))
}

function ReceivableModal({ onClose, existing }: { onClose: () => void; existing?: AnyRecord | null }) {
  const { profile } = useAuth()
  const editMode = existing ? receivableEditMode(existing.status) : null
  const [recordRef] = useState(() => existing ? doc(db, 'receivables', existing.id) : doc(collection(db, 'receivables')))
  const tasks = useRef<Record<string, UploadTask>>({})
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>(existing?.unidade === 'SP' ? 'SP' : 'RJ')
  const [data, setData] = useState(String(existing?.data || new Date().toISOString().slice(0, 10)))
  const [natureza, setNatureza] = useState(String(existing?.natureza || 'Trabalhista'))
  const [processo, setProcesso] = useState(String(existing?.processo ?? ''))
  const [reclamada, setReclamada] = useState(String(existing?.reclamada ?? ''))
  const [reclamante, setReclamante] = useState(String(existing?.reclamante ?? ''))
  const [origem, setOrigem] = useState(String(existing?.origem || 'Alvará'))
  const [formaRecebimento, setFormaRecebimento] = useState(String(existing?.formaRecebimento ?? ''))
  const [dataPrevista, setDataPrevista] = useState(String(existing?.dataPrevista ?? ''))
  const [receivingBankAccountId, setReceivingBankAccountId] = useState<BankAccount['id']>((existing?.receivingBankAccountId as BankAccount['id']) || DEFAULT_BANK_ACCOUNT_ID)
  const [receiptDate, setReceiptDate] = useState(String(existing?.receiptDate || new Date().toISOString().slice(0, 10)))
  const [totalAlvara, setTotalAlvara] = useState(toNumber(existing?.valorAlvara))
  const [baseCalculo, setBaseCalculo] = useState(toNumber(existing?.baseCalculo))
  const [banco, setBanco] = useState(String(existing?.banco ?? ''))
  const [agencia, setAgencia] = useState(String(existing?.agencia ?? ''))
  const [conta, setConta] = useState(String(existing?.conta ?? ''))
  const [titular, setTitular] = useState(String(existing?.titular ?? ''))
  const [cpf, setCpf] = useState(String(existing?.cpf ?? ''))
  const [pix, setPix] = useState(String(existing?.pix ?? ''))
  const [emailNf, setEmailNf] = useState(String(existing?.emailNf ?? ''))
  const [enderecoNf, setEnderecoNf] = useState(String(existing?.enderecoNf ?? ''))
  const [agentName, setAgentName] = useState(String(existing?.agentName ?? ''))
  const [uploads, setUploads] = useState<UploadItem[]>(() => existingUploads(existing))
  const [components, setComponents] = useState<RevenueComponent[]>(() => existing ? restoreComponents(DEFAULT_REVENUE_COMPONENTS, existing.components) : DEFAULT_REVENUE_COMPONENTS.map((item) => ({ ...item })))
  const totalDeducoes = useMemo(() => components.reduce((sum, component) => sum + toNumber(component.valor), 0), [components])
  const liquidoCliente = useMemo(() => Math.max(0, Number((totalAlvara - totalDeducoes).toFixed(2))), [totalAlvara, totalDeducoes])
  const agentCommissionValue = useMemo(() => toNumber(components.find((item) => item.nome === 'Outras Deduções / Participações')?.valor), [components])
  const invoiceValue = useMemo(() => toNumber(components.find((item) => item.nome === 'Honorários do Escritório')?.valor), [components])
  const uploading = uploads.some((item) => item.status === 'uploading')
  const uploaded = uploads.flatMap((item) => item.meta ? [item.meta] : [])
  const clientBankingIncomplete = !banco.trim() || !agencia.trim() || !conta.trim() || !titular.trim() || !cpf.trim()
  const processDataIncomplete = !processo.trim() || !reclamante.trim()

  function updatePercent(index: number, percentual: number) {
    const roundedPercent = normalizePercentStored(percentual)
    setComponents((current) => current.map((item, i) => i === index ? { ...item, percentual: roundedPercent, valor: totalAlvara > 0 ? Number(((totalAlvara * roundedPercent) / 100).toFixed(2)) : 0 } : item))
  }
  function updateValue(index: number, valor: number) {
    const roundedValue = Number(Math.max(0, valor).toFixed(2))
    const calculatedPercent = totalAlvara > 0 ? percentFromMoneyCustom(roundedValue, totalAlvara) : 0
    setComponents((current) => current.map((item, i) => i === index ? { ...item, valor: roundedValue, percentual: calculatedPercent } : item))
  }
  function updateDetail(index: number, detalhe: string) {
    setComponents((current) => current.map((item, i) => i === index ? { ...item, detalhe } : item))
  }
  function addDynamicComponent() {
    setComponents((current) => [...current, {
      nome: `Outras Deduções / Participações - Adicional ${crypto.randomUUID()}`,
      percentual: 0,
      valor: 0,
      detalhe: '',
    }])
  }
  function removeDynamicComponent(index: number) {
    setComponents((current) => {
      const item = current[index]
      if (!item || !isDynamicComponent(item.nome)) return current
      const hasContent = Boolean(item.detalhe?.trim()) || toNumber(item.percentual) > 0 || toNumber(item.valor) > 0
      if (hasContent && !window.confirm('Descartar este campo adicional e todas as informações preenchidas nele?')) return current
      return current.filter((_, i) => i !== index)
    })
  }
  function changeTotal(value: number) {
    const previous = totalAlvara
    setTotalAlvara(value)
    setBaseCalculo((current) => current === 0 || current === previous ? value : current)
    setComponents((current) => current.map((item) => {
      const roundedPercent = normalizePercentStored(item.percentual)
      return { ...item, percentual: roundedPercent, valor: value > 0 ? Number(((value * roundedPercent) / 100).toFixed(2)) : 0 }
    }))
  }

  function selectFiles(files: FileList | null) {
    if (!profile?.uid || !files?.length) return
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { window.alert(`${file.name} ultrapassa 20 MB.`); continue }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const path = `recebimentos/${profile.uid}/${recordRef.id}/${Date.now()}-${safeFileName(file.name)}`
      const target = storageRef(storage, path)
      const task = uploadBytesResumable(target, file, { contentType: file.type || 'application/octet-stream' })
      tasks.current[id] = task
      setUploads((current) => [...current, { id, name: file.name, size: file.size, progress: 0, status: 'uploading' }])
      task.on('state_changed', (snapshot) => {
        const progress = snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0
        setUploads((current) => current.map((item) => item.id === id ? { ...item, progress } : item))
      }, (error) => {
        setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'error', error: error.message } : item))
      }, async () => {
        const url = await getDownloadURL(target)
        const meta: AttachmentMeta = { name: file.name, url, path, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy: profile.uid }
        setUploads((current) => current.map((item) => item.id === id ? { ...item, status: 'success', progress: 100, meta } : item))
        delete tasks.current[id]
      })
    }
  }

  async function removeUpload(item: UploadItem) {
    if (item.existing) {
      // Anexo já gravado no documento: remove apenas da lista desta edição.
      // O arquivo permanece no Storage para preservar a rastreabilidade.
      if (!window.confirm(`Retirar "${item.name}" dos anexos desta receita? O arquivo original permanecerá arquivado.`)) return
      setUploads((current) => current.filter((row) => row.id !== item.id))
      return
    }
    tasks.current[item.id]?.cancel()
    delete tasks.current[item.id]
    if (item.meta?.path) { try { await deleteObject(storageRef(storage, item.meta.path)) } catch {} }
    setUploads((current) => current.filter((row) => row.id !== item.id))
  }

  async function closeAndClean() {
    for (const task of Object.values(tasks.current)) task.cancel()
    for (const item of uploads) if (!item.existing && item.meta?.path) { try { await deleteObject(storageRef(storage, item.meta.path)) } catch {} }
    onClose()
  }

  async function save(status: ReceivableSaveStatus) {
    if (uploading) { window.alert('Aguarde o término do envio dos documentos.'); return }
    const missingKeys: string[] = []
    if (!processo.trim()) missingKeys.push('alvara-processo')
    if (!reclamante.trim()) missingKeys.push('alvara-reclamante')
    if (totalAlvara <= 0) missingKeys.push('alvara-total')
    if (status === 'enviado_tesouraria' && liquidoCliente > 0) {
      if (!banco.trim()) missingKeys.push('alvara-banco')
      if (!agencia.trim()) missingKeys.push('alvara-agencia')
      if (!conta.trim()) missingKeys.push('alvara-conta')
      if (!titular.trim()) missingKeys.push('alvara-titular')
      if (!cpf.trim()) missingKeys.push('alvara-cpf')
    }
    components.forEach((item, index) => {
      const requiresDetail = (item.nome.includes('Geral') || isDynamicComponent(item.nome)) && toNumber(item.valor) > 0 && !item.detalhe?.trim()
      if (requiresDetail) missingKeys.push(`alvara-detail-${index}`)
    })
    if (agentCommissionValue > 0 && !agentName.trim()) missingKeys.push('alvara-agent')
    if (missingKeys.length) { showRequiredFieldErrors('.revenue-sheet', missingKeys); return }
    clearRequiredFieldErrors('.revenue-sheet')
    const componentsToSave = components.map((item) => item.nome === 'Outras Deduções / Participações'
      ? { ...item, detalhe: agentName.trim() }
      : item.nome.startsWith('Outras Deduções / Participações') ? { ...item, detalhe: item.detalhe?.trim() ?? '' } : item)
    const receivingBankAccount = getBankAccount(receivingBankAccountId)
    setBusy(true)
    try {
      const payload = {
        unidade, data, natureza, processo: processo.trim(), reclamada: reclamada.trim(), reclamante: reclamante.trim(), origem,
        formaRecebimento: formaRecebimento.trim(), dataPrevista,
        receivingBankAccountId, receivingBankAccount, receiptDate,
        valorAlvara: totalAlvara, baseCalculo, valorLiquidoCliente: liquidoCliente, totalDeducoes, components: componentsToSave,
        agentName: agentName.trim(), agentCommissionValue, invoiceValue,
        banco, agencia, conta, titular, cpf, pix, emailNf, enderecoNf, status,
        attachments: uploaded, attachmentCount: uploaded.length, storageStatus: 'active',
      }
      const auditAction = receivableAuditAction(editMode, status)
      if (existing) {
        if (!editMode || !isAllowedReceivableTransition(existing.status, status)) { window.alert('Esta receita não pode mais ser alterada pela área de origem.'); return }
        const current = await getDoc(recordRef)
        if (!current.exists() || current.data().status !== existing.status) {
          window.alert('A situação desta receita foi alterada por outro usuário. Feche e abra novamente antes de salvar.')
          return
        }
        await updateDoc(recordRef, {
          ...stripImmutableFields(payload),
          updatedAt: serverTimestamp(), updatedBy: profile?.uid, updatedByName: profile?.displayName,
          editHistory: arrayUnion({ action: auditAction, fromStatus: existing.status, toStatus: status, at: new Date().toISOString(), by: profile?.uid ?? '', byName: profile?.displayName ?? '' }),
        })
        await audit(profile, auditAction, `Documento ${recordRef.id} · Processo ${processo} — ${money.format(totalAlvara)} · ${receivingBankAccount.bank} · ${uploaded.length} anexo(s) · ${statusLabels[String(existing.status)] ?? existing.status} → ${statusLabels[status] ?? status} · criado por ${existing.createdByName || existing.createdBy || '—'}`, recordRef.id)
      } else {
        await setDoc(recordRef, {
          ...payload,
          createdBy: profile?.uid, createdByName: profile?.displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        await audit(profile, auditAction, `Processo ${processo} — ${money.format(totalAlvara)} · ${receivingBankAccount.bank} · ${uploaded.length} anexo(s)`, recordRef.id)
      }
      onClose()
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível salvar a receita.')
    } finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><section className="modal-sheet legacy-sheet revenue-sheet">
    <div className="modal-toolbar"><div><span className="eyebrow revenue-text">Recebimento de Alvarás</span><h2>{editMode === 'draft' ? 'Editar rascunho — Demonstrativo de Recebimento de Honorários' : editMode === 'returned' ? 'Corrigir e reenviar — Demonstrativo de Recebimento de Honorários' : 'Demonstrativo de Recebimento de Honorários'}</h2></div><button className="icon-button" onClick={() => void closeAndClean()}><X size={20} /></button></div>
    <div className="legacy-title-block revenue-title"><strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong><span>DEMONSTRATIVO DE RECEBIMENTO DE HONORÁRIOS</span></div>
    <h3 className="form-section-title">Dados do Processo</h3>
    <div className="form-grid compact-grid"><label><span>Unidade</span><select value={unidade} onChange={(e) => setUnidade(e.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label><label><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label><label><span>Natureza</span><select value={natureza} onChange={(e) => setNatureza(e.target.value)}><option>Trabalhista</option><option>Cível</option></select></label><label className="span-2"><span>Número do processo</span><input data-required-key="alvara-processo" value={processo} onChange={(e) => setProcesso(e.target.value)} /></label><label className="span-2"><span>Reclamada</span><input value={reclamada} onChange={(e) => setReclamada(e.target.value)} /></label><label className="span-2"><span>Reclamante</span><input data-required-key="alvara-reclamante" value={reclamante} onChange={(e) => setReclamante(e.target.value)} /></label><label><span>Origem</span><select value={origem} onChange={(e) => setOrigem(e.target.value)}><option>Alvará</option><option>Acordo</option></select></label><label><span>Forma de recebimento</span><input value={formaRecebimento} onChange={(e) => setFormaRecebimento(e.target.value)} /></label><label><span>Data prevista</span><input type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} /></label></div>
    <h3 className="form-section-title">Composição do Valor</h3>
    <div className="composition-table">
      <div className="composition-row composition-head"><span>Componente</span><span>Percentual (%)</span><span>Valor (R$)</span></div>
      <div className="composition-row total-row"><strong>Valor Líquido do Alvará</strong><span>100%</span><BrazilianMoneyInput value={totalAlvara} onChange={changeTotal} ariaLabel="Valor Líquido do Alvará" validationKey="alvara-total" /></div>
      <div className="composition-row"><strong>Base Cálculo Honorários (Valor Bruto)</strong><span>editável</span><BrazilianMoneyInput value={baseCalculo} onChange={setBaseCalculo} ariaLabel="Base Cálculo Honorários" /></div>
      {components.map((component, index) => {
        const isAgentCommission = component.nome === 'Outras Deduções / Participações'
        const isOtherDeduction = component.nome.startsWith('Outras Deduções / Participações')
        const isDynamic = isDynamicComponent(component.nome)
        return <div className={`composition-row${isDynamic ? ' dynamic-composition-row' : ''}`} key={component.nome}>
          <span className={isOtherDeduction ? 'commission-component-label' : ''}>
            <span className="component-label-text">{componentLabel(component.nome)}</span>
            {isOtherDeduction && <input data-required-key={isAgentCommission ? 'alvara-agent' : `alvara-detail-${index}`} aria-label={isAgentCommission ? 'Nome do agente ou beneficiário da comissão' : `Descrição ou beneficiário de ${componentLabel(component.nome)}`} placeholder={isAgentCommission ? 'Nome do agente / beneficiário da comissão' : 'Do que se trata / nome do beneficiário'} value={isAgentCommission ? agentName : component.detalhe ?? ''} onChange={(e) => isAgentCommission ? setAgentName(e.target.value) : updateDetail(index, e.target.value)} />}
            {isDynamic && <button type="button" className="dynamic-component-trash" title="Excluir campo adicional" aria-label="Excluir campo adicional" onClick={() => removeDynamicComponent(index)}><Trash2 size={16} /></button>}
          </span>
          <BrazilianPercentInput value={component.percentual} onChange={(value) => updatePercent(index, value)} ariaLabel={`Percentual de ${componentLabel(component.nome)}`} />
          <BrazilianMoneyInput value={component.valor} onChange={(value) => updateValue(index, value)} ariaLabel={`Valor de ${componentLabel(component.nome)}`} />
        </div>
      })}
      <div className="composition-add-row"><button type="button" className="add-dynamic-component-button" onClick={addDynamicComponent}><Plus size={16} /> Adicionar outro campo</button></div>
      <div className="composition-row deductions-row"><strong>Total de descontos / repasses</strong><span>—</span><strong>{money.format(totalDeducoes)}</strong></div>
      <div className="composition-row client-row"><strong>VALOR LÍQUIDO DEVIDO AO CLIENTE</strong><span>automático</span><strong>{money.format(liquidoCliente)}</strong></div>
    </div>

    <h3 className="form-section-title">Dados bancários para crédito do cliente</h3>
    <div className="form-grid compact-grid">
      <label><span>Banco *</span><input data-required-key="alvara-banco" value={banco} required={liquidoCliente > 0} onChange={(e) => setBanco(e.target.value)} /></label>
      <label><span>Agência *</span><input data-required-key="alvara-agencia" value={agencia} required={liquidoCliente > 0} onChange={(e) => setAgencia(e.target.value)} /></label>
      <label><span>Conta *</span><input data-required-key="alvara-conta" value={conta} required={liquidoCliente > 0} onChange={(e) => setConta(e.target.value)} /></label>
      <label className="span-2"><span>Nome / Titular *</span><input data-required-key="alvara-titular" value={titular} required={liquidoCliente > 0} onChange={(e) => setTitular(e.target.value)} /></label>
      <label><span>CPF *</span><input data-required-key="alvara-cpf" value={cpf} required={liquidoCliente > 0} onChange={(e) => setCpf(e.target.value)} /></label>
      <label className="span-2"><span>PIX (opcional)</span><input value={pix} onChange={(e) => setPix(e.target.value)} /></label>
    </div>
    <h3 className="form-section-title">Dados para emissão de Nota Fiscal</h3>
    <div className="form-grid compact-grid"><label className="span-2"><span>Endereço</span><input value={enderecoNf} onChange={(e) => setEnderecoNf(e.target.value)} /></label><label><span>E-mail</span><input type="email" value={emailNf} onChange={(e) => setEmailNf(e.target.value)} /></label></div>

    <FinancialMovementCard mode="receipt" bankAccountId={receivingBankAccountId} onBankAccountChange={setReceivingBankAccountId} movementDate={receiptDate} onMovementDateChange={setReceiptDate} amount={totalAlvara} />

    <div className="document-zone storage-document-zone revenue-zone"><CheckCircle2 size={20} /><div><strong>Documentos da receita · Storage ativo</strong><span>Anexe alvará, acordo, comprovantes e documentos do processo. O envio começa ao selecionar.</span></div><label className="storage-upload-button"><Upload size={16} /> Selecionar arquivos{uploads.length > 0 && <b className="upload-count-badge">{uploads.length}</b>}<input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => selectFiles(e.target.files)} /></label></div>
    {uploads.length > 0 && <div className="expense-attachment-list">{uploads.map((item) => <div key={item.id} className={`upload-item upload-${item.status}`}><Paperclip size={15} /><div className="upload-item-main"><strong>{item.name}</strong>{item.status === 'uploading' ? <><div className="upload-progress"><i style={{ width: `${item.progress}%` }} /></div><small>{item.progress}% enviado · {formatBytes(item.size)}</small></> : item.status === 'success' ? <small><CheckCircle2 size={13} /> Enviado — {formatBytes(item.size)}</small> : <small>{item.error || 'Falha no envio'}</small>}</div>{item.meta?.url && <a href={item.meta.url} target="_blank" rel="noreferrer" title="Abrir arquivo"><ExternalLink size={14} /></a>}<button type="button" className="icon-button" onClick={() => void removeUpload(item)}><X size={14} /></button></div>)}</div>}

    <div className="modal-actions"><button className="secondary-button" onClick={() => void closeAndClean()}>Cancelar</button>{editMode === 'returned' ? <button className="outline-revenue-button" disabled={busy || uploading} onClick={() => void save('devolvido')}>Salvar correção</button> : <button className="outline-revenue-button" disabled={busy || uploading} onClick={() => void save('rascunho')}>{editMode === 'draft' ? 'Salvar alterações' : 'Salvar rascunho'}</button>}<button className="revenue-button" disabled={busy || uploading} onClick={() => void save('enviado_tesouraria')}><Send size={17} /> {uploading ? 'Enviando documentos...' : editMode === 'returned' ? 'Reenviar à Tesouraria' : 'Enviar à Tesouraria'}</button></div>
  </section></div>
}


function printRevenueExtract(records: AnyRecord[]) {
  const effective = records.filter((item) => ['recebido_tesouraria', 'encerrado'].includes(String(item.status ?? '')))
  const alvaras = effective.filter(isEffectiveAlvaraReceivable)
  const otherRevenues = effective.filter((item) => !isEffectiveAlvaraReceivable(item))

  const renderRows = (items: AnyRecord[]) => items
    .map((item) => `<tr><td>${String(item.data || item.receiptDate || '—')}</td><td>${String(item.processo || '—')}</td><td>${String(item.reclamante || item.descricaoOrigem || item.descricao || item.origem || '—')}</td><td>${String(item.status || '—')}</td><td class="num">${money.format(toNumber(item.valorAlvara))}</td></tr>`)
    .join('')

  const alvaraTotal = alvaras.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const otherTotal = otherRevenues.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const w = window.open('', '_blank', 'width=1100,height=820')
  if (!w) { window.alert('O navegador bloqueou a janela do extrato. Libere pop-ups para este site e tente novamente.'); return }

  const table = (title: string, items: AnyRecord[], subtotal: number) => `<h2>${title}</h2><table><thead><tr><th>Data</th><th>Processo</th><th>Cliente / Origem</th><th>Status</th><th>Valor</th></tr></thead><tbody>${renderRows(items) || '<tr><td colspan="5">Nenhum lançamento.</td></tr>'}</tbody></table><div class="subtotal">Subtotal: ${money.format(subtotal)}</div>`

  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato de Receitas</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,Helvetica,sans-serif;color:#17202b;font-size:11px}h1{text-align:center}h2{margin-top:22px}table{width:100%;border-collapse:collapse}th{background:#1d4ed8;color:#fff;padding:8px;text-align:left}td{padding:7px;border-bottom:1px solid #ddd}.num{text-align:right}.subtotal{font-weight:700;font-size:13px;margin-top:10px;text-align:right}.note{margin:8px 0 18px;color:#5b6775}</style></head><body><h1>Extrato de Receitas</h1><div class="note">Alvarás e Outras Receitas são apresentados separadamente para manter o mesmo critério do Dashboard, Repasse de Alvarás e Calendário Financeiro.</div>${table('Alvarás', alvaras, alvaraTotal)}${table('Outras Receitas', otherRevenues, otherTotal)}</body></html>`)
  w.document.close()
}

export function ReceivablesPageStorageV2() {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('novo') === '1')
  const [search, setSearch] = useState('')
  const [attachmentsTarget, setAttachmentsTarget] = useState<AnyRecord | null>(null)
  const [editTarget, setEditTarget] = useState<AnyRecord | null>(null)
  const { profile } = useAuth()
  const { records, loading } = useReceivables()
  useEffect(() => { if (params.get('novo') === '1') setOpen(true) }, [params])
  const filtered = records.filter((item) => `${item.processo ?? ''} ${item.reclamante ?? ''} ${item.reclamada ?? ''} ${item.agentName ?? ''} ${item.receivingBankAccount?.bank ?? ''} ${item.receivingBankAccount?.account ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const close = () => { setOpen(false); setParams({}) }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Origem do recebimento</span><h1>Recebimento de Alvarás</h1><p>O departamento de origem preenche o demonstrativo, informa a conta em que o valor foi recebido e anexa os documentos que seguirão para a Tesouraria.</p></div><div className="quick-actions"><button className="outline-revenue-button" type="button" onClick={() => printRevenueExtract(records)}><FileText size={18} /> Extrato de Receitas</button><button className="revenue-button" type="button" onClick={() => setOpen(true)}><Plus size={18} /> Nova Receita</button></div></div>
    <section className="page-card module-card revenue-module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por processo, partes, agente, banco ou conta de recebimento" /></div></div>{loading ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando receitas</strong></div> : filtered.length === 0 ? <div className="module-empty"><BadgeDollarSign size={34} /><strong>Nenhuma receita cadastrada</strong></div> : <div className="data-table receivable-integrated-table"><div className="data-row data-head"><span>Processo</span><span>Partes</span><span>Conta de Recebimento</span><span>Status</span><span className="numeric">Valor</span></div>{filtered.map((item) => { const attachments = attachmentsOf(item); const bank = item.receivingBankAccount; return <div className="data-row" key={item.id}><span><strong>{item.processo || '—'}</strong><small>{item.natureza || ''}</small></span><span><strong>{item.reclamante || '—'}</strong><small>{item.reclamada || ''}{item.agentName ? ` · Agente: ${item.agentName}` : ''}</small></span><span><strong>{bank?.bank || '—'}</strong><small>{bank ? `Ag. ${bank.agency} · C/C ${bank.account}` : 'Conta ainda não informada'}</small></span><span><WorkflowStatusBadge status={item.status} label={statusLabels[item.status] || item.status || '—'} />{canEditReceivable(item, profile?.role) && <button className="small-neutral-button receivable-edit-button" type="button" onClick={() => setEditTarget(item)}><PencilLine size={14} /> {item.status === 'devolvido' ? 'Corrigir e reenviar' : 'Editar rascunho'}</button>}</span><span className="numeric revenue-text"><strong>{money.format(toNumber(item.valorAlvara))}</strong>{attachments.length > 0 && <button className="attachment-count-link" type="button" onClick={() => setAttachmentsTarget(item)}><Paperclip size={14} /> {attachments.length}</button>}</span></div> })}</div>}</section>
    {open && <ReceivableModal key="nova-receita-storage-v2" onClose={close} />}
    {editTarget && <ReceivableModal key={`editar-receita-${editTarget.id}`} existing={editTarget} onClose={() => setEditTarget(null)} />}
    {attachmentsTarget && <div className="modal-backdrop"><section className="decision-modal" role="dialog" aria-modal="true"><div className="modal-toolbar"><div><span className="eyebrow">Documentos da receita</span><h2>{attachmentsTarget.processo || attachmentsTarget.reclamante || 'Recebimento'}</h2></div><button className="icon-button" onClick={() => setAttachmentsTarget(null)}><X size={20} /></button></div><div className="storage-dossier-files">{attachmentsOf(attachmentsTarget).map((file) => <a key={file.path} href={file.url} target="_blank" rel="noreferrer"><Paperclip size={14} /><span>{file.name}</span><ExternalLink size={13} /></a>)}</div></section></div>}
  </>
}
