import { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type DocumentData } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTask } from 'firebase/storage'
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Filter, Paperclip, Pencil, Plus, ReceiptText, RefreshCw, Search, Send, Trash2, Upload, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { ExpenseManagementDashboard } from '../components/ExpenseManagementDashboard'
import { FinancialMovementCard } from '../components/FinancialMovementCard'
import { WorkflowStatusBadge } from '../components/WorkflowStatusBadge'
import { DEFAULT_BANK_ACCOUNT_ID, getBankAccount, type BankAccount } from '../data/bankAccounts'
import type { ChartOfAccount } from '../data/chartOfAccounts'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
type AnyRecord = { id: string } & DocumentData
type ExpenseItem = { data: string; historico: string; valor: string }
type AttachmentMeta = { name: string; url: string; path: string; size: number; type: string; uploadedAt: string; uploadedBy: string }
type UploadStatus = 'uploading' | 'success' | 'error' | 'canceled'
type UploadItem = {
  id: string
  name: string
  size: number
  type: string
  progress: number
  bytesTransferred: number
  status: UploadStatus
  error?: string
  meta?: AttachmentMeta
}

const expenseStatusLabels: Record<string, string> = {
  rascunho: 'Rascunho',
  enviado_aprovacao: 'Enviado para Aprovação',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido p/ Correção',
  rejeitado: 'Rejeitado',
  pago: 'Pago',
  arquivado: 'Arquivado',
}

function useExpenses() {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, 'expenses'), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [])
  return { records, loading }
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function parseBRL(value: string) {
  const cleaned = value.replace(/\s/g, '').replace(/R\$/g, '')
  if (!cleaned) return 0
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function formatCurrencyFromDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? money.format(Number(digits) / 100) : ''
}

function asCurrencyInput(value: unknown) {
  const number = toNumber(value)
  return number ? money.format(number) : ''
}

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo'
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function existingAttachments(record?: AnyRecord | null): AttachmentMeta[] {
  return Array.isArray(record?.attachments) ? record.attachments as AttachmentMeta[] : []
}

async function writeAudit(profile: ReturnType<typeof useAuth>['profile'], action: string, detail: string, entityId?: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), {
    action,
    module: 'Despesas',
    detail,
    entityId: entityId ?? null,
    userId: profile.uid,
    userName: profile.displayName,
    userEmail: profile.email,
    createdAt: serverTimestamp(),
  })
}

function Header({ onNew }: { onNew: () => void }) {
  return <div className="page-heading"><div><span className="eyebrow">Tesouraria</span><h1>Despesas</h1><p>Criação, documentos, movimentação financeira, correção e acompanhamento do demonstrativo.</p></div><div className="quick-actions"><button className="outline-expense-button" type="button"><FileText size={18} /> Extrato de Despesas</button><button className="expense-button" type="button" onClick={onNew}><Plus size={18} /> Nova Despesa</button></div></div>
}

