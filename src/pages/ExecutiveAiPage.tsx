import { useState, type FormEvent } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Sparkles, Send, ShieldCheck, LoaderCircle, ExternalLink, CheckCircle2, XCircle, Undo2, PencilLine } from 'lucide-react'
import { firebaseApp } from '../lib/firebase'
import './ExecutiveAiPage.css'
import { AiMarkdown } from './ExecutiveAiMarkdown'

type DiffRow = { field: string; before: unknown; after: unknown }
type Proposal = { id: string; modulo: string; collection: string; docId: string; summary: string; diff: DiffRow[]; expiresAtMs: number }
type AiResponse = {
  answer: string
  sources: Array<{ modulo: string; caminho: string; parcial: boolean; registros: number }>
  consultedAt: string
  disclaimer: string
  proposal?: Proposal
}
type ProposalState = 'pendente' | 'aplicada' | 'cancelada' | 'desfeita'
type Message = { role: 'user' | 'assistant'; text: string; response?: AiResponse; proposalState?: ProposalState; note?: string }

const fns = getFunctions(firebaseApp, 'southamerica-east1')
const queryAi = httpsCallable<{ question: string }, AiResponse>(fns, 'executiveAiAsk')
// Confirmar/Cancelar/Desfazer usam a mesma função pública e autenticada (ação explícita).
const actionAi = httpsCallable<{ action: 'apply' | 'undo' | 'cancel'; proposalId: string }, { ok: boolean; message: string }>(fns, 'executiveAiAsk')
const applyAi = (d: { proposalId: string }) => actionAi({ action: 'apply', ...d })
const undoAi = (d: { proposalId: string }) => actionAi({ action: 'undo', ...d })
const cancelAi = (d: { proposalId: string }) => actionAi({ action: 'cancel', ...d })

