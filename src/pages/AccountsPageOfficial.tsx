import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenCheck, Download, FileText, RefreshCw, Search, ShieldCheck, Upload, X } from 'lucide-react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, writeBatch, type DocumentData } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import {
  OFFICIAL_CHART_OF_ACCOUNTS_SOURCE,
  OFFICIAL_CHART_OF_ACCOUNTS_VERSION,
  officialChartOfAccounts,
  categoryFromCode,
  storedToChart,
  type ChartOfAccount,
} from '../data/chartOfAccounts'

type StoredAccount = { id: string } & DocumentData
type Filter = 'Todos' | 'Receita' | 'Despesa' | 'Patrimonial / Dívida'
type ImportPreview = { fileName: string; accounts: ChartOfAccount[] }

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function parseTxt(text: string): ChartOfAccount[] {
  const rows: Array<{ code: string; name: string; dre: string | null }> = []
  const seen = new Set<string>()
  let current: { code: string; name: string; dre: string | null } | null = null

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim().replace(/^`+|`+$/g, '')
    const match = line.match(/^(\d+(?:\.\d+)+)\s*-\s*(.+)$/)
    if (match) {
      const code = match[1].trim()
      const name = match[2].trim()
      if (seen.has(code)) throw new Error(`Código duplicado no TXT: ${code}`)
      seen.add(code)
      current = { code, name, dre: null }
      rows.push(current)
      continue
    }
    const dre = line.match(/^DRE\s*:\s*(.+)$/i)
    if (dre && current) current.dre = dre[1].trim()
  }

  if (rows.length < 10) throw new Error('O TXT não contém um Plano de Contas válido ou está incompleto.')

  const codeSet = new Set(rows.map((item) => item.code))
  return rows.map((item): ChartOfAccount => {
    const parts = item.code.split('.')
    let parentCode: string | null = null
    for (let size = parts.length - 1; size >= 2; size -= 1) {
      const candidate = parts.slice(0, size).join('.')
      if (codeSet.has(candidate)) { parentCode = candidate; break }
    }
    const kind: ChartOfAccount['kind'] = rows.some((candidate) => candidate.code.startsWith(`${item.code}.`)) ? 'group' : 'account'
    return {
      code: item.code,
      name: item.name,
      dre: item.dre,
      parentCode,
      level: parts.length,
      kind,
      category: categoryFromCode(item.code),
    }
  }).sort((a, b) => collator.compare(a.code, b.code))
}

function txtFromPlan(plan: ChartOfAccount[]) {
  const ordered = [...plan].sort((a, b) => collator.compare(a.code, b.code))
  const lines = [
    '# Classificação opcional',
    '',
    '# Plano de Contas',
    '',
    'Plano hierárquico interno para classificação de despesas e componentes de recebimentos. A classificação não bloqueia o fluxo.',
    '',
    '# INSTRUÇÃO: você pode corrigir nomes e classificações DRE neste TXT e depois usar “Fazer upload do TXT” no sistema.',
    '# Mantenha cada conta no formato: CÓDIGO - NOME. Quando houver DRE, deixe a linha DRE: logo abaixo da conta.',
    '',
  ]
  ordered.forEach((item) => {
    lines.push(`${item.code} - ${item.name}`)
    if (item.dre) lines.push(`DRE: ${item.dre}`)
    if (item.kind === 'group') lines.push('')
  })
  return `${lines.join('\n').trim()}\n`
}

