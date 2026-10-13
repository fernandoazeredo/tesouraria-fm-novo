import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { BarChart3, CheckCircle2, ChevronDown, CircleAlert, Filter, RefreshCw, Search, Sparkles } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import { officialChartOfAccounts, type ChartOfAccount } from '../data/chartOfAccounts'
import { learnedClassificationSuggestion, type LearningClassification } from '../lib/managerialClassificationLearning'
import '../dre-gerencial.css'

type SourceType = 'expense' | 'revenue'
type AnyRecord = { id: string } & DocumentData
type ClassificationRecord = AnyRecord & LearningClassification & {
  accountName?: string
  accountDre?: string | null
}
type UnifiedLaunch = {
  key: string
  sourceType: SourceType
  sourceId: string
  source: AnyRecord
  date: string
  competence: string
  unit: string
  title: string
  description: string
  counterparty: string
  amount: number
  status: string
  classification?: ClassificationRecord
}

type Suggestion = { account: ChartOfAccount | null; confidence: number; reason: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateBR = new Intl.DateTimeFormat('pt-BR')
const EXPENSE_DRE_STATUSES = new Set(['aprovado', 'pago', 'arquivado'])
const REVENUE_DRE_STATUSES = new Set(['recebido_tesouraria', 'encerrado'])

const drePreferredOrder = [
  'Receita de Vendas de Produtos e Serviços',
  'Receitas e Rendimentos Financeiros',
  'Outras Receitas Não Operacionais',
  'Impostos Sobre Vendas',
  'Comissões Sobre Vendas',
  'Custos dos Serviços Prestados',
  'Despesas com Pessoal',
  'Despesas Administrativas',
  'Despesas Gerais',
  'Despesas Financeiras',
  'Outras Despesas Não Operacionais',
]

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function readableDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—'
  const [year, month, day] = value.split('-').map(Number)
  return dateBR.format(new Date(year, month - 1, day))
}

function truncateText(value: string, limit = 60) {
  const text = value.trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text
}

function receivableManagementAmount(record: AnyRecord) {
  const type = normalized(record.tipoRecebimento).replace(/\s+/g, '_')
  const isLegacyOtherRevenue = !String(record.processo ?? '').trim() && toNumber(record.valorAlvara) > 0
  if (type === 'outras_receitas' || isLegacyOtherRevenue) return toNumber(record.valorAlvara)
  const direct = toNumber(record.invoiceValue)
  if (direct > 0) return direct
  const components = Array.isArray(record.components) ? record.components as DocumentData[] : []
  return toNumber(components.find((item) => item.nome === 'Honorários do Escritório')?.valor)
}

function expenseHistory(item: AnyRecord) {
  return Array.isArray(item.items)
    ? (item.items as DocumentData[]).map((row) => String(row.historico ?? '').trim()).filter(Boolean).join(' · ')
    : ''
}

function sourceDescription(type: SourceType, item: AnyRecord) {
  if (type === 'expense') {
    const itemText = expenseHistory(item)
    return [item.nome, item.fornecedor, item.subcategoria, itemText].filter(Boolean).join(' · ')
  }
  if (item.tipoRecebimento === 'outras_receitas') {
    return String(item.descricaoOrigem ?? item.descricao ?? item.origem ?? 'Outras Receitas')
  }
  return [item.origem, item.natureza, item.processo, item.reclamante, item.reclamada].filter(Boolean).join(' · ')
}

function sourceCounterparty(type: SourceType, item: AnyRecord) {
  if (type === 'expense') return String(item.fornecedor ?? item.nome ?? '')
  if (item.tipoRecebimento === 'outras_receitas') return String(item.descricaoOrigem ?? item.descricao ?? item.origem ?? '')
  return [item.reclamante, item.reclamada].filter(Boolean).map(String).join(' × ')
}

function sourceCardTitle(type: SourceType, item: AnyRecord) {
  if (type === 'expense') return String(item.fornecedor ?? item.nome ?? 'Despesa')
  if (item.tipoRecebimento === 'outras_receitas') return String(item.descricaoOrigem ?? item.descricao ?? 'Outras Receitas')
  const parties = [item.reclamante, item.reclamada].filter(Boolean).map(String).join(' × ')
  return parties || String(item.titular ?? item.processo ?? 'Receita')
}

