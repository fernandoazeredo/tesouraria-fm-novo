import { useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Sparkles, Send, ShieldCheck, LoaderCircle, ExternalLink, CheckCircle2, XCircle, Undo2, PencilLine, Eraser, Copy, Check, ClipboardPaste } from 'lucide-react'
import { firebaseApp } from '../lib/firebase'
import './ExecutiveAiPage.css'
import { AiMarkdown } from './ExecutiveAiMarkdown'

type DiffRow = { field: string; before: unknown; after: unknown }
type ClassItem = { tipo: string; titulo: string; descricao?: string; competencia?: string | null; unidade?: string; valor: number; antes: string }
type Proposal = { id: string; kind?: 'campos' | 'classificacao' | 'exclusao'; avisos?: string[]; modulo: string; collection?: string; docId?: string; summary: string; diff?: DiffRow[]; conta?: string; grupo?: string; itens?: Array<ClassItem & { label?: string; value?: string }>; total?: number; expiresAtMs: number }
type FinancialDetail = { date: string; title: string; unit: string; category: string; value: number }
type AiResponse = {
  answer: string
  sources: Array<{ modulo: string; caminho: string; parcial: boolean; registros: number }>
  consultedAt: string
  disclaimer: string
  proposal?: Proposal
  details?: FinancialDetail[]
}
type ProposalState = 'pendente' | 'aplicada' | 'cancelada' | 'desfeita'
type Message = { role: 'user' | 'assistant'; text: string; response?: AiResponse; proposalState?: ProposalState; note?: string }

const fns = getFunctions(firebaseApp, 'southamerica-east1')
const queryAi = httpsCallable<{ question: string }, AiResponse>(fns, 'executiveAiAsk', { timeout: 180000 })
// Confirmar/Cancelar/Desfazer usam a mesma função pública e autenticada (ação explícita).
const actionAi = httpsCallable<{ action: 'apply' | 'undo' | 'cancel'; proposalId: string; confirmText?: string }, { ok: boolean; message: string }>(fns, 'executiveAiAsk', { timeout: 120000 })
const applyAi = (d: { proposalId: string; confirmText?: string }) => actionAi({ action: 'apply', ...d })
const undoAi = (d: { proposalId: string }) => actionAi({ action: 'undo', ...d })
const cancelAi = (d: { proposalId: string }) => actionAi({ action: 'cancel', ...d })

const FIELD_LABELS: Record<string, string> = {
  valorTotal: 'Valor total', value: 'Valor', amount: 'Valor', amountDue: 'Valor devido', netAmountDue: 'Valor líquido', transferValue: 'Valor do repasse',
  status: 'Status', competencia: 'Competência', fornecedor: 'Fornecedor', favorecido: 'Favorecido', descricao: 'Descrição', description: 'Descrição',
  descricaoOrigem: 'Descrição', categoria: 'Categoria', unidade: 'Unidade', processo: 'Processo', paymentDate: 'Data de pagamento', dueDate: 'Vencimento',
  receiptDate: 'Data de recebimento', data: 'Data', percent: 'Percentual', beneficiary: 'Beneficiário', accountCode: 'Conta gerencial', observacao: 'Observação', obs: 'Observação',
}
const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho', enviado_aprovacao: 'Aguardando aprovação', aguardando_aprovacao: 'Aguardando aprovação', em_analise: 'Em análise', aprovado: 'Aprovado',
  enviado_tesouraria: 'Aguardando Tesouraria', confirmado: 'Recebido', recebido: 'Recebido', pago: 'Pago', paga: 'Pago', devolvido: 'Devolvido para correção', rejeitado: 'Rejeitado', arquivado: 'Arquivado',
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
function fieldLabel(f: string) {
  return FIELD_LABELS[f] || f.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}
