import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore'
import { RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { db } from '../lib/firebase'

type AuditRecord = { id: string } & DocumentData

const dateTimeBR = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function timestampToDateTime(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return dateTimeBR.format((value as { toDate: () => Date }).toDate())
  }
  return '—'
}

function moduleTone(module: string) {
  const value = module.toLowerCase()
  if (value.includes('repasse') || value.includes('recebimento') || value.includes('tesouraria')) return 'revenue'
  if (value.includes('comiss')) return 'warning'
  if (value.includes('aprova') || value.includes('despesa')) return 'expense'
  return 'neutral'
}

export function AuditPageEnhancedV2() {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('Todos')

  useEffect(() => onSnapshot(collection(db, 'auditLogs'), (snapshot) => {
    setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    setLoading(false)
  }, () => setLoading(false)), [])

  const ordered = useMemo(() => [...records].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)), [records])
  const modules = useMemo(() => ['Todos', ...Array.from(new Set(ordered.map((item) => String(item.module || 'Sistema')))).sort()], [ordered])
  const filtered = useMemo(() => ordered.filter((item) => {
    const matchesModule = moduleFilter === 'Todos' || String(item.module || 'Sistema') === moduleFilter
    const haystack = `${item.action ?? ''} ${item.module ?? ''} ${item.detail ?? ''} ${item.userName ?? ''} ${item.userEmail ?? ''}`.toLowerCase()
    return matchesModule && haystack.includes(search.trim().toLowerCase())
  }), [moduleFilter, ordered, search])

  return <>
    <div className="page-heading"><div><span className="eyebrow">Rastreabilidade financeira</span><h1>Auditoria</h1><p>Histórico visível de quem criou, enviou, confirmou, aprovou e executou operações financeiras do sistema.</p></div></div>

    <section className="page-card audit-explainer">
      <ShieldCheck size={24} />
      <div><strong>Regra do fluxo de Alvarás</strong><span>Regra 1 — Recebimento do Alvará: NÃO passa pela fila de Aprovações; a Tesouraria confirma diretamente o crédito. Regra 2 — Repasse de Alvarás: PASSA pela fila central de Aprovações, assim como Despesas, Comissões de Agentes e Repasse Societário. Após a aprovação, a Tesouraria registra o pagamento efetivo de cada parcela. A Auditoria registra as ações realizadas em cada etapa.</span></div>
    </section>

    <section className="page-card module-card audit-card">
      <div className="module-toolbar audit-toolbar">
        <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ação, processo, usuário, e-mail ou detalhe" /></div>
        <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>{modules.map((module) => <option key={module}>{module}</option>)}</select>
      </div>
      {loading ? <div className="module-empty"><RefreshCw className="spin" size={30} /><strong>Carregando auditoria</strong></div> : filtered.length === 0 ? <div className="module-empty"><ShieldCheck size={34} /><strong>Nenhum evento encontrado</strong><span>Ajuste os filtros ou execute uma nova operação.</span></div> : <div className="audit-list enhanced-audit-list">{filtered.map((item) => <article key={item.id}><div className="audit-dot" /><div className="audit-main"><div className="audit-heading"><strong>{item.action || 'Evento do sistema'}</strong><span className={`status-badge ${moduleTone(String(item.module || 'Sistema'))}`}>{item.module || 'Sistema'}</span></div><span>{item.detail || 'Sem detalhe adicional'}</span><small>{item.userName || 'Sistema'}{item.userEmail ? ` · ${item.userEmail}` : ''} · {timestampToDateTime(item.createdAt)}</small></div></article>)}</div>}
    </section>
  </>
}
