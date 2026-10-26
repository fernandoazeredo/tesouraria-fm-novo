/** Agrupa números CNJ equivalentes independentemente de pontuação e espaços.
 * Identificadores não CNJ são preservados; sem número, utiliza ID único.
 */
export function processGroupKey(processo: unknown, id: string): string {
  const raw=String(processo??'').trim()
  const digits=raw.replace(/\D/g,'')
  if(digits.length===20)return 'cnj:'+digits
  if(raw)return 'outro:'+raw.toLowerCase().replace(/\s+/g,' ')
  return 'sem-cnj:'+id
}
export function groupByProcess<T extends {id:string;processo?:string}>(items:T[]) {
  const groups=new Map<string,T[]>()
  for(const item of items){
    const key=processGroupKey(item.processo,item.id)
    groups.set(key,[...(groups.get(key)||[]),item])
  }
  return Array.from(groups.values())
}