function fmt(v: unknown) {
  if (typeof v === 'string' && STATUS_LABELS[v]) return STATUS_LABELS[v]
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  return String(v)
}
function errorText(err: unknown, fallback: string) {
  const code = (err as { code?: string })?.code || ''
  const description = (err as Error)?.message || fallback
  return /not-found|unavailable|internal/.test(code) && !/Proposta|Lançamento|Alteração/.test(description) ? 'O serviço seguro de IA ainda não está disponível. Nenhum lançamento foi alterado.' : description
}

function FinancialDetails({ rows }: { rows: FinancialDetail[] }) {
  const [page, setPage] = useState(0)
  const pageSize = 25
  const pages = Math.ceil(rows.length / pageSize)
  const first = page * pageSize
  return <details className="executive-ai-financial">
    <summary>Ver {rows.length.toLocaleString('pt-BR')} lançamento(s)</summary>
    <div className="executive-ai-proposal-scroll">
      <table><thead><tr><th>Data</th><th>Lançamento</th><th>Unidade</th><th>Categoria</th><th>Valor</th></tr></thead>
        <tbody>{rows.slice(first, first + pageSize).map((row, i) => <tr key={first + i}>
          <td>{row.date}</td><td>{row.title}</td><td>{row.unit}</td><td>{row.category}</td><td>{money.format(row.value)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="executive-ai-financial-pages">
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
      <span aria-live="polite">{first + 1}–{Math.min(first + pageSize, rows.length)} de {rows.length}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
    </div>}
  </details>
}

export function ExecutiveAiPage() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [copied, setCopied] = useState<number | null>(null)
  async function copyBubble(index: number, event: MouseEvent<HTMLButtonElement>) {
    const src = event.currentTarget.closest('article')?.querySelector('.executive-ai-copy-src') as HTMLElement | null
    const text = (src?.innerText || messages[index]?.text || '').trim()
    try { await navigator.clipboard.writeText(text) } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
    }
    setCopied(index); window.setTimeout(() => setCopied(c => c === index ? null : c), 1600)
  }
  async function pasteQuestion() {
    try { const t = await navigator.clipboard.readText(); if (t) setQuestion(prev => (prev ? prev + ' ' : '') + t.slice(0, 500 - prev.length)) } catch { setError('Use Ctrl+V para colar (o navegador bloqueou o acesso à área de transferência).') }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  function patch(index: number, data: Partial<Message>) {
    setMessages(prev => prev.map((m, i) => i === index ? { ...m, ...data } : m))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const q = question.trim()
    if (busy || q.length < 5 || q.length > 500) return
    setBusy(true); setQuestion(''); setError('')
    setMessages(prev => [...prev, { role: 'user', text: q }])
    try {
      const result = await queryAi({ question: q })
      setMessages(prev => [...prev, { role: 'assistant', text: result.data.answer, response: result.data, proposalState: result.data.proposal ? 'pendente' : undefined }])
    } catch (err) {
      setError(errorText(err, 'Não foi possível consultar a IA.'))
    } finally { setBusy(false) }
  }

  async function act(index: number, kind: 'apply' | 'cancel' | 'undo') {
    const proposal = messages[index]?.response?.proposal
    if (!proposal || busy) return
    let confirmText: string | undefined
    if (kind === 'apply' && proposal.kind === 'exclusao') {
      const typed = window.prompt(`EXCLUSÃO de lançamento em ${proposal.modulo}.\n\nPara confirmar, digite EXCLUIR:`)
      if ((typed ?? '').trim().toUpperCase() !== 'EXCLUIR') { if (typed !== null) setError('Exclusão não confirmada: é preciso digitar EXCLUIR.'); return }
      confirmText = 'EXCLUIR'
    } else if (kind === 'apply' && !window.confirm(proposal.kind === 'classificacao' ? `Confirmar a classificação de ${proposal.itens?.length ?? 0} lançamento(s) em ${proposal.conta}?` : `Confirmar a alteração em ${proposal.modulo}?`)) return
    setBusy(true); setError('')
    try {
      if (kind === 'apply') { const r = await applyAi({ proposalId: proposal.id, confirmText }); patch(index, { proposalState: 'aplicada', note: r.data.message }) }
      if (kind === 'cancel') { await cancelAi({ proposalId: proposal.id }); patch(index, { proposalState: 'cancelada', note: 'Proposta cancelada. Nada foi alterado.' }) }
      if (kind === 'undo') { const r = await undoAi({ proposalId: proposal.id }); patch(index, { proposalState: 'desfeita', note: r.data.message }) }
    } catch (err) {
      setError(errorText(err, 'Não foi possível concluir a ação.'))
    } finally { setBusy(false) }
  }

  const promptGroups: Array<{ title: string; items: string[] }> = [
    { title: 'Resumo e situação financeira', items: ['Resumo completo de hoje', 'Resumo completo desta semana', 'Resumo completo deste mês', 'O que está pendente?', 'O que está pendente para mim?', 'Pendências da Tesouraria', 'Pendências do Jurídico', 'Faça um resumo geral do escritório', 'Qual a situação financeira de hoje?', 'Qual a situação financeira desta semana?', 'Qual a situação financeira deste mês?', 'O que está pendente de decisão hoje?'] },
    { title: 'Gastos e resultado por conta (Plano de Contas / DRE)', items: ['Quanto gastamos com telefone em 2026?', 'Quanto gastamos com energia elétrica em 2026 e 2025?', 'Quais foram as maiores despesas por conta este ano?', 'Quanto gastamos por mês este ano?', 'Quanto gastamos em Despesas Administrativas este ano?', 'Qual o resultado da DRE este ano?', 'Quantos lançamentos estão sem classificação na DRE este ano?'] },
    { title: 'Receitas por tipo e período', items: ['Quanto recebemos de acordos e alvarás trabalhistas em 2026?', 'Quanto recebemos de alvarás trabalhistas em 2026?', 'Quanto recebemos de acordos trabalhistas em 2026?', 'Quanto recebemos por mês este ano?', 'Quanto recebemos de honorários este ano?', 'Quanto recebemos ano passado?'] },
    { title: 'Por dia e por semana', items: ['O que foi pago hoje?', 'O que foi lançado ontem?', 'O que foi recebido esta semana?', 'O que foi pago na semana passada?'] },
    { title: 'Pedidos de alteração e classificação (com sua confirmação)', items: ['Classifique as despesas de conta de luz deste mês como Energia Elétrica', 'Classifique as despesas de telefone celular de 2026 como Telefonia Móvel', 'Altere o valor da despesa do fornecedor X para 200', 'Exclua a despesa do fornecedor X de R$ 100,00'] },
    { title: 'Despesas', items: ['Quais despesas estão aguardando aprovação?', 'Quais despesas foram pagas este mês?', 'Quais despesas foram devolvidas ou rejeitadas?'] },
    { title: 'Receitas e Tesouraria', items: ['Quais receitas estão aguardando a Tesouraria?', 'Quais receitas foram confirmadas este mês?', 'Quais receitas foram devolvidas para correção?'] },
    { title: 'Aprovações', items: ['O que está na fila de Aprovações?', 'Qual o valor total aguardando aprovação?', 'Qual foi o valor aprovado hoje?', 'Quanto falta aprovar hoje?', 'Qual o valor aprovado este mês?', 'O que foi devolvido ou rejeitado hoje?'] },
    { title: 'Repasses e Comissões', items: ['Quais comissões estão pendentes?', 'Quais repasses de alvará estão a pagar?', 'Como está o Repasse Societário do mês?'] },
    { title: 'Nota Fiscal, Contabilidade e DRE', items: ['Quais notas fiscais estão pendentes?', 'Quais envios à Contabilidade foram feitos?', 'Como funciona a DRE Gerencial?'] },
    { title: 'Banco e Auditoria', items: ['Há movimentos bancários não conciliados?', 'Como funciona a Conciliação Bancária?', 'Quais foram as últimas ações na Auditoria?'] },
  ]
  return <section className="page-card executive-ai">
    <header className="executive-ai-head"><Sparkles size={27} /><div><span className="eyebrow">Exclusivo do Master principal</span><h1>IA — Assistente Executivo</h1><p>Consulte os módulos e os lançamentos do Tesouraria FM Novo. Para alterar ou classificar lançamentos, peça expressamente (ex.: “classifique as despesas de luz de outubro como Energia Elétrica”) e confirme.</p></div></header>
    <div className="executive-ai-security"><ShieldCheck size={17} /> Uso privado. Nenhuma alteração é gravada sem a sua confirmação; tudo vai para a Auditoria e pode ser desfeito. Os totais de despesas na DRE e de receitas por recebimento consideram todos os registros que atendem ao pedido. Exclusão de Despesas e Receitas só com pedido expresso, digitando EXCLUIR, com registro na Auditoria e opção de desfazer. Ela não altera usuários, permissões, CPF/CNPJ ou dados bancários.</div>
    <div className="executive-ai-messages" aria-live="polite">
      {messages.length === 0 && <div className="executive-ai-welcome"><Sparkles size={32} /><strong>O que deseja consultar ou ajustar?</strong><p>Pesquise informações, processos, valores, status, regras e pendências nos módulos do sistema.</p><div className="executive-ai-groups">{promptGroups.map(g => <div key={g.title} className="executive-ai-group"><span>{g.title}</span><div className="executive-ai-prompts">{g.items.map(p => <button key={p} type="button" disabled={busy} onClick={() => setQuestion(p)}>{p}</button>)}</div></div>)}</div></div>}
      {messages.map((msg, i) => <article key={i} className={`executive-ai-bubble ${msg.role}`}>
        <div className="executive-ai-bubble-head"><strong>{msg.role === 'assistant' ? 'IA' : 'Você'}</strong><button type="button" className="executive-ai-copy" title={copied === i ? 'Copiado!' : 'Copiar'} aria-label="Copiar texto" onClick={e => void copyBubble(i, e)}>{copied === i ? <Check size={15} /> : <Copy size={15} />}</button></div><div className="executive-ai-copy-src">{msg.role === 'assistant' ? <AiMarkdown text={msg.text} /> : <p>{msg.text}</p>}</div>
        {!!msg.response?.details?.length && <FinancialDetails rows={msg.response.details} />}
        {msg.response?.proposal && <div className={`executive-ai-proposal ${msg.proposalState}`}>
          {msg.response.proposal.kind === 'exclusao' ? <>
            <div className="executive-ai-proposal-head executive-ai-proposal-delete"><XCircle size={16} /> Exclusão proposta · {msg.response.proposal.modulo}</div>
            <table><tbody>{(msg.response.proposal.itens ?? []).filter(r => r.label !== 'Módulo').map(r => <tr key={r.label}><td>{r.label}</td><td><b>{r.value}</b></td></tr>)}</tbody></table>
            {!!msg.response.proposal.avisos?.length && <ul className="executive-ai-proposal-warnings">{msg.response.proposal.avisos.map(a => <li key={a}>⚠ {a}</li>)}</ul>}
          </> : msg.response.proposal.kind === 'classificacao' ? <>
            <div className="executive-ai-proposal-head"><PencilLine size={16} /> Classificação proposta · {msg.response.proposal.itens?.length ?? 0} lançamento(s) · {money.format(msg.response.proposal.total ?? 0)}</div>
            <p className="executive-ai-proposal-account">Nova conta: <b>{msg.response.proposal.conta}</b>{msg.response.proposal.grupo ? <> · Grupo da DRE: <b>{msg.response.proposal.grupo}</b></> : null}</p>
            <div className="executive-ai-proposal-scroll"><table><thead><tr><th>Tipo</th><th>Lançamento</th><th>Competência</th><th>Unid.</th><th>Valor</th><th>Classificação atual</th></tr></thead><tbody>{(msg.response.proposal.itens ?? []).map((it, k) => <tr key={k}><td>{it.tipo}</td><td><b>{it.titulo}</b>{it.descricao ? <small className="executive-ai-proposal-desc">{it.descricao}</small> : null}</td><td>{it.competencia || '—'}</td><td>{it.unidade || '—'}</td><td>{money.format(it.valor || 0)}</td><td>{it.antes}</td></tr>)}</tbody></table></div>
          </> : <>
            <div className="executive-ai-proposal-head"><PencilLine size={16} /> Alteração proposta · {msg.response.proposal.modulo}</div>
            <table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>{(msg.response.proposal.diff ?? []).map(d => <tr key={d.field}><td>{fieldLabel(d.field)}</td><td>{fmt(d.before)}</td><td><b>{fmt(d.after)}</b></td></tr>)}</tbody></table>
          </>}
          {msg.proposalState === 'pendente' && <div className="executive-ai-proposal-actions"><button type="button" className="small-success-button" disabled={busy} onClick={() => void act(i, 'apply')}><CheckCircle2 size={15} /> {msg.response.proposal.kind === 'exclusao' ? 'Confirmar exclusão' : msg.response.proposal.kind === 'classificacao' ? 'Confirmar classificação' : 'Confirmar alteração'}</button><button type="button" className="small-neutral-button" disabled={busy} onClick={() => void act(i, 'cancel')}><XCircle size={15} /> Cancelar</button><small>Válida por 15 minutos.</small></div>}
          {msg.proposalState === 'aplicada' && <div className="executive-ai-proposal-actions"><span className="status-badge success">Aplicada</span><button type="button" className="small-neutral-button" disabled={busy} onClick={() => void act(i, 'undo')}><Undo2 size={15} /> Desfazer</button></div>}
          {(msg.proposalState === 'cancelada' || msg.proposalState === 'desfeita') && <div className="executive-ai-proposal-actions"><span className="status-badge neutral">{msg.proposalState === 'cancelada' ? 'Cancelada' : 'Desfeita'}</span></div>}
          {msg.note && <small className="executive-ai-note">{msg.note}</small>}
        </div>}
        {msg.response && msg.response.sources.length > 0 && <div className="executive-ai-sources"><small>Consulta: {new Date(msg.response.consultedAt).toLocaleString('pt-BR')}</small>{msg.response.sources.map(s => <a href={s.caminho} key={s.modulo}><ExternalLink size={12} />{s.modulo} ({s.registros}{s.parcial ? '+' : ''} registros){s.parcial ? ' · amostra' : ''}</a>)}<small>{msg.response.disclaimer}</small></div>}
      </article>)}
      {busy && <div className="executive-ai-loading"><LoaderCircle className="spin" size={18} /> Lendo os lançamentos e calculando… pode levar alguns segundos.</div>}
    </div>
    {error && <div role="alert" className="executive-ai-error">{error}</div>}
    <form onSubmit={submit} className="executive-ai-form"><label htmlFor="executive-ai-question">Sua pergunta ou solicitação</label><textarea id="executive-ai-question" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={onKeyDown} maxLength={500} rows={3} placeholder="Ex.: Quais comissões estão pendentes? · Altere o valor da despesa TESTE IA para 200" disabled={busy} /><div><small>{question.length}/500 caracteres · Enter envia, Shift+Enter quebra linha</small><span className="executive-ai-form-actions"><button className="secondary-button executive-ai-clear" type="button" disabled={busy} title="Colar" onClick={() => void pasteQuestion()}><ClipboardPaste size={16} /> Colar</button>{messages.length > 0 && <button className="secondary-button executive-ai-clear" type="button" disabled={busy} onClick={() => { setMessages([]); setError(''); setQuestion('') }}><Eraser size={16} /> Limpar conversa</button>}<button className="revenue-button" type="submit" disabled={busy || question.trim().length < 5}><Send size={16} /> Enviar</button></span></div></form>
  </section>
}
