import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { FilePlus2, Send, Upload, X } from 'lucide-react'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { useInstitutionalSettings } from '../hooks/useInstitutionalSettings'
import { DEFAULT_BANK_ACCOUNT_ID, getBankAccount, type BankAccount } from '../data/bankAccounts'
import { officialChartOfAccounts } from '../data/chartOfAccounts'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const decimalBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const OTHER_REVENUE_ACCOUNTS = officialChartOfAccounts.filter((account) =>
  account.category === 'Receita' && account.kind === 'account' && (account.code.startsWith('3.02.') || account.code.startsWith('3.03.')),
)

type AttachmentMeta = {
  name: string
  url: string
  path: string
  size: number
  type: string
  uploadedAt: string
  uploadedBy: string
}

function parseMoney(value: string) {
  const cleaned = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '')
  if (!cleaned) return 0
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const number = Number(normalized)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function MoneyInput({ value, onChange, validationKey }: { value: number; onChange: (value: number) => void; validationKey?: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value > 0 ? decimalBR.format(value) : '')

  useEffect(() => {
    if (!focused) setText(value > 0 ? decimalBR.format(value) : '')
  }, [focused, value])

  return <input
    type="text"
    inputMode="decimal"
    aria-label="Valor da outra receita"
    data-required-key={validationKey}
    placeholder="0,00"
    value={text}
    onFocus={(event) => { setFocused(true); event.currentTarget.select() }}
    onChange={(event) => { setText(event.target.value); onChange(parseMoney(event.target.value)) }}
    onBlur={() => { setFocused(false); setText(value > 0 ? decimalBR.format(value) : '') }}
  />
}

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo'
}

function OtherRevenueModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const institutional = useInstitutionalSettings()
  const [recordRef] = useState(() => doc(collection(db, 'receivables')))
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>('RJ')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [valor, setValor] = useState(0)
  const [descricao, setDescricao] = useState('')
  const [receivingBankAccountId, setReceivingBankAccountId] = useState<BankAccount['id']>(DEFAULT_BANK_ACCOUNT_ID)
  const [accountCode, setAccountCode] = useState('')
  const [files, setFiles] = useState<File[]>([])

  const selectedAccount = useMemo(
    () => OTHER_REVENUE_ACCOUNTS.find((account) => account.code === accountCode) ?? null,
    [accountCode],
  )

  async function uploadAttachments(): Promise<AttachmentMeta[]> {
    if (!profile?.uid || files.length === 0) return []
    const result: AttachmentMeta[] = []
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} ultrapassa 20 MB.`)
      const path = `recebimentos/${profile.uid}/${recordRef.id}/${Date.now()}-${safeFileName(file.name)}`
      const target = storageRef(storage, path)
      await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' })
      const url = await getDownloadURL(target)
      result.push({
        name: file.name,
        url,
        path,
        size: file.size,
        type: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        uploadedBy: profile.uid,
      })
    }
    return result
  }

  async function save(status: 'rascunho' | 'enviado_tesouraria') {
    const missingKeys: string[] = []
    if (!descricao.trim()) missingKeys.push('other-description')
    if (valor <= 0) missingKeys.push('other-value')
    if (!selectedAccount) missingKeys.push('other-account')
    if (missingKeys.length) { showRequiredFieldErrors('.other-revenue-sheet', missingKeys); return }
    clearRequiredFieldErrors('.other-revenue-sheet')
    if (!selectedAccount) return
    setBusy(true)
    try {
      const attachments = await uploadAttachments()
      const receivingBankAccount = getBankAccount(receivingBankAccountId)
      await setDoc(recordRef, {
        tipoRecebimento: 'outras_receitas',
        origem: 'Outras Receitas',
        natureza: 'Outras Receitas',
        unidade,
        data,
        receiptDate: data,
        descricaoOrigem: descricao.trim(),
        descricao: descricao.trim(),
        valorAlvara: valor,
        baseCalculo: valor,
        valorLiquidoCliente: valor,
        totalDeducoes: 0,
        receivingBankAccountId,
        receivingBankAccount,
        classificacaoContabil: selectedAccount.code,
        revenueAccountCode: selectedAccount.code,
        revenueAccountName: selectedAccount.name,
        revenueAccountDre: selectedAccount.dre,
        planoConta: {
          code: selectedAccount.code,
          name: selectedAccount.name,
          dre: selectedAccount.dre,
          category: 'Receita',
        },
        components: [],
        status,
        attachments,
        attachmentCount: attachments.length,
        storageStatus: 'active',
        createdBy: profile?.uid,
        createdByName: profile?.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      if (profile) await addDoc(collection(db, 'auditLogs'), {
        action: status === 'rascunho' ? 'Outra receita salva como rascunho' : 'Outra receita enviada à Tesouraria',
        module: 'Receitas',
        detail: `${descricao.trim()} — ${money.format(valor)} · ${selectedAccount.code} - ${selectedAccount.name}`,
        entityId: recordRef.id,
        userId: profile.uid,
        userName: profile.displayName,
        userEmail: profile.email,
        createdAt: serverTimestamp(),
      })
      onClose()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Não foi possível salvar a outra receita.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop other-revenue-backdrop">
    <section className="modal-sheet legacy-sheet revenue-sheet other-revenue-sheet" role="dialog" aria-modal="true" aria-label="Outras Receitas">
      <div className="modal-toolbar">
        <div><span className="eyebrow revenue-text">Receitas</span><h2>Outras Receitas</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
      </div>

      <div className="legacy-title-block revenue-title">
        <strong>{institutional.razaoSocial}</strong>
        <span>REGISTRO DE OUTRAS RECEITAS</span>
      </div>

      <div className="form-grid compact-grid other-revenue-grid">
        <label><span>Unidade</span><select value={unidade} onChange={(event) => setUnidade(event.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label>
        <label><span>Data</span><input type="date" value={data} onChange={(event) => setData(event.target.value)} /></label>
        <label><span>Valor</span><MoneyInput value={valor} onChange={setValor} validationKey="other-value" /></label>
        <label className="span-3"><span>Descrição / Origem</span><input data-required-key="other-description" value={descricao} onChange={(event) => setDescricao(event.target.value)} placeholder="Ex.: Aporte de sócio, reembolso, rendimento de aplicação" /></label>
        <label className="span-3"><span>Conta Gerencial</span><select data-required-key="other-account" value={accountCode} onChange={(event) => setAccountCode(event.target.value)}><option value="">Selecione a conta gerencial</option>{OTHER_REVENUE_ACCOUNTS.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name}</option>)}</select></label>
        <label className="span-3"><span>Conta de recebimento</span><select value={receivingBankAccountId} onChange={(event) => setReceivingBankAccountId(event.target.value as BankAccount['id'])}>{(['itau-pj', 'bb-pf', 'cef-pf'] as BankAccount['id'][]).map((id) => { const account = getBankAccount(id); return <option key={id} value={id}>{account.bank} · Ag. {account.agency} · C/C {account.account} · {account.holder}</option> })}</select></label>
      </div>

      <div className="other-revenue-account-hint">
        <FilePlus2 size={18} />
        <span>Use uma conta de Receita Financeira ou de Outras Receitas e Entradas já existente no Plano de Contas.</span>
      </div>

      <label className="labor-agreement-upload other-revenue-upload">
        <Upload size={17} />
        <span>{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Selecionar documentos comprobatórios'}</span>
        <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </label>

      <div className="legacy-total"><span>Total da Receita</span><strong>{money.format(valor)}</strong></div>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        <button className="outline-revenue-button" type="button" disabled={busy} onClick={() => void save('rascunho')}>Salvar rascunho</button>
        <button className="revenue-button" type="button" disabled={busy} onClick={() => void save('enviado_tesouraria')}><Send size={17} /> {busy ? 'Salvando...' : 'Enviar à Tesouraria'}</button>
      </div>
    </section>
  </div>
}

export function OtherRevenueReceivable() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-other-revenue', handler)
    return () => window.removeEventListener('open-other-revenue', handler)
  }, [])

  if (!open) return null
  return <OtherRevenueModal onClose={() => setOpen(false)} />
}