function fmt(v: unknown) {
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

export function ExecutiveAiPage() {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
    if (kind === 'apply' && !window.confirm(`Confirmar a alteração em ${proposal.modulo} (${proposal.docId})?`)) return
    setBusy(true); setError('')
    try {
      if (kind === 'apply') { const r = await applyAi({ proposalId: proposal.id }); patch(index, { proposalState: 'aplicada', note: r.data.message }) }
      if (kind === 'cancel') { await cancelAi({ proposalId: proposal.id }); patch(index, { proposalState: 'cancelada', note: 'Proposta cancelada. Nada foi alterado.' }) }
      if (kind === 'undo') { const r = await undoAi({ proposalId: proposal.id }); patch(index, { proposalState: 'desfeita', note: r.data.message }) }
    } catch (err) {
      setError(errorText(err, 'Não foi possível concluir a ação.'))
    } finally { setBusy(false) }
  }

  const promptGroups: Array<{ title: string; items: string[] }> = [
    { title: 'Resumo e situação financeira', items: ['Faça um resumo geral do escritório', 'Qual a situação financeira de hoje?', 'Qual a situação financeira desta semana?', 'Qual a situação financeira deste mês?', 'O que está pendente de decisão hoje?'] },
    { title: 'Despesas', items: ['Quais despesas estão aguardando aprovação?', 'Quais despesas foram pagas este mês?', 'Quais despesas foram devolvidas ou rejeitadas?'] },
    { title: 'Receitas e Tesouraria', items: ['Quais receitas estão aguardando a Tesouraria?', 'Quais receitas foram confirmadas este mês?', 'Quais receitas foram devolvidas para correção?'] },
    { title: 'Aprovações', items: ['O que está na fila de Aprovações?', 'Qual o valor total aguardando aprovação?'] },
    { title: 'Repasses e Comissões', items: ['Quais comissões estão pendentes?', 'Quais repasses de alvará estão a pagar?', 'Como está o Repasse Societário do mês?'] },
    { title: 'Nota Fiscal, Contabilidade e DRE', items: ['Quais notas fiscais estão pendentes?', 'Quais envios à Contabilidade foram feitos?', 'Como funciona a DRE Gerencial?'] },
    { title: 'Banco e Auditoria', items: ['Há movimentos bancários não conciliados?', 'Como funciona a Conciliação Bancária?', 'Quais foram as últimas ações na Auditoria?'] },
  ]
  return <section className="page-card executive-ai">
    <header className="executive-ai-head"><Sparkles size={27} /><div><span className="eyebrow">Exclusivo do Master principal</span><h1>IA — Assistente Executivo</h1><p>Consulte os módulos e os lançamentos do Tesouraria FM Novo. Para alterar um lançamento, peça expressamente (ex.: “altere o valor da despesa X para 200”) e confirme.</p></div></header>
    <div className="executive-ai-security"><ShieldCheck size={17} /> Uso privado. Nenhuma alteração é gravada sem a sua confirmação; tudo vai para a Auditoria e pode ser desfeito. A IA não exclui lançamentos nem altera usuários, permissões, CPF/CNPJ ou dados bancários.</div>
    <div className="executive-ai-messages" aria-live="polite">
      {messages.length === 0 && <div className="executive-ai-welcome"><Sparkles size={32} /><strong>O que deseja consultar ou ajustar?</strong><p>Pesquise informações, processos, valores, status, regras e pendências nos módulos do sistema.</p><div className="executive-ai-groups">{promptGroups.map(g => <div key={g.title} className="executive-ai-group"><span>{g.title}</span><div className="executive-ai-prompts">{g.items.map(p => <button key={p} type="button" disabled={busy} onClick={() => setQuestion(p)}>{p}</button>)}</div></div>)}</div></div>}
      {messages.map((msg, i) => <article key={i} className={`executive-ai-bubble ${msg.role}`}>
        <strong>{msg.role === 'assistant' ? 'IA' : 'Você'}</strong>{msg.role === 'assistant' ? <AiMarkdown text={msg.text} /> : <p>{msg.text}</p>}
        {msg.response?.proposal && <div className={`executive-ai-proposal ${msg.proposalState}`}>
          <div className="executive-ai-proposal-head"><PencilLine size={16} /> Alteração proposta · {msg.response.proposal.modulo} · <code>{msg.response.proposal.docId}</code></div>
          <table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>{msg.response.proposal.diff.map(d => <tr key={d.field}><td>{d.field}</td><td>{fmt(d.before)}</td><td><b>{fmt(d.after)}</b></td></tr>)}</tbody></table>
          {msg.proposalState === 'pendente' && <div className="executive-ai-proposal-actions"><button type="button" className="small-success-button" disabled={busy} onClick={() => void act(i, 'apply')}><CheckCircle2 size={15} /> Confirmar alteração</button><button type="button" className="small-neutral-button" disabled={busy} onClick={() => void act(i, 'cancel')}><XCircle size={15} /> Cancelar</button><small>Válida por 15 minutos.</small></div>}
          {msg.proposalState === 'aplicada' && <div className="executive-ai-proposal-actions"><span className="status-badge success">Aplicada</span><button type="button" className="small-neutral-button" disabled={busy} onClick={() => void act(i, 'undo')}><Undo2 size={15} /> Desfazer</button></div>}
          {(msg.proposalState === 'cancelada' || msg.proposalState === 'desfeita') && <div className="executive-ai-proposal-actions"><span className="status-badge neutral">{msg.proposalState === 'cancelada' ? 'Cancelada' : 'Desfeita'}</span></div>}
          {msg.note && <small className="executive-ai-note">{msg.note}</small>}
        </div>}
        {msg.response && msg.response.sources.length > 0 && <div className="executive-ai-sources"><small>Consulta: {new Date(msg.response.consultedAt).toLocaleString('pt-BR')}</small>{msg.response.sources.map(s => <a href={s.caminho} key={s.modulo}><ExternalLink size={12} />{s.modulo} ({s.registros}{s.parcial ? '+' : ''} registros){s.parcial ? ' · amostra' : ''}</a>)}<small>{msg.response.disclaimer}</small></div>}
      </article>)}
      {busy && <div className="executive-ai-loading"><LoaderCircle className="spin" size={18} /> Processando…</div>}
    </div>
    {error && <div role="alert" className="executive-ai-error">{error}</div>}
    <form onSubmit={submit} className="executive-ai-form"><label htmlFor="executive-ai-question">Sua pergunta ou solicitação</label><textarea id="executive-ai-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} rows={3} placeholder="Ex.: Quais comissões estão pendentes? · Altere o valor da despesa TESTE IA para 200" disabled={busy} /><div><small>{question.length}/500 caracteres</small><button className="revenue-button" type="submit" disabled={busy || question.trim().length < 5}><Send size={16} /> Enviar</button></div></form>
  </section>
}