function sourceCardDescription(type: SourceType, item: AnyRecord) {
  if (type === 'expense') {
    return expenseHistory(item) || String(item.subcategoria ?? item.observacoes ?? item.nome ?? 'Sem histórico/descrição')
  }
  if (item.tipoRecebimento === 'outras_receitas') {
    return String(item.descricaoOrigem ?? item.descricao ?? 'Outras Receitas')
  }
  return String(item.descricaoOrigem ?? item.descricao ?? (item.processo ? `Processo ${item.processo}` : item.origem ?? 'Sem histórico/descrição'))
}

function sourceExistingAccount(type: SourceType, item: AnyRecord) {
  const code = String(type === 'expense' ? item.expenseAccountCode ?? item.classificacaoContabil ?? '' : item.revenueAccountCode ?? item.classificacaoContabil ?? '')
  if (!code) return null
  return officialChartOfAccounts.find((account) => account.code === code && account.kind === 'account' && (type !== 'expense' || account.dre !== 'Não mostrar no DRE Gerencial')) ?? null
}

function accountByText(category: 'Receita' | 'Despesa', fragment: string) {
  const needle = normalized(fragment)
  return officialChartOfAccounts.find((account) => account.kind === 'account' && account.category === category && account.dre !== 'Não mostrar no DRE Gerencial' && normalized(account.name).includes(needle)) ?? null
}

function suggestAccount(type: SourceType, item: AnyRecord, classifications: ClassificationRecord[]): Suggestion {
  const existing = sourceExistingAccount(type, item)
  if (existing) return { account: existing, confidence: 100, reason: 'Classificação já existente no lançamento' }

  const learned = learnedClassificationSuggestion({
    type,
    sourceId: item.id,
    counterparty: sourceCounterparty(type, item),
    description: sourceDescription(type, item),
    history: classifications,
  })
  if (learned) return learned

  if (type === 'revenue') {
    const origem = normalized(item.origem)
    const natureza = normalized(item.natureza)
    if (origem.includes('alvara') && natureza.includes('trabalh')) {
      const account = officialChartOfAccounts.find((row) => row.code === '3.01.04') ?? null
      return { account, confidence: account ? 98 : 0, reason: 'Alvará trabalhista reconhecido pelo tipo do recebimento' }
    }
    if (origem.includes('acordo') && natureza.includes('trabalh')) {
      const account = officialChartOfAccounts.find((row) => row.code === '3.01.05') ?? null
      return { account, confidence: account ? 98 : 0, reason: 'Acordo trabalhista reconhecido pelo tipo do recebimento' }
    }
    if (natureza.includes('civil')) {
      const account = officialChartOfAccounts.find((row) => row.code === '3.01.02') ?? null
      return { account, confidence: account ? 88 : 0, reason: 'Recebimento identificado como área cível' }
    }
  }

  const category = type === 'expense' ? 'Despesa' : 'Receita'
  const text = normalized(sourceDescription(type, item))
  const rules: Array<[string[], string]> = type === 'expense'
    ? [
        [['fgts'], 'fgts'],
        [['inss'], 'inss'],
        [['salario', 'folha', 'remuneracao'], 'salario'],
        [['plano de saude', 'assistencia medica'], 'plano de saude'],
        [['aluguel'], 'aluguel'],
        [['condominio'], 'condominio'],
        [['energia', 'light'], 'energia'],
        [['telefone', 'telefonia', 'tim', 'claro', 'vivo'], 'telefone'],
        [['internet'], 'internet'],
        [['estacionamento'], 'estacionamento'],
        [['software', 'sistema', 'assinatura'], 'software'],
        [['contador', 'contabilidade'], 'contab'],
        [['comissao'], 'comissao'],
        [['tarifa bancaria', 'tarifa'], 'tarifa'],
        [['imposto', 'darf', 'iss', 'irpj', 'csll', 'pis', 'cofins'], 'imposto'],
      ]
    : [
        [['honorario'], 'honorario'],
        [['rendimento', 'aplicacao'], 'rendimento'],
        [['ressarcimento'], 'ressarcimento'],
      ]

  for (const [needles, accountFragment] of rules) {
    if (!needles.some((needle) => text.includes(normalized(needle)))) continue
    const account = accountByText(category, accountFragment)
    if (account) return { account, confidence: 94, reason: `Correspondência automática por descrição: ${needles[0]}` }
  }

  const tokens = new Set(text.split(' ').filter((token) => token.length >= 4))
  let best: { account: ChartOfAccount; score: number } | null = null
  for (const account of officialChartOfAccounts) {
    if (account.kind !== 'account' || account.category !== category || (type === 'expense' && account.dre === 'Não mostrar no DRE Gerencial')) continue
    const accountTokens = normalized(account.name).split(' ').filter((token) => token.length >= 4)
    const score = accountTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0)
    if (score > (best?.score ?? 0)) best = { account, score }
  }
  if (best && best.score >= 2) return { account: best.account, confidence: Math.min(89, 68 + best.score * 7), reason: 'Correspondência por palavras do histórico' }
  if (best && best.score === 1) return { account: best.account, confidence: 58, reason: 'Correspondência parcial; requer revisão' }
  return { account: null, confidence: 0, reason: 'Sem correspondência suficiente' }
}

