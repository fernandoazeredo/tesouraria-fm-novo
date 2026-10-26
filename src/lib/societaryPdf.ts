import { jsPDF } from 'jspdf'
import { groupByProcess } from './societaryGrouping'
export type RepassePdfRow = {
  id:string; processo?:string; reclamante?:string; reclamada?:string; receiptDate?:string; competence?:string;
  sourceGrossAmount?:number; sourceClientAmount?:number|null; sourceComponents?:Array<{nome?:string;valor?:number}>; officeFees?:number; taxesValue?:number;
  netOfficeFees?:number; flavioShare?:number; anaShare?:number; transferValue?:number;
  paidValue?:number; status?:string; beneficiary?:string; calculationVersion?:string
}
const brl=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?brl(v):'Não informado'
const name=(v:unknown)=>String(v||'Não informado')
const dateBR=(v:unknown)=>{const t=String(v||'');return /^\d{4}-\d{2}-\d{2}$/.test(t)?t.slice(8,10)+'/'+t.slice(5,7)+'/'+t.slice(0,4):name(v)}
const competenceBR=(v:unknown)=>{const t=String(v||'');return /^\d{4}-\d{2}$/.test(t)?t.slice(5,7)+'/'+t.slice(0,4):name(v)}
const statusBR:Record<string,string>={apurado:'Apurado',aguardando_aprovacao:'Aguardando aprovação',devolvido:'Devolvido',rejeitado:'Rejeitado',aprovado:'Aprovado',enviado_tesouraria:'Enviado à Tesouraria',pago:'Pago',cancelado:'Cancelado'}
export function saveRepassePdf(rows:RepassePdfRow[],userName:string,label:string,fileName:string) {
  const pdf=new jsPDF({unit:'mm',format:'a4'})
  const w=pdf.internal.pageSize.width, h=pdf.internal.pageSize.height, margin=15
  let y=19
  const draw=(value:string,size=9,bold=false)=>{
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size)
    const lines=pdf.splitTextToSize(value,w-2*margin) as string[]
    for(const line of lines){if(y>h-22){pdf.addPage();y=19}pdf.text(line,margin,y);y+=size*0.53}
    y+=2
  }
  draw('FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',12,true)
  draw(label,11,true)
  draw('Emissão: '+new Date().toLocaleString('pt-BR')+' · Usuário: '+userName,8)
  draw('Registros: '+rows.length,9)
  let feeSum=0,taxSum=0,netSum=0,flavioSum=0,anaSum=0,paidSum=0,oldPaid=0,oldPending=0,newPending=0,oldTransfer=0
  for(const items of groupByProcess(rows)){
    if(y>h-100){pdf.addPage();y=19}
    pdf.setDrawColor(180);pdf.line(margin,y,w-margin,y);y+=6
    draw('CNJ / Processo: '+name(items[0].processo),11,true)
    draw('Reclamante: '+name(items[0].reclamante)+' | Reclamada: '+name(items[0].reclamada))
    for(const item of items){
    draw('Recebimento: '+dateBR(item.receiptDate)+' | Competência: '+competenceBR(item.competence)+' | Status: '+(statusBR[String(item.status)]||name(item.status)))
    const current=item.calculationVersion==='net-1133-60-40-v1'
    if(!current)draw('CÁLCULO ANTERIOR — valores fiscais não disponíveis ou não apurados pela nova regra.',9,true)
    draw('Valor recebido: '+(current?amount(item.sourceGrossAmount):'Não informado'))
    draw('Valor líquido do cliente (demonstrativo): '+(current?amount(item.sourceClientAmount):'Não informado'))
    if(current){
      draw('Composição do Demonstrativo',9,true)
      for(const part of item.sourceComponents||[])if(String(part.nome||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()!=='honorarios do escritorio')draw(name(part.nome)+': '+amount(part.valor),8)
    }
    draw('Honorários do escritório: '+amount(item.officeFees))
    draw('Impostos (11,33%): '+(current?amount(item.taxesValue):'Não disponível'))
    draw('Honorários líquidos: '+(current?amount(item.netOfficeFees):'Não disponível'))
    draw('Flávio (60%, informativo): '+(current?amount(item.flavioShare):'Não disponível'))
    draw('Ana Paula Müller (40%): '+(current?amount(item.anaShare):'Não disponível'))
    if(current){
      draw('Honorários × 11,33% = Impostos: '+amount(item.officeFees)+' × 11,33% = '+amount(item.taxesValue),8)
      draw('Honorários - Impostos = Líquido: '+amount(item.officeFees)+' - '+amount(item.taxesValue)+' = '+amount(item.netOfficeFees),8)
      draw('Líquido × 60% = Flávio: '+amount(item.netOfficeFees)+' × 60% = '+amount(item.flavioShare),8)
      draw('Líquido × 40% = Ana Paula Müller: '+amount(item.netOfficeFees)+' × 40% = '+amount(item.anaShare),8)
    }
    draw('Repasse apurado: '+amount(item.transferValue)+' | Pago: '+amount(item.paidValue))
    if(typeof item.transferValue==='number'&&typeof item.paidValue==='number')draw('Saldo a pagar: '+brl(Math.max(0,item.transferValue-item.paidValue)),9,true)
    if(current){feeSum+=item.officeFees||0;taxSum+=item.taxesValue||0;netSum+=item.netOfficeFees||0;flavioSum+=item.flavioShare||0;anaSum+=item.anaShare||0}
    if(current){paidSum+=item.paidValue||0;newPending+=Math.max(0,(item.transferValue||0)-(item.paidValue||0))}
    else {oldPaid+=item.paidValue||0;oldPending+=Math.max(0,(item.transferValue||0)-(item.paidValue||0));oldTransfer+=item.transferValue||0}
    }
    draw('Subtotal do CNJ — repasse: '+brl(items.reduce((t,item)=>t+(item.transferValue||0),0))+' · Pago: '+brl(items.reduce((t,item)=>t+(item.paidValue||0),0))+' · Saldo: '+brl(items.reduce((t,item)=>t+Math.max(0,(item.transferValue||0)-(item.paidValue||0)),0)),9,true)
  }
  if(rows.length>1){
    if(y>h-75){pdf.addPage();y=19}
    pdf.setDrawColor(180);pdf.line(margin,y,w-margin,y);y+=6
    draw('TOTALIZADORES — APURAÇÕES NOVAS (sem misturar cálculos anteriores)',10,true)
    draw('Honorários: '+brl(feeSum)+' · Impostos: '+brl(taxSum))
    draw('Líquido: '+brl(netSum)+' · Flávio (informativo): '+brl(flavioSum))
    draw('Ana Paula Müller: '+brl(anaSum)+' · Pago (novos): '+brl(paidSum)+' · Saldo (novos): '+brl(newPending))
    draw('CÁLCULOS ANTERIORES — Repasse: '+brl(oldTransfer)+' · Pago: '+brl(oldPaid)+' · Saldo: '+brl(oldPending))
  }
  const pages=pdf.getNumberOfPages()
  for(let p=1;p<=pages;p++){pdf.setPage(p);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text('Página '+p+' de '+pages,w-margin,h-9,{align:'right'})}
  pdf.save(fileName)
}