function ExpenseModal({ record, onClose }: { record?: AnyRecord | null; onClose: () => void }) {
  const { profile } = useAuth()
  const editing = Boolean(record)
  const isDraft = record?.status === 'rascunho'
  const isReturned = record?.status === 'devolvido'
  const [expenseId] = useState(() => record?.id ?? doc(collection(db, 'expenses')).id)
  const tasksRef = useRef<Map<string, UploadTask>>(new Map())
  const savedRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>((record?.unidade as 'RJ' | 'SP') || 'RJ')
  const [nome, setNome] = useState(String(record?.nome ?? ''))
  const [competencia, setCompetencia] = useState(String(record?.competencia ?? new Date().toISOString().slice(0, 7)))
  const [fornecedor, setFornecedor] = useState(String(record?.fornecedor ?? ''))
  const [documento, setDocumento] = useState(String(record?.documento ?? ''))
  const [subcategoria, setSubcategoria] = useState(String(record?.subcategoria ?? ''))
  const [observacoes, setObservacoes] = useState(String(record?.observacoes ?? ''))
  const [account] = useState<ChartOfAccount | null>(null)
  const [paymentBankAccountId, setPaymentBankAccountId] = useState<BankAccount['id']>((record?.paymentBankAccountId as BankAccount['id']) || DEFAULT_BANK_ACCOUNT_ID)
  const [paymentDate, setPaymentDate] = useState(String(record?.paymentDate ?? ''))
  const [paymentMethod, setPaymentMethod] = useState(String(record?.paymentMethod ?? ''))
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const initialAccountCode = String(record?.expenseAccountCode ?? record?.classificacaoContabil ?? '')
  const initialItems = Array.isArray(record?.items) && record?.items.length
    ? record.items.map((item: DocumentData) => ({ data: String(item.data ?? ''), historico: String(item.historico ?? ''), valor: asCurrencyInput(item.valor) }))
    : [{ data: new Date().toISOString().slice(0, 10), historico: '', valor: '' }, { data: '', historico: '', valor: '' }, { data: '', historico: '', valor: '' }]
  const [items, setItems] = useState<ExpenseItem[]>(initialItems)
  const total = useMemo(() => items.reduce((sum, item) => sum + parseBRL(item.valor), 0), [items])
  const previousAttachments = useMemo(() => existingAttachments(record), [record])
  const hasUploading = uploads.some((item) => item.status === 'uploading')
  const readyUploads = uploads.filter((item) => item.status === 'success' && item.meta).map((item) => item.meta as AttachmentMeta)
  const visibleUploadCount = uploads.filter((item) => item.status === 'uploading' || item.status === 'success').length
  const attachmentCount = previousAttachments.length + visibleUploadCount

  useEffect(() => () => {
    tasksRef.current.forEach((task) => task.cancel())
    tasksRef.current.clear()
  }, [])

  function updateItem(index: number, field: keyof ExpenseItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  function patchUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function startUpload(file: File) {
    if (!profile?.uid) return
    if (file.size > 20 * 1024 * 1024) {
      window.alert(`O arquivo ${file.name} ultrapassa o limite de 20 MB.`)
      return
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const path = `despesas/${profile.uid}/${expenseId}/${Date.now()}-${safeFileName(file.name)}`
    const target = storageRef(storage, path)
    const task = uploadBytesResumable(target, file, { contentType: file.type || 'application/octet-stream' })

    setUploads((current) => [...current, {
      id,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      progress: 0,
      bytesTransferred: 0,
      status: 'uploading',
    }])
    tasksRef.current.set(id, task)

    task.on('state_changed', (snapshot) => {
      const progress = snapshot.totalBytes > 0 ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0
      patchUpload(id, { progress, bytesTransferred: snapshot.bytesTransferred })
    }, (error) => {
      tasksRef.current.delete(id)
      if (error.code === 'storage/canceled') {
        patchUpload(id, { status: 'canceled', error: 'Upload cancelado.' })
        return
      }
      patchUpload(id, { status: 'error', error: error.message || 'Falha no upload.' })
    }, async () => {
      try {
        const url = await getDownloadURL(task.snapshot.ref)
        const meta: AttachmentMeta = {
          name: file.name,
          url,
          path,
          size: file.size,
          type: file.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
          uploadedBy: profile.uid,
        }
        patchUpload(id, { status: 'success', progress: 100, bytesTransferred: file.size, meta })
      } catch (error) {
        patchUpload(id, { status: 'error', error: error instanceof Error ? error.message : 'Falha ao obter o link do arquivo.' })
      } finally {
        tasksRef.current.delete(id)
      }
    })
  }

  function selectFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? [])
    files.forEach(startUpload)
  }

  async function removeNewUpload(item: UploadItem) {
    const task = tasksRef.current.get(item.id)
    if (task) {
      task.cancel()
      tasksRef.current.delete(item.id)
    }
    if (item.meta?.path) {
      try {
        await deleteObject(storageRef(storage, item.meta.path))
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
        if (code !== 'storage/object-not-found') console.error(error)
      }
    }
    setUploads((current) => current.filter((upload) => upload.id !== item.id))
  }

  async function closeWithoutSave() {
    tasksRef.current.forEach((task) => task.cancel())
    tasksRef.current.clear()
    if (!savedRef.current) {
      await Promise.allSettled(readyUploads.map((item) => deleteObject(storageRef(storage, item.path))))
    }
    onClose()
  }

  async function save(status: 'rascunho' | 'devolvido' | 'enviado_aprovacao') {
    const validItems = items.filter((item) => item.historico.trim() || parseBRL(item.valor) > 0)
    const missingKeys: string[] = []
    if (!nome.trim()) missingKeys.push('expense-name')
    const firstValidIndex = items.findIndex((item) => item.historico.trim() || parseBRL(item.valor) > 0)
    const requiredIndex = firstValidIndex >= 0 ? firstValidIndex : 0
    if (!items[requiredIndex]?.historico.trim()) missingKeys.push(`expense-history-${requiredIndex}`)
    if (parseBRL(items[requiredIndex]?.valor || '') <= 0 || total <= 0) missingKeys.push(`expense-value-${requiredIndex}`)
    if (missingKeys.length) { showRequiredFieldErrors('.expense-sheet', missingKeys); return }
    clearRequiredFieldErrors('.expense-sheet')
    if (hasUploading) {
      window.alert('Aguarde a conclusão do envio dos anexos. O progresso está sendo mostrado no formulário.')
      return
    }

    setBusy(true)
    try {
      const expenseRef = doc(db, 'expenses', expenseId)
      const attachments = [...previousAttachments, ...readyUploads]
      const chosenCode = account?.code || initialAccountCode || null
      const chosenName = account?.name || String(record?.expenseAccountName ?? '') || null
      const chosenDre = account?.dre || String(record?.expenseAccountDre ?? '') || null
      const paymentBankAccount = getBankAccount(paymentBankAccountId)
      const payload = {
        unidade,
        nome: nome.trim(),
        competencia,
        fornecedor: fornecedor.trim(),
        documento: documento.trim(),
        categoria: chosenCode && chosenName ? `${chosenCode} - ${chosenName}` : String(record?.categoria ?? ''),
        subcategoria: subcategoria.trim(),
        classificacaoContabil: chosenCode,
        expenseAccountCode: chosenCode,
        expenseAccountName: chosenName,
        expenseAccountDre: chosenDre,
        planoConta: chosenCode ? { code: chosenCode, name: chosenName, dre: chosenDre, category: 'Despesa' } : null,
        paymentBankAccountId,
        paymentBankAccount,
        paymentDate,
        paymentMethod,
        observacoes: observacoes.trim(),
        items: validItems.map((item) => ({ ...item, valor: parseBRL(item.valor) })),
        valorTotal: total,
        status,
        attachments,
        attachmentCount: attachments.length,
        storageStatus: 'active',
        updatedAt: serverTimestamp(),
        correctedBy: editing ? profile?.uid : null,
        correctedAt: editing ? serverTimestamp() : null,
        ...(status === 'enviado_aprovacao' ? { approvalNote: null } : {}),
      }

      if (record) await updateDoc(expenseRef, payload)
      else await setDoc(expenseRef, { ...payload, createdBy: profile?.uid, createdByName: profile?.displayName, createdAt: serverTimestamp() })

      let action = status === 'rascunho' ? 'Despesa salva como rascunho' : 'Despesa enviada para aprovação'
      if (record?.status === 'rascunho') action = status === 'rascunho' ? 'Rascunho de despesa atualizado' : 'Rascunho enviado para aprovação'
      if (record?.status === 'devolvido') action = status === 'enviado_aprovacao' ? 'Despesa corrigida e reenviada para aprovação' : 'Correção de despesa salva'
      await writeAudit(profile, action, `${nome} — ${money.format(total)} · ${paymentBankAccount.bank} · ${attachments.length} anexo(s)`, expenseRef.id)
      savedRef.current = true
      onClose()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Não foi possível salvar a despesa.')
    } finally {
      setBusy(false)
    }
  }

  const modalTitle = isDraft ? 'Editar Demonstrativo de Despesas' : isReturned ? 'Corrigir Demonstrativo de Despesas' : 'Demonstrativo de Despesas'
  const saveDisabled = busy || hasUploading

  return <div className="modal-backdrop"><section className="modal-sheet legacy-sheet expense-sheet" role="dialog" aria-modal="true">
    <div className="modal-toolbar"><div><span className="eyebrow expense-text">Tesouraria</span><h2>{modalTitle}</h2></div><button className="icon-button" type="button" onClick={() => void closeWithoutSave()}><X size={20} /></button></div>
    <div className="legacy-title-block"><strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong><span>DEMONSTRATIVO DE DESPESAS</span></div>
    {isReturned && <div className="return-note"><div><strong>Devolvido para correção</strong><span>{record?.approvalNote || 'A Diretoria solicitou correção deste demonstrativo.'}</span></div></div>}

    <div className="form-grid compact-grid"><label><span>Unidade</span><select value={unidade} onChange={(e) => setUnidade(e.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label><label className="span-2"><span>Nome / Responsável</span><input data-required-key="expense-name" value={nome} onChange={(e) => setNome(e.target.value)} /></label><label><span>Competência</span><input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label><label className="span-2"><span>Fornecedor / Favorecido</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label><label><span>CPF / CNPJ</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} /></label></div>

    <div className="legacy-table expense-table"><div className="legacy-row legacy-head"><span>DATA</span><span>HISTÓRICO</span><span>VALOR</span><span></span></div>{items.map((item, index) => <div className="legacy-row" key={index}><input type="date" value={item.data} onChange={(e) => updateItem(index, 'data', e.target.value)} /><input data-required-key={`expense-history-${index}`} value={item.historico} onChange={(e) => updateItem(index, 'historico', e.target.value)} /><input data-required-key={`expense-value-${index}`} inputMode="numeric" value={item.valor} onChange={(e) => updateItem(index, 'valor', formatCurrencyFromDigits(e.target.value))} placeholder="R$ 0,00" /><button type="button" className="row-remove" onClick={() => setItems((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)}><Trash2 size={15} /></button></div>)}</div>
    <button type="button" className="add-row-button expense-text" onClick={() => setItems((current) => [...current, { data: '', historico: '', valor: '' }])}><Plus size={16} /> Adicionar linha</button>

    <div className="form-grid compact-grid section-gap"><label className="span-2"><span>Detalhamento complementar <small>(opcional)</small></span><input value={subcategoria} onChange={(e) => setSubcategoria(e.target.value)} /></label><label className="span-3"><span>OBS.</span><textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} /></label></div>

    <FinancialMovementCard mode="payment" bankAccountId={paymentBankAccountId} onBankAccountChange={setPaymentBankAccountId} movementDate={paymentDate} onMovementDateChange={setPaymentDate} amount={total} paymentMethod={paymentMethod} onPaymentMethodChange={setPaymentMethod} />

    <div className="document-zone storage-document-zone"><CheckCircle2 size={20} /><div><strong>Documentos comprobatórios · Storage ativo</strong><span>O upload começa imediatamente após selecionar. Limite de 20 MB por arquivo.</span></div><label className="storage-upload-button"><Upload size={16} /> Selecionar arquivos{attachmentCount > 0 && <span className="storage-upload-count">{attachmentCount}</span>}<input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => { selectFiles(e.target.files); e.currentTarget.value = '' }} /></label></div>

    {(previousAttachments.length > 0 || uploads.length > 0) && <div className="expense-attachment-list enhanced-attachment-list">
      {previousAttachments.map((item) => <a className="attachment-confirmed" key={item.path} href={item.url} target="_blank" rel="noreferrer"><CheckCircle2 size={18} /><div><strong>{item.name}</strong><span>✓ Enviado — {formatBytes(item.size)}</span></div><ExternalLink size={14} /></a>)}
      {uploads.map((item) => <div className={`attachment-upload-row attachment-${item.status}`} key={item.id}>
        <div className="attachment-upload-main"><Paperclip size={17} /><div><strong>{item.name}</strong>{item.status === 'uploading' && <><span>{item.progress}% enviado · {formatBytes(item.bytesTransferred)} de {formatBytes(item.size)}</span><div className="attachment-progress"><i style={{ width: `${item.progress}%` }} /></div></>}{item.status === 'success' && <span>✓ Enviado — {formatBytes(item.size)}</span>}{item.status === 'error' && <span>Falha no envio: {item.error}</span>}{item.status === 'canceled' && <span>Upload cancelado.</span>}</div></div>
        <button className="attachment-remove-button" type="button" title={item.status === 'uploading' ? 'Cancelar upload' : 'Remover arquivo'} onClick={() => void removeNewUpload(item)}><X size={15} /></button>
      </div>)}
    </div>}

    <div className="legacy-total"><span>Total da Despesa</span><strong>{money.format(total)}</strong></div>
    {hasUploading && <div className="upload-save-note"><RefreshCw className="spin" size={16} /> Aguarde o término do upload para salvar ou enviar o demonstrativo.</div>}
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void closeWithoutSave()}>Cancelar</button>{isDraft ? <><button className="outline-expense-button" type="button" disabled={saveDisabled} onClick={() => save('rascunho')}>Salvar alterações</button><button className="expense-button" type="button" disabled={saveDisabled} onClick={() => save('enviado_aprovacao')}><Send size={17} /> {busy ? 'Salvando...' : 'Enviar para Aprovação'}</button></> : isReturned ? <><button className="outline-expense-button" type="button" disabled={saveDisabled} onClick={() => save('devolvido')}>Salvar correção</button><button className="expense-button" type="button" disabled={saveDisabled} onClick={() => save('enviado_aprovacao')}><Send size={17} /> {busy ? 'Salvando...' : 'Reenviar para Aprovação'}</button></> : <><button className="outline-expense-button" type="button" disabled={saveDisabled} onClick={() => save('rascunho')}>Salvar rascunho</button><button className="expense-button" type="button" disabled={saveDisabled} onClick={() => save('enviado_aprovacao')}><Send size={17} /> {busy ? 'Salvando...' : 'Enviar para Aprovação'}</button></>}</div>
  </section></div>
}

