import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  BadgeDollarSign,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Filter,
  FolderArchive,
  Lightbulb,
  LockKeyhole,
  Paperclip,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../lib/firebase'
import { useAuth, type UserRole, type UserStatus } from '../auth/AuthContext'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateBR = new Intl.DateTimeFormat('pt-BR')
const PRIMARY_ADMIN_EMAIL = 'fernandoazeredo64@gmail.com'

const roleLabels: Record<UserRole, string> = {
  master: 'Master',
  admin: 'Administrador',
  diretoria: 'Diretoria / Aprovador',
  tesouraria: 'Tesouraria / Financeiro',
  alvaras: 'Recebimento de Alvarás',
  contabilidade: 'Contabilidade',
  consulta: 'Consulta',
}

const statusLabels: Record<UserStatus, string> = {
  pending: 'Pendente',
  active: 'Ativo',
  inactive: 'Inativo',
  blocked: 'Bloqueado',
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

const receivableStatusLabels: Record<string, string> = {
  rascunho: 'Rascunho',
  enviado_tesouraria: 'Enviado à Tesouraria',
  recebido_tesouraria: 'Recebido pela Tesouraria',
  devolvido: 'Devolvido para Correção',
  encerrado: 'Encerrado / Arquivado',
}

type AnyRecord = { id: string } & DocumentData

type ExpenseItem = {
  data: string
  historico: string
  valor: string
}

type RevenueComponent = {
  nome: string
  percentual: number
  valor: number
}

function useLiveCollection(name: string) {
  const [records, setRecords] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {
      setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return unsubscribe
  }, [name])

  return { records, loading }
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function parseBRL(value: string) {
  const cleaned = value.replace(/\s/g, '').replace(/R\$/g, '')
  if (!cleaned) return 0
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function formatBRLInput(value: string) {
  if (!value.trim()) return ''
  return money.format(parseBRL(value))
}

function timestampToDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return dateBR.format((value as { toDate: () => Date }).toDate())
  }
  return '—'
}

async function writeAudit(profile: ReturnType<typeof useAuth>['profile'], action: string, module: string, detail: string, entityId?: string) {
  if (!profile) return
  await addDoc(collection(db, 'auditLogs'), {
    action,
    module,
    detail,
    entityId: entityId ?? null,
    userId: profile.uid,
    userName: profile.displayName,
    userEmail: profile.email,
    createdAt: serverTimestamp(),
  })
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="quick-actions">{actions}</div>}
    </div>
  )
}