export function AccountsPageOfficial() {
  const { profile } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [records, setRecords] = useState<StoredAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('Todos')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const canManage = profile?.role === 'master' || profile?.role === 'admin'

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'chartOfAccounts'), (snapshot) => {
      setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return unsubscribe
  }, [])

  const storedPlan = useMemo(() => records.map(storedToChart).filter((item): item is ChartOfAccount => Boolean(item)).sort((a, b) => collator.compare(a.code, b.code)), [records])
  const activePlan = storedPlan.length ? storedPlan : officialChartOfAccounts
  const officialCodes = useMemo(() => new Set(officialChartOfAccounts.map((item) => item.code)), [])
  const storedOfficialCount = useMemo(() => records.filter((item) => officialCodes.has(String(item.code ?? ''))).length, [records, officialCodes])
  const synchronized = storedOfficialCount === officialChartOfAccounts.length && records.length === officialChartOfAccounts.length

  const visible = useMemo(() => {
    const needle = normalized(search.trim())
    return activePlan.filter((item) => {
      const categoryOk = filter === 'Todos' || item.category === filter
      const textOk = !needle || normalized(`${item.code} ${item.name} ${item.dre ?? ''}`).includes(needle)
      return categoryOk && textOk
    })
  }, [activePlan, search, filter])

  const counts = useMemo(() => ({
    groups: activePlan.filter((item) => item.kind === 'group').length,
    accounts: activePlan.filter((item) => item.kind === 'account').length,
    revenues: activePlan.filter((item) => item.kind === 'account' && item.category === 'Receita').length,
    expenses: activePlan.filter((item) => item.kind === 'account' && item.category === 'Despesa').length,
    patrimonial: activePlan.filter((item) => item.kind === 'account' && item.category === 'Patrimonial / Dívida').length,
  }), [activePlan])

  async function replacePlan(plan: ChartOfAccount[], source: string) {
    if (!canManage) return
    setSyncing(true)
    setMessage('')
    try {
      for (let start = 0; start < records.length; start += 400) {
        const batch = writeBatch(db)
        records.slice(start, start + 400).forEach((item) => batch.delete(doc(db, 'chartOfAccounts', item.id)))
        await batch.commit()
      }
      for (let start = 0; start < plan.length; start += 400) {
        const batch = writeBatch(db)
        plan.slice(start, start + 400).forEach((item) => {
          const ref = doc(db, 'chartOfAccounts', item.code.replaceAll('.', '_'))
          batch.set(ref, {
            ...item,
            active: true,
            source,
            version: new Date().toISOString().slice(0, 10),
            updatedAt: serverTimestamp(),
            updatedBy: profile?.uid ?? null,
            updatedByName: profile?.displayName ?? null,
          })
        })
        await batch.commit()
      }
      await addDoc(collection(db, 'auditLogs'), {
        action: source === OFFICIAL_CHART_OF_ACCOUNTS_SOURCE ? 'Plano de contas oficial sincronizado' : 'Plano de contas atualizado por upload TXT',
        module: 'Plano de Contas',
        detail: `${plan.length} códigos · fonte: ${source}`,
        userId: profile?.uid ?? null,
        userName: profile?.displayName ?? null,
        userEmail: profile?.email ?? null,
        createdAt: serverTimestamp(),
      })
      setMessage(`Plano de Contas atualizado com sucesso: ${plan.length} códigos.`)
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível atualizar o Plano de Contas. Confira sua permissão e tente novamente.')
    } finally {
      setSyncing(false)
      setImportPreview(null)
    }
  }

  async function replaceFirestorePlan() {
    await replacePlan(officialChartOfAccounts, OFFICIAL_CHART_OF_ACCOUNTS_SOURCE)
  }

  function downloadTxt() {
    if (!canManage) return
    const blob = new Blob([txtFromPlan(activePlan)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'Plano_de_Contas_Flavio_Marques.txt'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setMessage('TXT do Plano de Contas baixado. Você pode corrigir o arquivo e fazer upload novamente.')
  }

  async function loadTxt(file: File) {
    try {
      const text = await file.text()
      const accounts = parseTxt(text)
      setImportPreview({ fileName: file.name, accounts })
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível ler o TXT.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function tone(item: ChartOfAccount) {
    if (item.category === 'Receita') return 'account-revenue'
    if (item.category === 'Despesa') return 'account-expense'
    return 'account-patrimonial'
  }

  const previewCounts = importPreview ? {
    revenue: importPreview.accounts.filter((item) => item.kind === 'account' && item.category === 'Receita').length,
    expense: importPreview.accounts.filter((item) => item.kind === 'account' && item.category === 'Despesa').length,
    patrimonial: importPreview.accounts.filter((item) => item.kind === 'account' && item.category === 'Patrimonial / Dívida').length,
  } : null

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Classificação opcional</span>
          <h1>Plano de Contas</h1>
          <p>Plano hierárquico interno para classificação de despesas e componentes de recebimentos. A classificação não bloqueia o fluxo.</p>
        </div>
        {canManage && <div className="quick-actions account-admin-actions">
          <button className="secondary-button" type="button" onClick={downloadTxt}><Download size={17} /> Baixar TXT</button>
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={syncing}><Upload size={17} /> Fazer upload do TXT</button>
          <button className="secondary-button" type="button" onClick={replaceFirestorePlan} disabled={syncing}>{syncing ? <RefreshCw className="spin" size={17} /> : <BookOpenCheck size={17} />} Restaurar plano oficial</button>
          <input ref={inputRef} className="hidden-file-input" type="file" accept=".txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadTxt(file) }} />
        </div>}
      </div>

      {canManage && <section className="page-card txt-admin-box"><FileText size={22} /><div><h2>Manutenção por TXT — somente Administrador</h2><p>Baixe o mesmo plano usado pelo sistema, corrija códigos, nomes ou DRE no arquivo e faça o upload. Após a confirmação, o Firestore e os seletores de Despesas/Receitas passam a usar a versão enviada.</p></div></section>}

      <div className="accounts-summary-grid">
        <article><span>Códigos totais</span><strong>{activePlan.length}</strong><small>{counts.groups} grupos + {counts.accounts} contas finais</small></article>
        <article className="account-revenue"><span>Contas de receita</span><strong>{counts.revenues}</strong><small>Códigos 3.xx</small></article>
        <article className="account-expense"><span>Contas de despesa</span><strong>{counts.expenses}</strong><small>Códigos 4.xx</small></article>
        <article className="account-patrimonial"><span>Patrimonial / Dívidas</span><strong>{counts.patrimonial}</strong><small>Códigos 5.xx</small></article>
      </div>

      <section className="page-card official-plan-info">
        <div><ShieldCheck size={20} /><span><strong>Fonte ativa:</strong> {records[0]?.source ? String(records[0].source) : `${OFFICIAL_CHART_OF_ACCOUNTS_SOURCE} · versão ${OFFICIAL_CHART_OF_ACCOUNTS_VERSION}`}</span></div>
        <div><strong>Firestore:</strong> {loading ? 'verificando...' : storedPlan.length ? `${storedPlan.length} código(s) carregado(s)` : 'sem registros; usando a versão oficial embutida'}</div>
        <div><strong>Base oficial original:</strong> {synchronized ? 'coincide integralmente com os 197 códigos oficiais' : 'pode conter ajustes enviados pelo administrador'}</div>
        {message && <div className="account-plan-message">{message}</div>}
      </section>

      <section className="page-card module-card official-accounts-card">
        <div className="module-toolbar accounts-toolbar">
          <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, conta ou classificação DRE" /></div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option>Todos</option><option>Receita</option><option>Despesa</option><option>Patrimonial / Dívida</option></select>
        </div>
        <div className="official-accounts-table">
          <div className="official-account-row official-account-head"><span>Código</span><span>Conta</span><span>Categoria</span><span>DRE</span></div>
          {visible.map((item) => <div className={`official-account-row ${item.kind === 'group' ? 'official-group-row' : ''}`} key={item.code}>
            <span className="account-code" style={{ paddingLeft: `${Math.max(0, item.level - 2) * 16}px` }}>{item.code}</span>
            <span><strong>{item.name}</strong>{item.parentCode && <small>Grupo: {item.parentCode}</small>}</span>
            <span><b className={`account-category ${tone(item)}`}>{item.category}</b></span>
            <span>{item.dre ?? (item.kind === 'group' ? 'Grupo / Subgrupo' : '—')}</span>
          </div>)}
        </div>
      </section>

      {importPreview && previewCounts && <div className="modal-backdrop"><section className="account-import-modal" role="dialog" aria-modal="true">
        <div className="modal-toolbar"><div><span className="eyebrow">Administrador</span><h2>Confirmar upload do Plano de Contas</h2></div><button className="icon-button" type="button" onClick={() => setImportPreview(null)}><X size={20} /></button></div>
        <p>Arquivo: <strong>{importPreview.fileName}</strong></p>
        <div className="import-preview-grid"><div><span>Códigos</span><strong>{importPreview.accounts.length}</strong></div><div><span>Receitas</span><strong>{previewCounts.revenue}</strong></div><div><span>Despesas</span><strong>{previewCounts.expense}</strong></div><div><span>Patrimonial</span><strong>{previewCounts.patrimonial}</strong></div></div>
        <div className="import-warning"><ShieldCheck size={19} /><span>Ao confirmar, este TXT substituirá o Plano de Contas atualmente salvo no Firestore. Os lançamentos antigos não são apagados.</span></div>
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setImportPreview(null)}>Cancelar</button><button className="revenue-button" type="button" disabled={syncing} onClick={() => void replacePlan(importPreview.accounts, `TXT: ${importPreview.fileName}`)}>{syncing ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />} Confirmar upload</button></div>
      </section></div>}
    </>
  )
}
