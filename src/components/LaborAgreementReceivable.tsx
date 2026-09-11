import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { FileText, Plus, Send, Upload, X } from 'lucide-react'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_BANK_ACCOUNT_ID, getBankAccount, type BankAccount } from '../data/bankAccounts'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const decimalBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Parcela = {
  numero: number
  dataPrevista: string
  dataRealizada: string
  valorParcela: number
  honorarios: number
  deducoes: number
  liquidoCliente: number
  dataContabilizacao: string
}

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

function MoneyInput({ value, onChange, ariaLabel }: { value: number; onChange: (value: number) => void; ariaLabel: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value > 0 ? decimalBR.format(value) : '')
  useEffect(() => { if (!focused) setText(value > 0 ? decimalBR.format(value) : '') }, [value, focused])
  return <input
    type="text"
    inputMode="decimal"
    aria-label={ariaLabel}
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

function buildParcelas(count: number, current: Parcela[]): Parcela[] {
  return Array.from({ length: count }, (_, index) => current[index] ?? {
    numero: index + 1,
    dataPrevista: '',
    dataRealizada: '',
    valorParcela: 0,
    honorarios: 0,
    deducoes: 0,
    liquidoCliente: 0,
    dataContabilizacao: '',
  })
}

function LaborAgreementModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const [recordRef] = useState(() => doc(collection(db, 'receivables')))
  const [busy, setBusy] = useState(false)
  const [showClientValidation, setShowClientValidation] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>('RJ')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [processo, setProcesso] = useState('')
  const [reclamada, setReclamada] = useState('')
  const [reclamante, setReclamante] = useState('')
  const [percentualHonorarios, setPercentualHonorarios] = useState(30)
  const [formaRecebimento, setFormaRecebimento] = useState('Depósito na conta da MM')
  const [valorAcordoBruto, setValorAcordoBruto] = useState(0)
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(1)
  const [parcelas, setParcelas] = useState<Parcela[]>(() => buildParcelas(1, []))
  const [bancoCliente, setBancoCliente] = useState('')
  const [agenciaCliente, setAgenciaCliente] = useState('')
  const [contaCliente, setContaCliente] = useState('')
  const [titularCliente, setTitularCliente] = useState('')
  const [cpfCliente, setCpfCliente] = useState('')
  const [pixCliente, setPixCliente] = useState('')
  const [emailCliente, setEmailCliente] = useState('')
  const [telefoneCliente, setTelefoneCliente] = useState('')
  const [enderecoCliente, setEnderecoCliente] = useState('')
  const [honorariosPerito, setHonorariosPerito] = useState(0)
  const [ressarcimentoCustas, setRessarcimentoCustas] = useState(0)
  const [outrasDeducoes, setOutrasDeducoes] = useState(0)
  const [outrasDeducoesDescricao, setOutrasDeducoesDescricao] = useState('')
  const [dataRepassePerito, setDataRepassePerito] = useState('')
  const [receivingBankAccountId, setReceivingBankAccountId] = useState<BankAccount['id']>(DEFAULT_BANK_ACCOUNT_ID)
  const [files, setFiles] = useState<File[]>([])

  useEffect(() => setParcelas((current) => buildParcelas(quantidadeParcelas, current)), [quantidadeParcelas])

  const totalPrevisto = useMemo(() => parcelas.reduce((sum, row) => sum + row.valorParcela, 0), [parcelas])
  const realizadas = useMemo(() => parcelas.filter((row) => Boolean(row.dataRealizada) && row.valorParcela > 0), [parcelas])
  const totalRecebido = useMemo(() => realizadas.reduce((sum, row) => sum + row.valorParcela, 0), [realizadas])
  const honorariosRecebidos = useMemo(() => realizadas.reduce((sum, row) => sum + row.honorarios, 0), [realizadas])
  const deducoesParcelasRecebidas = useMemo(() => realizadas.reduce((sum, row) => sum + row.deducoes, 0), [realizadas])
  const liquidoClienteRecebido = useMemo(() => realizadas.reduce((sum, row) => sum + row.liquidoCliente, 0), [realizadas])
  const clientDataIncomplete = !bancoCliente.trim() || !agenciaCliente.trim() || !contaCliente.trim() || !titularCliente.trim() || !cpfCliente.trim() || !emailCliente.trim() || !telefoneCliente.trim() || !enderecoCliente.trim()

  function updateParcela(index: number, patch: Partial<Parcela>) {
    setParcelas((current) => current.map((row, i) => {
      if (i !== index) return row
      const next = { ...row, ...patch }
      if ('valorParcela' in patch && !('honorarios' in patch)) {
        next.honorarios = Number(((next.valorParcela * percentualHonorarios) / 100).toFixed(2))
      }
      next.liquidoCliente = Math.max(0, Number((next.valorParcela - next.honorarios - next.deducoes).toFixed(2)))
      return next
    }))
  }

  useEffect(() => {
    setParcelas((current) => current.map((row) => {
      const honorarios = Number(((row.valorParcela * percentualHonorarios) / 100).toFixed(2))
      return { ...row, honorarios, liquidoCliente: Math.max(0, Number((row.valorParcela - honorarios - row.deducoes).toFixed(2))) }
    }))
  }, [percentualHonorarios])

  async function uploadAttachments(): Promise<AttachmentMeta[]> {
    if (!profile?.uid || files.length === 0) return []
    const result: AttachmentMeta[] = []
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} ultrapassa 20 MB.`)
      const path = `recebimentos/${profile.uid}/${recordRef.id}/${Date.now()}-${safeFileName(file.name)}`
      const target = storageRef(storage, path)
      await uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' })
      const url = await getDownloadURL(target)
      result.push({ name: file.name, url, path, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy: profile.uid })
    }
    return result
  }

  async function save(status: 'rascunho' | 'enviado_tesouraria') {
    if (!processo.trim() || !reclamante.trim() || valorAcordoBruto <= 0) {
      window.alert('Preencha número do processo, reclamante e valor bruto do acordo.')
      return
    }
    if (status === 'enviado_tesouraria' && totalRecebido <= 0) {
      window.alert('Para enviar à Tesouraria, informe ao menos uma parcela com data realizada e valor recebido.')
      return
    }
    if (status === 'rascunho') setShowClientValidation(false)
    if (status === 'enviado_tesouraria' && liquidoClienteRecebido > 0 && clientDataIncomplete) {
      setShowClientValidation(true)
      window.requestAnimationFrame(() => {
        const firstField = document.querySelector('.labor-agreement-sheet .field-validation-error input') as HTMLInputElement | null
        firstField?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        firstField?.focus()
      })
      return
    }
    if (status === 'enviado_tesouraria') setShowClientValidation(false)
    if (outrasDeducoes > 0 && !outrasDeducoesDescricao.trim()) {
      window.alert('Especifique as Outras Deduções.')
      return
    }
    setBusy(true)
    try {
      const attachments = await uploadAttachments()
      const receivingBankAccount = getBankAccount(receivingBankAccountId)
      const realizedDates = realizadas.map((row) => row.dataRealizada).filter(Boolean).sort()
      const latestReceiptDate = realizedDates.at(-1) || data
      const firstExpectedDate = parcelas.map((row) => row.dataPrevista).filter(Boolean).sort()[0] || ''
      const components = [
        { nome: 'Honorários do Escritório', percentual: percentualHonorarios, valor: honorariosRecebidos },
        { nome: 'Honorários Perito', percentual: 0, valor: honorariosPerito },
        { nome: 'Ressarcimento de Custas', percentual: 0, valor: ressarcimentoCustas },
        { nome: 'Outras Deduções / Participações - Geral 1', percentual: 0, valor: outrasDeducoes, detalhe: outrasDeducoesDescricao.trim() },
      ]
      const totalDeducoes = honorariosRecebidos + deducoesParcelasRecebidas + honorariosPerito + ressarcimentoCustas + outrasDeducoes
      await setDoc(recordRef, {
        tipoRecebimento: 'acordo_trabalhista',
        origem: 'Acordo Trabalhista',
        natureza: 'Trabalhista',
        unidade,
        data,
        processo: processo.trim(),
        reclamada: reclamada.trim(),
        reclamante: reclamante.trim(),
        percentualHonorarios,
        formaRecebimento: formaRecebimento.trim(),
        valorAcordoBruto,
        quantidadeParcelas,
        parcelas,
        valorPrevistoParcelas: totalPrevisto,
        valorAlvara: totalRecebido,
        baseCalculo: valorAcordoBruto,
        invoiceValue: honorariosRecebidos,
        totalDeducoes,
        valorLiquidoCliente: liquidoClienteRecebido,
        dataPrevista: firstExpectedDate,
        receiptDate: latestReceiptDate,
        receivingBankAccountId,
        receivingBankAccount,
        banco: bancoCliente.trim(),
        agencia: agenciaCliente.trim(),
        conta: contaCliente.trim(),
        titular: titularCliente.trim(),
        cpf: cpfCliente.trim(),
        pix: pixCliente.trim(),
        emailNf: emailCliente.trim(),
        telefoneCliente: telefoneCliente.trim(),
        enderecoNf: enderecoCliente.trim(),
        honorariosPerito,
        ressarcimentoCustas,
        outrasDeducoes,
        outrasDeducoesDescricao: outrasDeducoesDescricao.trim(),
        dataRepassePerito,
        components,
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
        action: status === 'rascunho' ? 'Acordo trabalhista salvo como rascunho' : 'Acordo trabalhista enviado à Tesouraria',
        module: 'Recebimento de Acordos Trabalhistas',
        detail: `Processo ${processo.trim()} — acordo ${money.format(valorAcordoBruto)} — recebido ${money.format(totalRecebido)} — ${quantidadeParcelas} parcela(s)`,
        entityId: recordRef.id,
        userId: profile.uid,
        userName: profile.displayName,
        userEmail: profile.email,
        createdAt: serverTimestamp(),
      })
      onClose()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Não foi possível salvar o acordo trabalhista.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop labor-agreement-backdrop"><section className="modal-sheet labor-agreement-sheet" role="dialog" aria-modal="true" aria-label="Controle de Recebimento de Acordo Trabalhista">
    <div className="modal-toolbar"><div><span className="eyebrow revenue-text">Recebimento jurídico</span><h2>Controle de Recebimento de Acordo Trabalhista</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={20} /></button></div>
    <div className="legacy-title-block revenue-title"><strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong><span>CONTROLE DE RECEBIMENTO DE ACORDOS</span></div>

    <h3 className="form-section-title">Dados do Processo</h3>
    <div className="form-grid compact-grid labor-agreement-grid">
      <label><span>Unidade</span><select value={unidade} onChange={(e) => setUnidade(e.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label>
      <label><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
      <label><span>Natureza</span><input value="Trabalhista" readOnly /></label>
      <label className="span-2"><span>Número do processo</span><input value={processo} onChange={(e) => setProcesso(e.target.value)} /></label>
      <label className="span-2"><span>Reclamada</span><input value={reclamada} onChange={(e) => setReclamada(e.target.value)} /></label>
      <label className="span-2"><span>Reclamante</span><input value={reclamante} onChange={(e) => setReclamante(e.target.value)} /></label>
      <label><span>Percentual Honorários (%)</span><input type="number" min="0" max="100" step="0.01" value={percentualHonorarios} onChange={(e) => setPercentualHonorarios(Math.max(0, Number(e.target.value) || 0))} /></label>
    </div>

    <h3 className="form-section-title">Dados do Acordo</h3>
    <div className="form-grid compact-grid labor-agreement-grid">
      <label className="span-2"><span>Forma de Recebimento</span><input value={formaRecebimento} onChange={(e) => setFormaRecebimento(e.target.value)} /></label>
      <label><span>Valor bruto do acordo</span><MoneyInput value={valorAcordoBruto} onChange={setValorAcordoBruto} ariaLabel="Valor bruto do acordo" /></label>
      <label><span>Número de parcelas</span><input type="number" min="1" max="60" value={quantidadeParcelas} onChange={(e) => setQuantidadeParcelas(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} /></label>
      <label className="span-2"><span>Conta de recebimento do escritório</span><select value={receivingBankAccountId} onChange={(e) => setReceivingBankAccountId(e.target.value as BankAccount['id'])}>{(['itau-pj','bb-pf','cef-pf'] as BankAccount['id'][]).map((id) => { const account = getBankAccount(id); return <option key={id} value={id}>{account.bank} · Ag. {account.agency} · C/C {account.account}</option> })}</select></label>
    </div>

    <h3 className="form-section-title">Parcelas e Datas de Recebimento</h3>
    <div className="labor-installments-table">
      <div className="labor-installment-row head"><span>Parc.</span><span>Prevista</span><span>Realizada</span><span>Valor parcela</span><span>Honorários</span><span>Deduções</span><span>Líquido cliente</span><span>Data contabilização</span></div>
      {parcelas.map((row, index) => <div className="labor-installment-row" key={row.numero}>
        <strong>{row.numero}</strong>
        <input type="date" value={row.dataPrevista} onChange={(e) => updateParcela(index, { dataPrevista: e.target.value })} />
        <input type="date" value={row.dataRealizada} onChange={(e) => updateParcela(index, { dataRealizada: e.target.value })} />
        <MoneyInput value={row.valorParcela} onChange={(value) => updateParcela(index, { valorParcela: value })} ariaLabel={`Valor parcela ${row.numero}`} />
        <MoneyInput value={row.honorarios} onChange={(value) => updateParcela(index, { honorarios: value })} ariaLabel={`Honorários parcela ${row.numero}`} />
        <MoneyInput value={row.deducoes} onChange={(value) => updateParcela(index, { deducoes: value })} ariaLabel={`Deduções parcela ${row.numero}`} />
        <strong>{money.format(row.liquidoCliente)}</strong>
        <input type="date" value={row.dataContabilizacao} onChange={(e) => updateParcela(index, { dataContabilizacao: e.target.value })} />
      </div>)}
    </div>
    <div className="labor-agreement-summary"><span>Valor do acordo <strong>{money.format(valorAcordoBruto)}</strong></span><span>Parcelas previstas <strong>{money.format(totalPrevisto)}</strong></span><span>Recebido até agora <strong>{money.format(totalRecebido)}</strong></span><span>Honorários recebidos <strong>{money.format(honorariosRecebidos)}</strong></span></div>

    <h3 className="form-section-title">Dados bancários e contato do cliente</h3>
    {showClientValidation && liquidoClienteRecebido > 0 && clientDataIncomplete && <div className="form-validation-summary" role="alert">Preencha os campos destacados para continuar.</div>}
    <div className="form-grid compact-grid labor-agreement-grid">
      <label className={showClientValidation && !bancoCliente.trim() ? 'field-validation-error' : ''}><span>Banco *</span><input value={bancoCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !bancoCliente.trim()} onChange={(e) => setBancoCliente(e.target.value)} />{showClientValidation && !bancoCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={showClientValidation && !agenciaCliente.trim() ? 'field-validation-error' : ''}><span>Agência *</span><input value={agenciaCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !agenciaCliente.trim()} onChange={(e) => setAgenciaCliente(e.target.value)} />{showClientValidation && !agenciaCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={showClientValidation && !contaCliente.trim() ? 'field-validation-error' : ''}><span>Conta Corrente *</span><input value={contaCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !contaCliente.trim()} onChange={(e) => setContaCliente(e.target.value)} />{showClientValidation && !contaCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={showClientValidation && !titularCliente.trim() ? 'field-validation-error' : ''}><span>Nome / Titular *</span><input value={titularCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !titularCliente.trim()} onChange={(e) => setTitularCliente(e.target.value)} />{showClientValidation && !titularCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={showClientValidation && !cpfCliente.trim() ? 'field-validation-error' : ''}><span>CPF *</span><input value={cpfCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !cpfCliente.trim()} onChange={(e) => setCpfCliente(e.target.value)} />{showClientValidation && !cpfCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label><span>PIX (opcional)</span><input value={pixCliente} onChange={(e) => setPixCliente(e.target.value)} /></label>
      <label className={showClientValidation && !emailCliente.trim() ? 'field-validation-error' : ''}><span>E-mail *</span><input type="email" value={emailCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !emailCliente.trim()} onChange={(e) => setEmailCliente(e.target.value)} />{showClientValidation && !emailCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={showClientValidation && !telefoneCliente.trim() ? 'field-validation-error' : ''}><span>Telefone *</span><input value={telefoneCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !telefoneCliente.trim()} onChange={(e) => setTelefoneCliente(e.target.value)} />{showClientValidation && !telefoneCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
      <label className={`span-2${showClientValidation && !enderecoCliente.trim() ? ' field-validation-error' : ''}`}><span>Endereço *</span><input value={enderecoCliente} required={liquidoClienteRecebido > 0} aria-invalid={showClientValidation && !enderecoCliente.trim()} onChange={(e) => setEnderecoCliente(e.target.value)} />{showClientValidation && !enderecoCliente.trim() && <small className="field-validation-message">Campo obrigatório</small>}</label>
    </div>

    <h3 className="form-section-title">Deduções</h3>
    <div className="form-grid compact-grid labor-agreement-grid">
      <label><span>Honorários Perito</span><MoneyInput value={honorariosPerito} onChange={setHonorariosPerito} ariaLabel="Honorários Perito" /></label>
      <label><span>Data Repasse Perito</span><input type="date" value={dataRepassePerito} onChange={(e) => setDataRepassePerito(e.target.value)} /></label>
      <label><span>Ressarcimentos de Custas</span><MoneyInput value={ressarcimentoCustas} onChange={setRessarcimentoCustas} ariaLabel="Ressarcimentos de Custas" /></label>
      <label><span>Outras Deduções</span><MoneyInput value={outrasDeducoes} onChange={setOutrasDeducoes} ariaLabel="Outras Deduções" /></label>
      <label className="span-2"><span>Especificar outras deduções</span><input value={outrasDeducoesDescricao} onChange={(e) => setOutrasDeducoesDescricao(e.target.value)} /></label>
    </div>

    <h3 className="form-section-title">Documentos do Acordo</h3>
    <label className="labor-agreement-upload"><Upload size={17} /><span>{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Selecionar acordo, comprovantes e documentos'}</span><input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>

    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="outline-revenue-button" type="button" disabled={busy} onClick={() => void save('rascunho')}>Salvar rascunho</button><button className="revenue-button" type="button" disabled={busy} onClick={() => void save('enviado_tesouraria')}><Send size={17} /> Enviar à Tesouraria</button></div>
  </section></div>
}

export function LaborAgreementReceivableLauncher() {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    function locate() {
      const onReceivables = window.location.pathname === '/alvaras'
      const actions = document.querySelector('.page-heading .quick-actions') as HTMLElement | null
      setTarget(onReceivables ? actions : null)
    }
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('popstate', locate)
    return () => { observer.disconnect(); window.removeEventListener('popstate', locate) }
  }, [])

  return <>
    {target && createPortal(<button className="labor-agreement-launch-button" type="button" onClick={() => setOpen(true)}><Plus size={18} /><FileText size={17} /> Novo Acordo Trabalhista</button>, target)}
    {open && createPortal(<LaborAgreementModal onClose={() => setOpen(false)} />, document.body)}
  </>
}