function StatusBadge({ value, tone = 'neutral' }: { value: string; tone?: 'expense' | 'revenue' | 'success' | 'warning' | 'neutral' }) {
  return <span className={`status-badge ${tone}`}>{value}</span>
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="module-empty">
      <Icon size={34} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>('RJ')
  const [nome, setNome] = useState('')
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7))
  const [fornecedor, setFornecedor] = useState('')
  const [documento, setDocumento] = useState('')
  const [categoria, setCategoria] = useState('')
  const [subcategoria, setSubcategoria] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [items, setItems] = useState<ExpenseItem[]>([
    { data: new Date().toISOString().slice(0, 10), historico: '', valor: '' },
    { data: '', historico: '', valor: '' },
    { data: '', historico: '', valor: '' },
  ])
  const total = useMemo(() => items.reduce((sum, item) => sum + parseBRL(item.valor), 0), [items])

  if (!open) return null

  function updateItem(index: number, field: keyof ExpenseItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  async function save(status: 'rascunho' | 'enviado_aprovacao') {
    const validItems = items.filter((item) => item.historico.trim() || parseBRL(item.valor) > 0)
    if (!nome.trim() || !validItems.length || total <= 0) {
      window.alert('Preencha o nome/responsável e pelo menos uma linha de despesa com histórico e valor.')
      return
    }

    setBusy(true)
    try {
      const payload = {
        unidade,
        nome: nome.trim(),
        competencia,
        fornecedor: fornecedor.trim(),
        documento: documento.trim(),
        categoria,
        subcategoria,
        classificacaoContabil: classificacao || null,
        observacoes: observacoes.trim(),
        items: validItems.map((item) => ({ ...item, valor: parseBRL(item.valor) })),
        valorTotal: total,
        status,
        createdBy: profile?.uid,
        createdByName: profile?.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'expenses'), payload)
      await writeAudit(profile, status === 'rascunho' ? 'Despesa salva como rascunho' : 'Despesa enviada para aprovação', 'Despesas', `${nome} — ${money.format(total)}`, ref.id)
      onClose()
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível salvar a despesa. Confira sua conexão e permissão de acesso.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-sheet legacy-sheet expense-sheet" role="dialog" aria-modal="true" aria-label="Novo demonstrativo de despesas">
        <div className="modal-toolbar">
          <div>
            <span className="eyebrow expense-text">Tesouraria</span>
            <h2>Demonstrativo de Despesas</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>

        <div className="legacy-title-block">
          <strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong>
          <span>DEMONSTRATIVO DE DESPESAS</span>
        </div>

        <div className="form-grid compact-grid">
          <label><span>Unidade</span><select value={unidade} onChange={(e) => setUnidade(e.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label>
          <label className="span-2"><span>Nome / Responsável</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do responsável pela despesa" /></label>
          <label><span>Competência</span><input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label className="span-2"><span>Fornecedor / Favorecido</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label>
          <label><span>CPF / CNPJ</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} /></label>
        </div>

        <div className="legacy-table expense-table">
          <div className="legacy-row legacy-head"><span>DATA</span><span>HISTÓRICO</span><span>VALOR</span><span></span></div>
          {items.map((item, index) => (
            <div className="legacy-row" key={index}>
              <input type="date" value={item.data} onChange={(e) => updateItem(index, 'data', e.target.value)} />
              <input value={item.historico} onChange={(e) => updateItem(index, 'historico', e.target.value)} placeholder="Descrição da despesa" />
              <input value={item.valor} onChange={(e) => updateItem(index, 'valor', e.target.value)} onBlur={(e) => updateItem(index, 'valor', formatBRLInput(e.target.value))} placeholder="R$ 0,00" />
              <button type="button" className="row-remove" title="Remover linha" onClick={() => setItems((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="add-row-button expense-text" onClick={() => setItems((current) => [...current, { data: '', historico: '', valor: '' }])}><Plus size={16} /> Adicionar linha</button>

        <div className="form-grid compact-grid section-gap">
          <label><span>Categoria</span><select value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Selecionar</option><option>Impostos, Tributos e Encargos</option><option>Folha de Pagamento e Pessoal</option><option>Contas a Pagar - Operacionais</option><option>Honorários, Comissões e Participações</option><option>Reembolsos e Despesas de Representação</option><option>Despesas Extraordinárias / Não Recorrentes</option></select></label>
          <label><span>Subcategoria</span><input value={subcategoria} onChange={(e) => setSubcategoria(e.target.value)} placeholder="Ex.: Energia, Aluguel, FGTS..." /></label>
          <label><span>Classificação de Contas <small>(opcional)</small></span><input value={classificacao} onChange={(e) => setClassificacao(e.target.value)} placeholder="Código / conta" /></label>
          <label className="span-3"><span>OBS.</span><textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} /></label>
        </div>

        <div className="document-zone disabled-zone">
          <Paperclip size={19} />
          <div><strong>Documentos comprobatórios</strong><span>Upload de boleto, nota fiscal e comprovante será habilitado assim que o Storage estiver disponível.</span></div>
          <LockKeyhole size={17} />
        </div>

        <div className="legacy-total"><span>Total da Despesa</span><strong>{money.format(total)}</strong></div>
        <div className="approval-strip"><span>Visto / Aprovações</span><em>Será preenchido eletronicamente após o envio à Diretoria.</em></div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
          <button className="outline-expense-button" type="button" disabled={busy} onClick={() => save('rascunho')}>Salvar rascunho</button>
          <button className="expense-button" type="button" disabled={busy} onClick={() => save('enviado_aprovacao')}><Send size={17} /> Enviar para Aprovação</button>
        </div>
      </section>
    </div>
  )
}

function ReceivableModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState<'RJ' | 'SP'>('RJ')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [natureza, setNatureza] = useState('Trabalhista')
  const [processo, setProcesso] = useState('')
  const [reclamada, setReclamada] = useState('')
  const [reclamante, setReclamante] = useState('')
  const [origem, setOrigem] = useState('Alvará')
  const [formaRecebimento, setFormaRecebimento] = useState('')
  const [dataPrevista, setDataPrevista] = useState('')
  const [totalAlvara, setTotalAlvara] = useState(0)
  const [baseCalculo, setBaseCalculo] = useState(0)
  const [liquidoCliente, setLiquidoCliente] = useState(0)
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [titular, setTitular] = useState('')
  const [cpf, setCpf] = useState('')
  const [emailNf, setEmailNf] = useState('')
  const [enderecoNf, setEnderecoNf] = useState('')
  const [components, setComponents] = useState<RevenueComponent[]>([
    { nome: 'Imposto de Renda', percentual: 0, valor: 0 },
    { nome: 'INSS', percentual: 0, valor: 0 },
    { nome: 'INSS Empregador', percentual: 0, valor: 0 },
    { nome: 'Honorários do Escritório', percentual: 0, valor: 0 },
    { nome: 'Honorários Perito', percentual: 0, valor: 0 },
    { nome: 'Ressarcimento de Custas', percentual: 0, valor: 0 },
    { nome: 'Despesas Bancárias / Tarifas', percentual: 0, valor: 0 },
    { nome: 'Outras Deduções / Participações', percentual: 0, valor: 0 },
  ])

  if (!open) return null

  function updatePercent(index: number, percentual: number) {
    setComponents((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, percentual, valor: totalAlvara > 0 ? Number(((totalAlvara * percentual) / 100).toFixed(2)) : 0 }
      : item))
  }

  function updateValue(index: number, valor: number) {
    setComponents((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, valor, percentual: totalAlvara > 0 ? Number(((valor / totalAlvara) * 100).toFixed(4)) : 0 }
      : item))
  }

  function changeTotal(value: number) {
    setTotalAlvara(value)
    if (baseCalculo === 0) setBaseCalculo(value)
    setComponents((current) => current.map((item) => ({ ...item, valor: value > 0 ? Number(((value * item.percentual) / 100).toFixed(2)) : 0 })))
  }

  async function save(status: 'rascunho' | 'enviado_tesouraria') {
    if (!processo.trim() || !reclamante.trim() || totalAlvara <= 0) {
      window.alert('Preencha número do processo, reclamante e valor líquido do alvará.')
      return
    }
    setBusy(true)
    try {
      const ref = await addDoc(collection(db, 'receivables'), {
        unidade,
        data,
        natureza,
        processo: processo.trim(),
        reclamada: reclamada.trim(),
        reclamante: reclamante.trim(),
        origem,
        formaRecebimento: formaRecebimento.trim(),
        dataPrevista,
        valorAlvara: totalAlvara,
        baseCalculo,
        valorLiquidoCliente: liquidoCliente,
        components,
        banco,
        agencia,
        conta,
        titular,
        cpf,
        emailNf,
        enderecoNf,
        status,
        createdBy: profile?.uid,
        createdByName: profile?.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await writeAudit(profile, status === 'rascunho' ? 'Recebimento salvo como rascunho' : 'Recebimento enviado à Tesouraria', 'Recebimento de Alvarás', `Processo ${processo} — ${money.format(totalAlvara)}`, ref.id)
      onClose()
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível salvar o recebimento. Confira sua conexão e permissão de acesso.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-sheet legacy-sheet revenue-sheet" role="dialog" aria-modal="true" aria-label="Novo demonstrativo de recebimento de honorários">
        <div className="modal-toolbar">
          <div><span className="eyebrow revenue-text">Recebimento de Alvarás</span><h2>Demonstrativo de Recebimento de Honorários</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        <div className="legacy-title-block revenue-title"><strong>FLÁVIO MARQUES ADVOGADOS ASSOCIADOS</strong><span>DEMONSTRATIVO DE RECEBIMENTO DE HONORÁRIOS</span></div>

        <h3 className="form-section-title">Dados do Processo</h3>
        <div className="form-grid compact-grid">
          <label><span>Unidade</span><select value={unidade} onChange={(e) => setUnidade(e.target.value as 'RJ' | 'SP')}><option>RJ</option><option>SP</option></select></label>
          <label><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label><span>Natureza</span><select value={natureza} onChange={(e) => setNatureza(e.target.value)}><option>Trabalhista</option><option>Cível</option></select></label>
          <label className="span-2"><span>Número do processo</span><input value={processo} onChange={(e) => setProcesso(e.target.value)} /></label>
          <label className="span-2"><span>Reclamada</span><input value={reclamada} onChange={(e) => setReclamada(e.target.value)} /></label>
          <label className="span-2"><span>Reclamante</span><input value={reclamante} onChange={(e) => setReclamante(e.target.value)} /></label>
          <label><span>Origem</span><select value={origem} onChange={(e) => setOrigem(e.target.value)}><option>Alvará</option><option>Acordo</option></select></label>
          <label><span>Forma de recebimento</span><input value={formaRecebimento} onChange={(e) => setFormaRecebimento(e.target.value)} /></label>
          <label><span>Data prevista</span><input type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} /></label>
        </div>

        <h3 className="form-section-title">Composição do Valor</h3>
        <div className="composition-table">
          <div className="composition-row composition-head"><span>Componente</span><span>Percentual (%)</span><span>Valor (R$)</span></div>
          <div className="composition-row total-row"><strong>Valor Líquido do Alvará</strong><span>100%</span><input type="number" min="0" step="0.01" value={totalAlvara || ''} onChange={(e) => changeTotal(Number(e.target.value))} /></div>
          <div className="composition-row"><strong>Base Cálculo Honorários (Valor Bruto)</strong><span>—</span><input type="number" min="0" step="0.01" value={baseCalculo || ''} onChange={(e) => setBaseCalculo(Number(e.target.value))} /></div>
          {components.map((component, index) => (
            <div className="composition-row" key={component.nome}>
              <span>{component.nome}</span>
              <input type="number" min="0" step="0.01" value={component.percentual || ''} onChange={(e) => updatePercent(index, Number(e.target.value))} />
              <input type="number" min="0" step="0.01" value={component.valor || ''} onChange={(e) => updateValue(index, Number(e.target.value))} />
            </div>
          ))}
          <div className="composition-row client-row"><strong>VALOR LÍQUIDO DEVIDO AO CLIENTE</strong><span>—</span><input type="number" min="0" step="0.01" value={liquidoCliente || ''} onChange={(e) => setLiquidoCliente(Number(e.target.value))} /></div>
        </div>
        <p className="form-note">Percentual e valor permanecem editáveis. Ao alterar um deles, o outro é recalculado em relação ao valor do alvará.</p>

        <h3 className="form-section-title">Dados bancários para crédito do cliente</h3>
        <div className="form-grid compact-grid">
          <label><span>Banco</span><input value={banco} onChange={(e) => setBanco(e.target.value)} /></label>
          <label><span>Agência</span><input value={agencia} onChange={(e) => setAgencia(e.target.value)} /></label>
          <label><span>Conta</span><input value={conta} onChange={(e) => setConta(e.target.value)} /></label>
          <label className="span-2"><span>Nome / Titular</span><input value={titular} onChange={(e) => setTitular(e.target.value)} /></label>
          <label><span>CPF</span><input value={cpf} onChange={(e) => setCpf(e.target.value)} /></label>
        </div>

        <h3 className="form-section-title">Dados para emissão de Nota Fiscal</h3>
        <div className="form-grid compact-grid">
          <label className="span-2"><span>Endereço</span><input value={enderecoNf} onChange={(e) => setEnderecoNf(e.target.value)} /></label>
          <label><span>E-mail</span><input type="email" value={emailNf} onChange={(e) => setEmailNf(e.target.value)} /></label>
        </div>

        <div className="document-zone disabled-zone revenue-zone"><Paperclip size={19} /><div><strong>Alvará, acordo e documentos do processo</strong><span>Upload será ativado assim que o Storage estiver disponível.</span></div><LockKeyhole size={17} /></div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
          <button className="outline-revenue-button" type="button" disabled={busy} onClick={() => save('rascunho')}>Salvar rascunho</button>
          <button className="revenue-button" type="button" disabled={busy} onClick={() => save('enviado_tesouraria')}><Send size={17} /> Enviar à Tesouraria</button>
        </div>
      </section>
    </div>
  )
}

export function DashboardPage() {
  const { records: expenses } = useLiveCollection('expenses')
  const { records: receivables } = useLiveCollection('receivables')
  const expenseTotal = expenses.reduce((sum, item) => sum + toNumber(item.valorTotal), 0)
  const revenueTotal = receivables.reduce((sum, item) => sum + toNumber(item.valorAlvara), 0)
  const balance = revenueTotal - expenseTotal
  const pending = expenses.filter((item) => item.status === 'enviado_aprovacao' || item.status === 'em_analise').length

  return (
    <>
      <PageHeader eyebrow="Visão gerencial" title="Dashboard Financeira" description="Retrato consolidado das despesas, recebimentos, honorários, repasses e aprovações." actions={<><Link className="expense-button button-link" to="/despesas?novo=1"><ReceiptText size={18} /> + Despesa</Link><Link className="revenue-button button-link" to="/alvaras?novo=1"><BadgeDollarSign size={18} /> + Recebimento</Link></>} />
      <div className="metrics-grid">
        <article className="metric revenue-metric"><span>Receitas / Recebimentos</span><strong>{money.format(revenueTotal)}</strong><small>Total registrado</small></article>
        <article className="metric expense-metric"><span>Despesas</span><strong>{money.format(expenseTotal)}</strong><small>Total registrado</small></article>
        <article className={`metric balance-metric ${balance < 0 ? 'negative' : ''}`}><span>Saldo / Resultado</span><strong>{money.format(balance)}</strong><small>Receitas menos despesas</small></article>
        <article className="metric"><span>Aguardando Aprovação</span><strong>{pending}</strong><small>Fluxo da Diretoria</small></article>
      </div>
      <div className="dashboard-grid">
        <section className="page-card"><div className="card-title-row"><h2>Movimento financeiro</h2><span className="mini-legend"><i className="legend-revenue" /> Receitas <i className="legend-expense" /> Despesas</span></div><div className="summary-bars"><div><span>Receitas</span><strong>{money.format(revenueTotal)}</strong><b className="bar revenue-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? 100 : 4)}%` }} /></div><div><span>Despesas</span><strong>{money.format(expenseTotal)}</strong><b className="bar expense-bar" style={{ width: `${Math.min(100, revenueTotal > 0 ? (expenseTotal / revenueTotal) * 100 : expenseTotal > 0 ? 100 : 4)}%` }} /></div></div></section>
        <section className="page-card"><h2>Fluxo de aprovação</h2><div className="status-row"><span>Rascunhos</span><strong>{expenses.filter((item) => item.status === 'rascunho').length}</strong></div><div className="status-row"><span>Em análise</span><strong>{pending}</strong></div><div className="status-row"><span>Aprovados</span><strong>{expenses.filter((item) => item.status === 'aprovado').length}</strong></div><div className="status-row"><span>Devolvidos</span><strong>{expenses.filter((item) => item.status === 'devolvido').length}</strong></div></section>
      </div>
    </>
  )
}

export function ExpensesPage() {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('novo') === '1')
  const [search, setSearch] = useState('')
  const { records, loading } = useLiveCollection('expenses')
  useEffect(() => { if (params.get('novo') === '1') setOpen(true) }, [params])
  const filtered = records.filter((item) => `${item.nome ?? ''} ${item.fornecedor ?? ''} ${item.competencia ?? ''} ${item.categoria ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const close = () => { setOpen(false); setParams({}) }

  return (
    <>
      <PageHeader eyebrow="Tesouraria" title="Despesas" description="Criação do demonstrativo tradicional, envio para aprovação, acompanhamento de status e extrato de despesas." actions={<><button className="outline-expense-button" type="button"><FileText size={18} /> Extrato de Despesas</button><button className="expense-button" type="button" onClick={() => setOpen(true)}><Plus size={18} /> Nova Despesa</button></>} />
      <section className="page-card module-card expense-module-card">
        <div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por responsável, fornecedor, competência ou categoria" /></div><button className="secondary-button"><Filter size={17} /> Filtros</button></div>
        {loading ? <EmptyState icon={RefreshCw} title="Carregando despesas" text="Consultando o Firestore..." /> : filtered.length === 0 ? <EmptyState icon={ReceiptText} title="Nenhuma despesa encontrada" text="Clique em Nova Despesa para preencher o primeiro demonstrativo." /> : <div className="data-table"><div className="data-row data-head"><span>Competência</span><span>Responsável / Favorecido</span><span>Categoria</span><span>Status</span><span className="numeric">Valor</span></div>{filtered.map((item) => <div className="data-row" key={item.id}><span>{item.competencia || '—'}</span><span><strong>{item.nome || 'Sem nome'}</strong><small>{item.fornecedor || ''}</small></span><span>{item.categoria || 'Não classificada'}</span><span><StatusBadge value={expenseStatusLabels[item.status] || item.status || '—'} tone="expense" /></span><span className="numeric expense-text"><strong>{money.format(toNumber(item.valorTotal))}</strong></span></div>)}</div>}
      </section>
      <ExpenseModal open={open} onClose={close} />
    </>
  )
}

export function ReceivablesPage() {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('novo') === '1')
  const [search, setSearch] = useState('')
  const { records, loading } = useLiveCollection('receivables')
  useEffect(() => { if (params.get('novo') === '1') setOpen(true) }, [params])
  const filtered = records.filter((item) => `${item.processo ?? ''} ${item.reclamante ?? ''} ${item.reclamada ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const close = () => { setOpen(false); setParams({}) }

  return (
    <>
      <PageHeader eyebrow="Origem do recebimento" title="Recebimento de Alvarás" description="O departamento de origem preenche o demonstrativo completo e envia o documento pronto à Tesouraria." actions={<><button className="outline-revenue-button" type="button"><FileText size={18} /> Extrato de Receitas</button><button className="revenue-button" type="button" onClick={() => setOpen(true)}><Plus size={18} /> Novo Recebimento</button></>} />
      <section className="page-card module-card revenue-module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por processo, reclamante ou reclamada" /></div><StatusBadge value="Receita = azul" tone="revenue" /></div>{loading ? <EmptyState icon={RefreshCw} title="Carregando recebimentos" text="Consultando o Firestore..." /> : filtered.length === 0 ? <EmptyState icon={BadgeDollarSign} title="Nenhum recebimento cadastrado" text="Clique em Novo Recebimento para preencher o demonstrativo de honorários." /> : <div className="data-table"><div className="data-row data-head"><span>Processo</span><span>Partes</span><span>Origem</span><span>Status</span><span className="numeric">Valor</span></div>{filtered.map((item) => <div className="data-row" key={item.id}><span><strong>{item.processo || '—'}</strong><small>{item.natureza || ''}</small></span><span><strong>{item.reclamante || '—'}</strong><small>{item.reclamada || ''}</small></span><span>{item.origem || '—'}</span><span><StatusBadge value={receivableStatusLabels[item.status] || item.status || '—'} tone="revenue" /></span><span className="numeric revenue-text"><strong>{money.format(toNumber(item.valorAlvara))}</strong></span></div>)}</div>}</section>
      <ReceivableModal open={open} onClose={close} />
    </>
  )
}

export function TreasuryPage() {
  const { profile } = useAuth()
  const { records } = useLiveCollection('receivables')
  const queue = records.filter((item) => item.status !== 'rascunho')

  async function changeStatus(item: AnyRecord, status: string) {
    await updateDoc(doc(db, 'receivables', item.id), { status, updatedAt: serverTimestamp(), treasuryBy: profile?.uid, treasuryAt: serverTimestamp() })
    await writeAudit(profile, `Recebimento atualizado: ${receivableStatusLabels[status] ?? status}`, 'Tesouraria — Recebimentos', `Processo ${item.processo ?? item.id}`, item.id)
  }

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Tesouraria — Recebimentos" description="Recebimento dos demonstrativos prontos, confirmação bancária, repasses, comprovantes e encerramento da operação." />
      <div className="workflow-cards"><article><span>1</span><strong>Receber demonstrativo</strong><small>Documento vem pronto da área de origem.</small></article><ChevronRight /><article><span>2</span><strong>Conferir crédito</strong><small>Confirmar data e valor recebido.</small></article><ChevronRight /><article><span>3</span><strong>Executar repasses</strong><small>Cliente, peritos, participações e demais pagamentos.</small></article><ChevronRight /><article><span>4</span><strong>Encerrar</strong><small>Comprovantes e dossiê final.</small></article></div>
      <section className="page-card module-card revenue-module-card">{queue.length === 0 ? <EmptyState icon={CircleDollarSign} title="Nenhum recebimento aguardando Tesouraria" text="Os demonstrativos enviados pelo módulo Recebimento de Alvarás aparecerão aqui." /> : <div className="data-table treasury-table"><div className="data-row data-head"><span>Processo</span><span>Cliente / Reclamante</span><span>Status</span><span className="numeric">Valor</span><span>Ações</span></div>{queue.map((item) => <div className="data-row" key={item.id}><span>{item.processo}</span><span>{item.reclamante}</span><span><StatusBadge value={receivableStatusLabels[item.status] || item.status} tone="revenue" /></span><span className="numeric revenue-text"><strong>{money.format(toNumber(item.valorAlvara))}</strong></span><span className="row-actions">{item.status === 'enviado_tesouraria' && <><button className="small-revenue-button" onClick={() => changeStatus(item, 'recebido_tesouraria')}>Confirmar recebimento</button><button className="small-neutral-button" onClick={() => changeStatus(item, 'devolvido')}>Devolver</button></>}{item.status === 'recebido_tesouraria' && <button className="small-success-button" onClick={() => changeStatus(item, 'encerrado')}>Encerrar</button>}</span></div>)}</div>}</section>
    </>
  )
}

export function ApprovalsPage() {
  const { profile } = useAuth()
  const { records } = useLiveCollection('expenses')
  const queue = records.filter((item) => ['enviado_aprovacao', 'em_analise', 'devolvido'].includes(item.status))

  async function decide(item: AnyRecord, status: string) {
    const note = status === 'devolvido' || status === 'rejeitado' ? window.prompt('Informe a justificativa:') : ''
    if ((status === 'devolvido' || status === 'rejeitado') && !note) return
    await updateDoc(doc(db, 'expenses', item.id), { status, approvalNote: note || null, approvedBy: profile?.uid, approvedByName: profile?.displayName, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    await writeAudit(profile, `Despesa: ${expenseStatusLabels[status] ?? status}`, 'Aprovações', `${item.nome ?? 'Despesa'} — ${money.format(toNumber(item.valorTotal))}`, item.id)
  }

  return (
    <>
      <PageHeader eyebrow="Diretoria" title="Aprovações" description="Fila eletrônica de despesas para análise, aprovação, devolução para correção ou rejeição." />
      <section className="page-card module-card approval-card">{queue.length === 0 ? <EmptyState icon={FileCheck2} title="Nenhuma aprovação pendente" text="As despesas enviadas pela Tesouraria aparecerão nesta fila." /> : <div className="approval-list">{queue.map((item) => <article className="approval-item" key={item.id}><div><StatusBadge value={expenseStatusLabels[item.status] || item.status} tone="expense" /><h3>{item.nome || 'Demonstrativo de despesa'}</h3><p>{item.fornecedor || 'Sem fornecedor informado'} · {item.competencia || 'Sem competência'} · {item.categoria || 'Sem categoria'}</p></div><strong className="expense-text">{money.format(toNumber(item.valorTotal))}</strong><div className="row-actions"><button className="small-success-button" onClick={() => decide(item, 'aprovado')}><BadgeCheck size={15} /> Aprovar</button><button className="small-neutral-button" onClick={() => decide(item, 'devolvido')}>Devolver</button><button className="small-expense-button" onClick={() => decide(item, 'rejeitado')}>Rejeitar</button></div></article>)}</div>}</section>
    </>
  )
}

const starterAccounts = [
  ['111.02.003-4', 'Itaú Empresas', 'Ativo'],
  ['111.01.002-1', 'Caixa', 'Ativo'],
  ['311.05.005-1', 'Despesas Bancárias - Tarifas', 'Despesa'],
  ['311.01.078.4', 'Despesas Honorários Cálculos / Peritos', 'Despesa'],
  ['215.01', 'Valores a Repassar', 'Passivo'],
  ['411.01.003-4', 'Dedução Compensatória de Impostos', 'Receita / Dedução'],
  ['411.02.003-0', 'Honorários Trabalhistas', 'Receita'],
  ['411.02.007-2', 'Reembolso Despesas Exercícios Anteriores - Perito', 'Receita'],
  ['121.01.003-1', 'Repasse Distrato Societário', 'Ativo'],
  ['112.07.005.1', 'Despesas Custas / Perícias a Ressarcir', 'Ativo'],
]

export function AccountsPage() {
  const { profile } = useAuth()
  const { records } = useLiveCollection('chartOfAccounts')
  const [search, setSearch] = useState('')
  const source = records.length ? records.map((item) => [item.code, item.name, item.type, item.id]) : starterAccounts.map((item) => [...item, ''])
  const filtered = source.filter((item) => `${item[0]} ${item[1]} ${item[2]}`.toLowerCase().includes(search.toLowerCase()))

  async function seed() {
    if (records.length) return
    const batch = writeBatch(db)
    starterAccounts.forEach(([code, name, type]) => {
      const ref = doc(collection(db, 'chartOfAccounts'))
      batch.set(ref, { code, name, type, active: true, createdAt: serverTimestamp() })
    })
    await batch.commit()
    await writeAudit(profile, 'Plano de contas inicial carregado', 'Plano de Contas', `${starterAccounts.length} contas cadastradas`)
  }

  return (
    <>
      <PageHeader eyebrow="Classificação opcional" title="Plano de Contas" description="Plano hierárquico interno para classificação de despesas e componentes de recebimentos. A classificação não bloqueia o fluxo." actions={!records.length ? <button className="secondary-button" onClick={seed}><BookOpenCheck size={17} /> Carregar plano inicial</button> : undefined} />
      <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código ou nome da conta" /></div><StatusBadge value="Classificação não obrigatória" /></div><div className="data-table accounts-table"><div className="data-row data-head"><span>Código</span><span>Nome da Conta</span><span>Tipo</span><span>Status</span></div>{filtered.map((item) => <div className="data-row" key={`${item[0]}-${item[1]}`}><span><strong>{item[0]}</strong></span><span>{item[1]}</span><span>{item[2]}</span><span><StatusBadge value="Ativa" tone="success" /></span></div>)}</div></section>
    </>
  )
}

export function AccountingPage() {
  const { records: expenses } = useLiveCollection('expenses')
  const { records: receivables } = useLiveCollection('receivables')
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7))
  const approvedExpenses = expenses.filter((item) => ['aprovado', 'pago', 'arquivado'].includes(item.status))
  const finishedReceivables = receivables.filter((item) => ['recebido_tesouraria', 'encerrado'].includes(item.status))

  return (
    <>
      <PageHeader eyebrow="Fechamento mensal" title="Contabilidade" description="Conferência do movimento, preparação do pacote mensal e histórico de envio para o contador." />
      <section className="page-card accounting-panel"><div className="accounting-config"><label><span>Competência</span><input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} /></label><label><span>Unidade</span><select><option>Todas</option><option>RJ</option><option>SP</option></select></label><label><span>Movimento</span><select><option>Despesas + Recebimentos</option><option>Somente Despesas</option><option>Somente Recebimentos</option></select></label></div><div className="readiness-grid"><article><ReceiptText /><span>Despesas aptas</span><strong>{approvedExpenses.length}</strong></article><article><BadgeDollarSign /><span>Recebimentos aptos</span><strong>{finishedReceivables.length}</strong></article><article><Paperclip /><span>Documentos no Storage</span><strong>0</strong><small>Pendente Blaze</small></article><article><CheckCircle2 /><span>Classificação</span><strong>Opcional</strong></article></div><div className="warning-box"><AlertTriangle size={18} /><span>O pacote ZIP e o link seguro serão liberados quando o Storage estiver ativo. A conferência financeira e a competência já podem ser preparadas normalmente.</span></div><div className="accounting-actions"><button className="secondary-button" disabled><Archive size={17} /> Baixar ZIP</button><button className="secondary-button" disabled><Send size={17} /> Gerar link para Contabilidade</button><button className="revenue-button" disabled><Calculator size={17} /> Enviar Movimento à Contabilidade</button></div></section>
    </>
  )
}

export function DocumentsPage() {
  const { records: expenses } = useLiveCollection('expenses')
  const { records: receivables } = useLiveCollection('receivables')
  const [search, setSearch] = useState('')
  const dossiers = [
    ...expenses.map((item) => ({ id: item.id, type: 'Despesa', title: item.nome || item.fornecedor || 'Despesa', value: item.valorTotal, status: expenseStatusLabels[item.status] || item.status, tone: 'expense' as const })),
    ...receivables.map((item) => ({ id: item.id, type: 'Recebimento', title: item.processo || item.reclamante || 'Recebimento', value: item.valorAlvara, status: receivableStatusLabels[item.status] || item.status, tone: 'revenue' as const })),
  ].filter((item) => `${item.type} ${item.title} ${item.status}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <PageHeader eyebrow="Dossiê digital" title="Arquivo de Documentos" description="Pesquisa centralizada de demonstrativos, comprovantes, alvarás, notas fiscais e histórico financeiro." />
      <section className="page-card module-card"><div className="module-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar processo, fornecedor, cliente, status ou tipo" /></div><StatusBadge value="Storage pendente" tone="warning" /></div>{dossiers.length === 0 ? <EmptyState icon={FolderArchive} title="Arquivo ainda sem dossiês" text="Os registros financeiros aparecerão aqui; os anexos serão adicionados quando o Storage for ativado." /> : <div className="dossier-grid">{dossiers.map((item) => <article key={`${item.type}-${item.id}`}><div className={`dossier-icon ${item.tone}`}><FileText size={22} /></div><div><small>{item.type}</small><strong>{item.title}</strong><span>{item.status}</span></div><b className={item.tone === 'expense' ? 'expense-text' : 'revenue-text'}>{money.format(toNumber(item.value))}</b></article>)}</div>}</section>
    </>
  )
}

export function UsersPage() {
  const { profile } = useAuth()
  const { records, loading } = useLiveCollection('users')
  const canManage = profile?.role === 'master' || profile?.role === 'admin'

  async function updateUser(item: AnyRecord, field: 'role' | 'status', value: string) {
    if (!canManage || item.email === PRIMARY_ADMIN_EMAIL) return
    await updateDoc(doc(db, 'users', item.id), { [field]: value, updatedAt: serverTimestamp(), updatedBy: profile?.uid })
    await writeAudit(profile, `Usuário atualizado: ${field}`, 'Usuários', `${item.email} → ${value}`, item.id)
  }

  return (
    <>
      <PageHeader eyebrow="Acesso e segurança" title="Usuários e Permissões" description="Aprovação de novos cadastros, definição de perfil, ativação, bloqueio e controle de acesso por função." actions={<StatusBadge value={`${records.filter((item) => item.status === 'pending').length} pendente(s)`} tone="warning" />} />
      <section className="page-card module-card users-card">{loading ? <EmptyState icon={RefreshCw} title="Carregando usuários" text="Consultando perfis do Firestore..." /> : <div className="data-table users-table"><div className="data-row data-head"><span>Usuário</span><span>Perfil</span><span>Status</span><span>Último acesso</span></div>{records.map((item) => { const locked = item.email === PRIMARY_ADMIN_EMAIL; return <div className="data-row" key={item.id}><span><strong>{item.displayName || 'Usuário'}</strong><small>{item.email}</small>{locked && <em className="master-lock"><ShieldCheck size={13} /> Administrador principal</em>}</span><span>{canManage && !locked ? <select value={item.role || 'consulta'} onChange={(e) => updateUser(item, 'role', e.target.value)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <StatusBadge value={roleLabels[(item.role as UserRole) || 'consulta'] || item.role} />}</span><span>{canManage && !locked ? <select value={item.status || 'pending'} onChange={(e) => updateUser(item, 'status', e.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <StatusBadge value={locked ? 'Ativo' : statusLabels[(item.status as UserStatus) || 'pending']} tone={item.status === 'active' || locked ? 'success' : item.status === 'pending' ? 'warning' : 'neutral'} />}</span><span>{timestampToDate(item.lastLoginAt)}</span></div>})}</div>}</section>
    </>
  )
}

export function AuditPage() {
  const { records, loading } = useLiveCollection('auditLogs')
  const ordered = [...records].sort((a, b) => {
    const aTime = a.createdAt?.seconds ?? 0
    const bTime = b.createdAt?.seconds ?? 0
    return bTime - aTime
  })
  return (
    <>
      <PageHeader eyebrow="Rastreabilidade" title="Auditoria" description="Registro cronológico das inclusões, aprovações, devoluções, alterações de usuários e eventos relevantes do sistema." />
      <section className="page-card module-card audit-card">{loading ? <EmptyState icon={RefreshCw} title="Carregando auditoria" text="Consultando histórico..." /> : ordered.length === 0 ? <EmptyState icon={ShieldCheck} title="Nenhum evento registrado" text="As próximas ações relevantes do sistema serão gravadas aqui." /> : <div className="audit-list">{ordered.map((item) => <article key={item.id}><div className="audit-dot" /><div><strong>{item.action}</strong><span>{item.module} · {item.detail}</span><small>{item.userName || item.userEmail || 'Sistema'} · {timestampToDate(item.createdAt)}</small></div></article>)}</div>}</section>
    </>
  )
}

export function TipsPage() {
  return (
    <>
      <PageHeader eyebrow="Ajuda rápida" title="DICAS" description="Fluxos operacionais e respostas simples para as situações mais comuns do dia a dia." />
      <div className="tips-grid"><article className="tip expense-tip"><ReceiptText /><h3>Despesa</h3><p>Tesouraria → Nova Despesa → preencher demonstrativo → enviar para aprovação → Diretoria aprova/devolve → pagamento → arquivo.</p></article><article className="tip revenue-tip"><BadgeDollarSign /><h3>Recebimento</h3><p>Área de origem → Novo Recebimento → preencher demonstrativo completo → enviar pronto à Tesouraria → conferência → repasses → encerramento.</p></article><article className="tip"><FileCheck2 /><h3>Se houver erro</h3><p>Não altere silenciosamente um documento já enviado. Use a devolução para correção e preserve o histórico do fluxo.</p></article><article className="tip"><Paperclip /><h3>Comprovantes</h3><p>Assim que o Storage estiver ativo, cada lançamento terá seu dossiê com PDFs, imagens, boletos, alvarás e comprovantes.</p></article></div>
    </>
  )
}

export function HowToPage() {
  const steps = [
    ['1', 'Comece pelo módulo correto', 'Tesouraria usa Despesas; área de origem usa Recebimento de Alvarás; Diretoria usa Aprovações.'],
    ['2', 'Preencha o demonstrativo', 'Use o formulário eletrônico com o mesmo raciocínio do modelo tradicional do escritório.'],
    ['3', 'Envie pelo fluxo', 'Despesa segue para aprovação; recebimento segue pronto para a Tesouraria.'],
    ['4', 'Acompanhe o status', 'Rascunho, enviado, aprovado, devolvido e encerrado ficam visíveis no próprio módulo.'],
    ['5', 'Consulte e feche', 'Dashboard, Arquivo de Documentos, Auditoria e Contabilidade consolidam o histórico.'],
  ]
  return (
    <>
      <PageHeader eyebrow="Guia operacional" title="Como Usar" description="Passo a passo direto para operar o sistema com segurança e pouca complexidade." />
      <div className="howto-steps">{steps.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><section className="page-card tour-callout"><Lightbulb size={24} /><div><h2>Tour Guiado</h2><p>O tour interativo com holofote por botão será conectado a estas etapas após concluirmos todos os elementos definitivos das telas.</p></div></section>
    </>
  )
}