function useManagerialData() {
  const [expenses, setExpenses] = useState<AnyRecord[]>([])
  const [revenues, setRevenues] = useState<AnyRecord[]>([])
  const [classifications, setClassifications] = useState<ClassificationRecord[]>([])
  const [loadingParts, setLoadingParts] = useState(3)

  useEffect(() => {
    const done = () => setLoadingParts((value) => Math.max(0, value - 1))
    const offExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => { setExpenses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))); done() }, done)
    const offRevenues = onSnapshot(collection(db, 'receivables'), (snapshot) => { setRevenues(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))); done() }, done)
    const offClassifications = onSnapshot(collection(db, 'managerialClassifications'), (snapshot) => { setClassifications(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))); done() }, done)
    return () => { offExpenses(); offRevenues(); offClassifications() }
  }, [])

  return { expenses, revenues, classifications, loading: loadingParts > 0 }
}

function classificationKey(type: SourceType, sourceId: string) {
  return `${type}__${sourceId}`
}

export function DreGerencialPageV2() {
  const { profile } = useAuth()
  const { expenses, revenues, classifications, loading } = useManagerialData()
  const [tab, setTab] = useState<'classification' | 'dre'>('classification')
  const [classificationView, setClassificationView] = useState<'pending' | 'classified'>('pending')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | SourceType>('all')
  const [draftAccounts, setDraftAccounts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState('')
  const [dreCompetence, setDreCompetence] = useState('')
  const [dreUnit, setDreUnit] = useState('Todas')

  const classificationMap = useMemo(() => new Map(classifications.map((item) => [item.id, item])), [classifications])

  function validDreClassification(item: UnifiedLaunch) {
    if (!item.classification?.confirmed) return false
    if (!item.classification.accountCode || !item.classification.accountDre) return false
    if (item.sourceType === 'expense' && item.classification.accountDre === 'Não mostrar no DRE Gerencial') return false
    return true
  }
  const launches = useMemo<UnifiedLaunch[]>(() => {
    const expenseRows = expenses.filter((item) => EXPENSE_DRE_STATUSES.has(String(item.status ?? ''))).map((item) => {
      const date = String(Array.isArray(item.items) && item.items[0]?.data ? item.items[0].data : `${item.competencia || ''}-01`).slice(0, 10)
      return {
        key: classificationKey('expense', item.id), sourceType: 'expense' as const, sourceId: item.id, source: item,
        date, competence: String(item.competencia ?? date.slice(0, 7)), unit: String(item.unidade ?? 'RJ'),
        title: sourceCardTitle('expense', item), description: sourceCardDescription('expense', item), counterparty: sourceCounterparty('expense', item),
        amount: toNumber(item.valorTotal), status: String(item.status ?? ''), classification: classificationMap.get(classificationKey('expense', item.id)),
      }
    })
    const revenueRows = revenues.filter((item) => REVENUE_DRE_STATUSES.has(String(item.status ?? ''))).map((item) => {
      const date = String(item.receiptDate ?? item.data ?? '').slice(0, 10)
      return {
        key: classificationKey('revenue', item.id), sourceType: 'revenue' as const, sourceId: item.id, source: item,
        date, competence: date.slice(0, 7), unit: String(item.unidade ?? 'RJ'),
        title: sourceCardTitle('revenue', item), description: sourceCardDescription('revenue', item), counterparty: sourceCounterparty('revenue', item),
        amount: receivableManagementAmount(item), status: String(item.status ?? ''), classification: classificationMap.get(classificationKey('revenue', item.id)),
      }
    })
    return [...expenseRows, ...revenueRows].sort((a, b) => b.date.localeCompare(a.date))
  }, [expenses, revenues, classificationMap])

  const pendingCount = launches.filter((item) => !validDreClassification(item)).length
  const classifiedCount = launches.length - pendingCount
  const visibleClassificationRows = launches.filter((item) => {
    const isClassified = validDreClassification(item)
    if (classificationView === 'pending' ? isClassified : !isClassified) return false
    if (typeFilter !== 'all' && item.sourceType !== typeFilter) return false
    const haystack = normalized(`${item.title} ${item.description} ${item.counterparty} ${item.classification?.accountName ?? ''} ${item.classification?.accountCode ?? ''}`)
    return haystack.includes(normalized(search))
  })

  function selectedAccountCode(item: UnifiedLaunch, suggestion: Suggestion) {
    const currentCode = validDreClassification(item) ? item.classification?.accountCode : ''
    return draftAccounts[item.key] ?? currentCode ?? suggestion.account?.code ?? ''
  }

  async function confirmClassification(item: UnifiedLaunch, accountCode: string) {
    const account = officialChartOfAccounts.find((row) => row.code === accountCode && row.kind === 'account' && row.category === (item.sourceType === 'expense' ? 'Despesa' : 'Receita') && (item.sourceType !== 'expense' || row.dre !== 'Não mostrar no DRE Gerencial'))
    if (!account) { window.alert('Selecione uma conta válida do Plano de Contas.'); return }
    const suggestion = suggestAccount(item.sourceType, item.source, classifications)
    setSavingKey(item.key)
    try {
      await setDoc(doc(db, 'managerialClassifications', item.key), {
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceDate: item.date || null,
        sourceCompetence: item.competence || null,
        sourceUnit: item.unit || null,
        sourceTitle: item.title,
        sourceDescription: item.description,
        sourceCounterparty: item.counterparty,
        sourceAmount: item.amount,
        sourceStatus: item.status,
        accountCode: account.code,
        accountName: account.name,
        accountDre: account.dre,
        accountCategory: account.category,
        confirmed: true,
        suggestionConfidence: suggestion.account?.code === account.code ? suggestion.confidence : 0,
        suggestionReason: suggestion.account?.code === account.code ? suggestion.reason : 'Conta escolhida manualmente pelo usuário',
        confirmedBy: profile?.uid ?? null,
        confirmedByName: profile?.displayName ?? profile?.email ?? null,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      await addDoc(collection(db, 'auditLogs'), {
        action: item.classification?.confirmed ? 'Classificação gerencial alterada' : 'Classificação gerencial confirmada',
        module: 'DRE Gerencial',
        detail: `${item.sourceType === 'expense' ? 'Despesa' : 'Receita'} ${item.title} → ${account.code} - ${account.name}`,
        entityId: item.key,
        userId: profile?.uid ?? null,
        userName: profile?.displayName ?? null,
        userEmail: profile?.email ?? null,
        createdAt: serverTimestamp(),
      })
      setDraftAccounts((current) => { const next = { ...current }; delete next[item.key]; return next })
    } catch (error) {
      console.error(error)
      window.alert('Não foi possível salvar a classificação. Verifique sua permissão e tente novamente.')
    } finally {
      setSavingKey('')
    }
  }

  const dreRows = useMemo(() => launches.filter((item) => {
    if (!validDreClassification(item)) return false
    if (!item.classification?.accountDre || item.classification.accountDre === 'Não mostrar no DRE Gerencial') return false
    if (dreCompetence && item.competence !== dreCompetence) return false
    if (dreUnit !== 'Todas' && item.unit !== dreUnit) return false
    return item.sourceType === 'expense' ? EXPENSE_DRE_STATUSES.has(item.status) : REVENUE_DRE_STATUSES.has(item.status)
  }), [launches, dreCompetence, dreUnit])

  const dreGroups = useMemo(() => {
    const groups = new Map<string, { revenue: number; expense: number; count: number }>()
    for (const item of dreRows) {
      const label = item.classification?.accountDre || 'Outros'
      const current = groups.get(label) ?? { revenue: 0, expense: 0, count: 0 }
      if (item.sourceType === 'revenue') current.revenue += item.amount
      else current.expense += item.amount
      current.count += 1
      groups.set(label, current)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const ai = drePreferredOrder.indexOf(a); const bi = drePreferredOrder.indexOf(b)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      return a.localeCompare(b, 'pt-BR')
    })
  }, [dreRows])

  const totalRevenue = dreRows.filter((item) => item.sourceType === 'revenue').reduce((sum, item) => sum + item.amount, 0)
  const totalExpense = dreRows.filter((item) => item.sourceType === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const result = totalRevenue - totalExpense

  return <>
    <div className="page-heading"><div><span className="eyebrow">Financeiro Gerencial</span><h1>DRE Gerencial</h1><p>Classifique receitas e despesas pelo Plano de Contas e consolide automaticamente a visão gerencial do resultado.</p></div></div>

    <div className="dre-main-tabs" role="tablist">
      <button className={tab === 'classification' ? 'active' : ''} onClick={() => setTab('classification')}><CheckCircle2 size={17} /> Classificação de Lançamentos {pendingCount > 0 && <b>{pendingCount}</b>}</button>
      <button className={tab === 'dre' ? 'active' : ''} onClick={() => setTab('dre')}><BarChart3 size={17} /> DRE Gerencial</button>
    </div>

    {tab === 'classification' ? <section className="page-card dre-classification-card">
      <div className="dre-section-heading"><div><span className="eyebrow">Central de Classificação</span><h2>Receitas e Despesas</h2><p>Classificador híbrido adaptativo: regras + histórico confirmado. Cada confirmação ensina o sistema; a DRE continua recebendo somente lançamentos validados.</p></div><div className="dre-counter"><strong>{pendingCount}</strong><span>pendente(s)</span></div></div>

      <div className="dre-status-tabs">
        <button className={classificationView === 'pending' ? 'active' : ''} onClick={() => setClassificationView('pending')}><CircleAlert size={16} /> Pendentes <b>{pendingCount}</b></button>
        <button className={classificationView === 'classified' ? 'active' : ''} onClick={() => setClassificationView('classified')}><CheckCircle2 size={16} /> Classificados <b>{classifiedCount}</b></button>
      </div>

      <div className="dre-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar descrição, favorecido, processo ou conta" /></div><label className="dre-filter"><Filter size={16} /><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | SourceType)}><option value="all">Receitas e Despesas</option><option value="revenue">Somente Receitas</option><option value="expense">Somente Despesas</option></select><ChevronDown size={14} /></label></div>

      {loading ? <div className="module-empty"><RefreshCw className="spin" size={28} /><strong>Carregando lançamentos</strong></div> : visibleClassificationRows.length === 0 ? <div className="module-empty"><CheckCircle2 size={32} /><strong>{classificationView === 'pending' ? 'Nenhum lançamento pendente' : 'Nenhum lançamento classificado'}</strong><span>{classificationView === 'pending' ? 'Todos os lançamentos disponíveis já foram classificados.' : 'As classificações confirmadas aparecerão aqui.'}</span></div> : <div className="dre-classification-list">{visibleClassificationRows.map((item) => {
        const suggestion = suggestAccount(item.sourceType, item.source, classifications)
        const category = item.sourceType === 'expense' ? 'Despesa' : 'Receita'
        const accounts = officialChartOfAccounts.filter((row) => row.kind === 'account' && row.category === category && (item.sourceType !== 'expense' || row.dre !== 'Não mostrar no DRE Gerencial'))
        const accountCode = selectedAccountCode(item, suggestion)
        return <article className="dre-launch-row" key={item.key}>
          <div className="dre-launch-summary"><div className={`dre-type-badge ${item.sourceType}`}>{item.sourceType === 'expense' ? 'Despesa' : 'Receita'}</div><strong title={item.title}>{item.title}</strong><span title={item.description}>{truncateText(item.description || 'Sem descrição complementar')}</span><small>{readableDate(item.date)} · {item.unit} · {item.status || 'sem status'}</small></div>
          <div className="dre-launch-amount"><span>Valor gerencial</span><strong>{money.format(item.amount)}</strong>{item.sourceType === 'revenue' && <small>{item.source.tipoRecebimento === 'outras_receitas' ? 'Valor da receita' : 'Honorários do escritório'}</small>}</div>
          <div className="dre-account-choice">
            {suggestion.account && !item.classification?.confirmed && <div className={`dre-suggestion confidence-${suggestion.confidence >= 90 ? 'high' : suggestion.confidence >= 60 ? 'medium' : 'low'}`}><Sparkles size={14} /><span>Sugestão {suggestion.confidence}% · {suggestion.reason}</span></div>}
            <label><span>Conta gerencial</span><select value={accountCode} onChange={(event) => setDraftAccounts((current) => ({ ...current, [item.key]: event.target.value }))}><option value="">Selecione a conta...</option>{accounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}</select></label>
            {item.classification?.accountDre && <small className="dre-destination">DRE: {item.classification.accountDre}</small>}
          </div>
          <button className="dre-confirm-button" disabled={!accountCode || savingKey === item.key} onClick={() => void confirmClassification(item, accountCode)}>{savingKey === item.key ? <RefreshCw className="spin" size={16} /> : <CheckCircle2 size={16} />}{item.classification?.confirmed ? 'Alterar classificação' : 'Confirmar'}</button>
        </article>
      })}</div>}
    </section> : <>
      <section className="page-card dre-report-card">
        <div className="dre-section-heading"><div><span className="eyebrow">Demonstrativo Gerencial</span><h2>Resultado do Período</h2><p>Somente lançamentos classificados e em status financeiro válido entram nesta visão.</p></div></div>
        <div className="dre-report-filters"><label><span>Competência</span><input type="month" value={dreCompetence} onChange={(event) => setDreCompetence(event.target.value)} /><small>{dreCompetence ? 'Filtrando somente a competência selecionada' : 'Todo o período'}</small></label><label><span>Unidade</span><select value={dreUnit} onChange={(event) => setDreUnit(event.target.value)}><option>Todas</option><option>RJ</option><option>SP</option></select></label></div>
        <div className="dre-kpis"><div><span>Receitas</span><strong>{money.format(totalRevenue)}</strong></div><div><span>Despesas</span><strong>{money.format(totalExpense)}</strong></div><div className={result >= 0 ? 'positive' : 'negative'}><span>Resultado Gerencial</span><strong>{money.format(result)}</strong></div><div><span>Lançamentos na DRE</span><strong>{dreRows.length}</strong></div></div>

        <div className="dre-statement"><div className="dre-statement-row head"><span>Grupo DRE</span><span>Lançamentos</span><span>Valor</span></div>{dreGroups.length === 0 ? <div className="dre-empty-statement">Nenhum lançamento classificado para os filtros selecionados.</div> : dreGroups.map(([label, values]) => {
          const isExpense = values.expense > 0 && values.revenue === 0
          const net = values.revenue - values.expense
          return <div className={`dre-statement-row ${isExpense ? 'expense' : 'revenue'}`} key={label}><span>{label}</span><span>{values.count}</span><strong>{isExpense ? `(${money.format(values.expense)})` : money.format(net)}</strong></div>
        })}<div className="dre-statement-row total"><span>RESULTADO GERENCIAL</span><span>{dreRows.length}</span><strong>{money.format(result)}</strong></div></div>
      </section>
    </>}
  </>
}