export function ExpensesPageStorage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('novo') === '1')
  const [editing, setEditing] = useState<AnyRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnyRecord | null>(null)
  const [attachmentTarget, setAttachmentTarget] = useState<AnyRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const { records, loading } = useExpenses()

  useEffect(() => {
    if (params.get('novo') === '1') {
      setEditing(null)
      setOpen(true)
    }
  }, [params])

  const filtered = records.filter((item) => `${item.nome ?? ''} ${item.fornecedor ?? ''} ${item.competencia ?? ''} ${item.categoria ?? ''} ${item.expenseAccountCode ?? ''} ${item.expenseAccountName ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const close = () => { setOpen(false); setEditing(null); setParams({}) }

  async function confirmDeleteDraft() {
    if (!deleteTarget || deleteTarget.status !== 'rascunho' || !profile) return
    setDeleting(true)
    try {
      for (const attachment of existingAttachments(deleteTarget)) {
        if (!attachment.path) continue
        try {
          await deleteObject(storageRef(storage, attachment.path))
        } catch (error) {
          const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
          if (code !== 'storage/object-not-found' && code !== 'storage/unauthorized') throw error
        }
      }
      await deleteDoc(doc(db, 'expenses', deleteTarget.id))
      await writeAudit(profile, 'Rascunho de despesa excluído', `${deleteTarget.nome || 'Despesa'} — ${money.format(toNumber(deleteTarget.valorTotal))}`, deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível excluir o rascunho. Confira sua permissão e tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  return <>
    <Header onNew={() => { setEditing(null); setOpen(true) }} />
    <ExpenseManagementDashboard records={records} loading={loading} />
    <section className="page-card module-card expense-module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por responsável, fornecedor, competência, código ou conta" /></div><button className="secondary-button"><Filter size={17} /> Filtros</button></div>
      {loading ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando despesas</strong></div> : filtered.length === 0 ? <div className="module-empty"><ReceiptText size={34} /><strong>Nenhuma despesa encontrada</strong><span>Clique em Nova Despesa para preencher o primeiro demonstrativo.</span></div> : <div className="data-table review-expenses-table"><div className="data-row data-head"><span>Competência</span><span>Responsável / Favorecido</span><span>Plano de Contas</span><span>Status</span><span className="numeric">Valor</span><span>Ações</span></div>{filtered.map((item) => {
        const isDraft = item.status === 'rascunho'
        const canEdit = profile?.role === 'master' || item.createdBy === profile?.uid
        const canDelete = isDraft && canEdit
        const attachments = existingAttachments(item)
        const count = toNumber(item.attachmentCount) || attachments.length
        return <div className="data-row" key={item.id}><span>{item.competencia || '—'}</span><span><strong>{item.nome || 'Sem nome'}</strong><small>{item.fornecedor || ''}</small></span><span><strong>{item.expenseAccountCode || item.classificacaoContabil || '—'}</strong><small>{item.expenseAccountName || item.categoria || 'Não classificada'}</small></span><span><WorkflowStatusBadge status={item.status} label={expenseStatusLabels[item.status] || item.status || '—'} /></span><span className="numeric expense-text"><strong>{money.format(toNumber(item.valorTotal))}</strong>{count > 0 ? <button className="attachment-count-button" type="button" onClick={() => setAttachmentTarget(item)} title="Abrir anexos"><Paperclip size={14} /><b>{count}</b></button> : <small>Sem anexos</small>}</span><span>{isDraft && canEdit ? <div className="row-actions"><button className="small-neutral-button" type="button" onClick={() => { setEditing(item); setOpen(true) }}><Pencil size={14} /> Editar</button>{canDelete && <button className="small-expense-button" type="button" onClick={() => setDeleteTarget(item)}><Trash2 size={14} /> Excluir</button>}</div> : item.status === 'devolvido' && canEdit ? <button className="small-expense-button" type="button" onClick={() => { setEditing(item); setOpen(true) }}><Pencil size={14} /> Corrigir e reenviar</button> : <span className="muted-dash">—</span>}</span></div>
      })}</div>}
    </section>

    {open && <ExpenseModal key={editing?.id ?? 'nova-despesa-storage'} record={editing} onClose={close} />}

    {attachmentTarget && <div className="modal-backdrop"><section className="decision-modal attachment-viewer-modal" role="dialog" aria-modal="true"><div className="modal-toolbar"><div><span className="eyebrow">Documentos comprobatórios</span><h2>Anexos da despesa</h2></div><button className="icon-button" type="button" onClick={() => setAttachmentTarget(null)}><X size={20} /></button></div><div className="attachment-viewer-heading"><Paperclip size={20} /><div><strong>{attachmentTarget.nome || 'Despesa'}</strong><span>{existingAttachments(attachmentTarget).length} arquivo(s)</span></div></div><div className="attachment-viewer-list">{existingAttachments(attachmentTarget).map((item) => <a key={item.path || item.url} href={item.url} target="_blank" rel="noreferrer"><CheckCircle2 size={17} /><div><strong>{item.name}</strong><span>Enviado · {formatBytes(item.size)}</span></div><ExternalLink size={14} /></a>)}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAttachmentTarget(null)}>Fechar</button></div></section></div>}

    {deleteTarget && <div className="modal-backdrop"><section className="decision-modal rejeitado" role="dialog" aria-modal="true"><div className="modal-toolbar"><div><span className="eyebrow">Excluir rascunho</span><h2>Confirmar exclusão</h2></div><button className="icon-button" type="button" onClick={() => setDeleteTarget(null)}><X size={20} /></button></div><div className="decision-warning"><AlertTriangle size={20} /><div><strong>{deleteTarget.nome || 'Despesa em rascunho'}</strong><span>{money.format(toNumber(deleteTarget.valorTotal))}</span></div></div><p>Esta ação é permitida somente enquanto o lançamento estiver em <strong>Rascunho</strong>. O registro será removido da lista e a exclusão ficará registrada na Auditoria.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="expense-button" type="button" disabled={deleting} onClick={confirmDeleteDraft}><Trash2 size={16} /> {deleting ? 'Excluindo...' : 'Excluir rascunho'}</button></div></section></div>}
  </>
}
