import { useState, type FormEvent } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Sparkles, Send, ShieldCheck, LoaderCircle, ExternalLink } from 'lucide-react'
import { firebaseApp } from '../lib/firebase'
import './ExecutiveAiPage.css'

type AiResponse = {
  answer: string
  sources: Array<{ modulo: string; caminho: string; parcial: boolean; registros: number }>
  consultedAt: string
  disclaimer: string
}
type Message = { role: 'user' | 'assistant'; text: string; response?: AiResponse }
const queryAi = httpsCallable<{ question: string }, AiResponse>(getFunctions(firebaseApp,'southamerica-east1'), 'executiveAiAsk')

export function ExecutiveAiPage() {
  const [question,setQuestion]=useState('')
  const [messages,setMessages]=useState<Message[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const q=question.trim()
    if(busy || q.length<5 || q.length>500) return
    setBusy(true); setQuestion(''); setError('')
    setMessages(prev=>[...prev,{role:'user',text:q}])
    try {
      const result=await queryAi({question:q})
      setMessages(prev=>[...prev,{role:'assistant',text:result.data.answer,response:result.data}])
    } catch(err) {
      const code=(err as {code?: string})?.code||''
      const description=(err as Error)?.message||'Não foi possível consultar a IA.'
      const clean=/not-found|unavailable|internal/.test(code) ? 'O serviço seguro de IA ainda não está disponível. Nenhum lançamento foi alterado.' : description
      setError(clean)
    } finally { setBusy(false) }
  }
  const prompts=[
    'Quais comissões estão pendentes?',
    'Quais receitas estão aguardando recebimento?',
    'Quais despesas estão aguardando aprovação?',
    'Como funciona a Conciliação Bancária?',
  ]
  return <section className="page-card executive-ai">
    <header className="executive-ai-head"><Sparkles size={27} /><div><span className="eyebrow">Consulta exclusiva do Master principal</span><h1>IA — Assistente Executivo</h1><p>Consulte os módulos e os lançamentos do Tesouraria FM Novo. Respostas somente leitura.</p></div></header>
    <div className="executive-ai-security"><ShieldCheck size={17}/> Uso privado. Sem execução de pagamentos, alterações ou aprovações. Dados bancários e CPF não são enviados à IA.</div>
    <div className="executive-ai-messages" aria-live="polite">
      {messages.length===0 && <div className="executive-ai-welcome"><Sparkles size={32}/><strong>O que deseja consultar?</strong><p>Pesquise informações, processos, valores, status, regras e pendências nos módulos do sistema.</p><div className="executive-ai-prompts">{prompts.map(p=><button key={p} type="button" disabled={busy} onClick={()=>setQuestion(p)}>{p}</button>)}</div></div>}
      {messages.map((msg,i)=><article key={i} className={`executive-ai-bubble ${msg.role}`}><strong>{msg.role==='assistant'?'IA':'Você'}</strong><p>{msg.text}</p>{msg.response&&<div className="executive-ai-sources"><small>Consulta: {new Date(msg.response.consultedAt).toLocaleString('pt-BR')}</small>{msg.response.sources.map(s=><a href={s.caminho} key={s.modulo}><ExternalLink size={12}/>{s.modulo} ({s.registros}{s.parcial?'+':''} registros){s.parcial?' · amostra':''}</a>)}<small>{msg.response.disclaimer}</small></div>}</article>)}
      {busy&&<div className="executive-ai-loading"><LoaderCircle className="spin" size={18}/> Consultando registros autorizados…</div>}
    </div>
    {error&&<div role="alert" className="executive-ai-error">{error}</div>}
    <form onSubmit={submit} className="executive-ai-form"><label htmlFor="executive-ai-question">Sua pergunta</label><textarea id="executive-ai-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} rows={3} placeholder="Ex.: Quais comissões de agentes estão aguardando pagamento?" disabled={busy}/><div><small>{question.length}/500 caracteres</small><button className="revenue-button" type="submit" disabled={busy||question.trim().length<5}><Send size={16}/> Perguntar</button></div></form>
  </section>
}
