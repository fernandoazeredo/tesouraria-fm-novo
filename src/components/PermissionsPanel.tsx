import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { migratePendingPermissions } from '../lib/pendingPermissions'
import { PRIMARY_ADMIN_EMAIL, DIRECTOR_EMAIL, officialRoleForEmail, useAuth } from '../auth/AuthContext'
import { modulePaths, defaultRoles, effectiveView, personDefaultBlocked, pendingPermissionDocId, type ModuleId, type PermissionDocument } from '../lib/permissionCatalog'

const labels: Record<ModuleId,string> = {
  dashboard:'Dashboard',despesas:'Despesas',receitas:'Receitas / Alvarás',repasse_alvaras:'Repasse de Alvarás',
  repasse_societario:'Repasse Societário',nota_fiscal:'Nota Fiscal',comissoes:'Comissões de Agentes',
  tesouraria:'Tesouraria — Recebimentos',aprovacoes:'Aprovações',dre:'DRE Gerencial',
  plano_contas:'Plano de Contas',contabilidade:'Contabilidade',calendario:'Calendário Financeiro',
  fluxo_caixa:'Fluxo de Caixa',conciliacao:'Conciliação Bancária',documentos:'Arquivo de Documentos',
  usuarios:'Usuários',auditoria:'Auditoria',utilitarios:'Utilitários',configuracoes:'Configurações',ia:'IA Executiva Privada',
}
type UserOption={id:string;displayName?:string;email:string;role:string;pending?:boolean}
const initialUsers = [
  { label:'Flávio', email:'flavio.marques@marquesemuller.adv.br' },
  { label:'Fernando', email:'fernandoazeredo64@gmail.com' },
  { label:'Socorro', email:'socorro@marquesemuller.adv.br' },
  { label:'Reinaldo', email:'reinaldo@marquesemuller.adv.br' },
] as const
export function PermissionsPanel() {
  const {profile}=useAuth()
  const master=profile?.role==='master' && profile.email?.trim().toLowerCase()===PRIMARY_ADMIN_EMAIL
  const [users,setUsers]=useState<UserOption[]>([])
  const [selected,setSelected]=useState('')
  const [loaded,setLoaded]=useState(false)
  const [readOnly,setReadOnly]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [original,setOriginal]=useState<PermissionDocument|null>(null)
  const [values,setValues]=useState<Partial<Record<ModuleId,boolean>>>({})
  const user=users.find(x=>x.id===selected)
  useEffect(()=>{if(!master)return;let live=true;void migratePendingPermissions(profile!.uid).catch(()=>undefined);getDocs(collection(db,'users')).then(s=>{if(live){const entries=s.docs.map(d=>({id:d.id,...d.data()} as UserOption));const listed=initialUsers.map(person=>{const found=entries.find(u=>String(u.email||'').trim().toLowerCase()===person.email);return found?{...found,displayName:person.label}:{id:'pending:'+person.email,email:person.email,displayName:person.label,role:officialRoleForEmail(person.email),pending:true}});setUsers([...listed,...entries.filter(u=>!initialUsers.some(person=>person.email===String(u.email||'').trim().toLowerCase()))])}}).catch(e=>{if(live)setMessage('Erro ao carregar usuários: '+String(e))});return()=>{live=false}},[master])
  useEffect(()=>{if(!master||!selected)return;const target=users.find(x=>x.id===selected);if(!target)return;let live=true;setLoaded(false);setReadOnly(false)
    const emailDoc=doc(db,'userPermissions',pendingPermissionDocId(target.email))
    const load=target.pending?getDoc(emailDoc):getDoc(doc(db,'userPermissions',selected)).then(s=>s.exists()?s:getDoc(emailDoc))
    load.then(s=>{if(!live)return;const value=s.exists()?s.data() as PermissionDocument:null;setOriginal(value);setValues(Object.fromEntries(Object.entries(value?.modules||{}).map(([k,v])=>[k,v?.ver]).filter(([,v])=>typeof v==='boolean')) as Partial<Record<ModuleId,boolean>>);if(target.pending)setMessage('Usuário ainda não acessou o app. As permissões salvas agora valem a partir do primeiro login.');setLoaded(true)}).catch(()=>{if(live){setOriginal(null);setValues({});setReadOnly(true);setMessage('Regras de permissão ainda não publicadas — somente visualização');setLoaded(true)}});return()=>{live=false}},[selected,master,users])
  if(!master)return null
  const ids=Object.keys(modulePaths) as ModuleId[]
  const isLocked=(id:ModuleId)=>{void id;return !!user && user.role==='master'&&user.email.toLowerCase()===PRIMARY_ADMIN_EMAIL}
  const effective=(id:ModuleId)=>user?effectiveView(id,user.role,user.email,{schemaVersion:1,modules:{...(original?.modules||{}),[id]:{...(original?.modules?.[id]||{}),...(values[id]===undefined?{}:{ver:values[id]})}}},PRIMARY_ADMIN_EMAIL,DIRECTOR_EMAIL):false
  const restore=()=>{if(!readOnly)setValues({})}
  const save=async()=>{
    if(!user||!profile||!loaded||readOnly||busy)return
    const old=original?.modules||{}
    const modules:PermissionDocument['modules']={...old}
    for(const id of ids) {
      if(isLocked(id))continue
      if(values[id]===undefined) delete modules[id]
      else modules[id]={...(old[id]||{}),ver:values[id]}
    }
    const changed=ids.filter(id=>JSON.stringify(old[id]||{})!==JSON.stringify(modules[id]||{}))
    if(!changed.length){setMessage('Nenhuma alteração identificada.');return}
    const description=changed.map(id=>labels[id]+': '+String(old[id]?.ver??'padrão')+' → '+String(modules[id]?.ver??'padrão')).join('\n')
    if(!window.confirm('Confirmar alterações para '+(user.displayName||user.email)+'?\n\n'+description))return
    setBusy(true);setMessage('')
    try{
      const payload={schemaVersion:1,modules,updatedBy:profile.uid,updatedAt:serverTimestamp()}
      const batch=writeBatch(db)
      batch.set(doc(db,'userPermissions',user.pending?pendingPermissionDocId(user.email):user.id),payload)
      batch.set(doc(collection(db,'auditLogs')),{action:'Permissões de usuário alteradas',module:'Configurações',entityId:user.id,detail:description,userId:profile.uid,userName:profile.displayName,userEmail:profile.email,targetUserId:user.id,targetEmail:user.email,before:old,after:modules,createdAt:serverTimestamp()})
      await batch.commit()
      setOriginal({schemaVersion:1,modules});setMessage('Permissões salvas e registradas na Auditoria.')
    }catch(e){setMessage('Falha ao salvar alterações: '+String(e))}
    finally{setBusy(false)}
  }
  return <section className="page-card">
    <h2>Controle de Permissões por Usuário</h2>
    <p>Defina quais módulos cada pessoa pode consultar. As ações financeiras permanecem controladas pelas regras vigentes.</p>
    <label>Usuário <select value={selected} onChange={e=>{setSelected(e.target.value);setMessage('')}}><option value="">Selecione um usuário</option>{users.map(u=><option key={u.id} value={u.id}>{u.displayName||u.email} — {u.role}{u.pending?' (aguardando primeiro acesso)':''}</option>)}</select></label>
    {user&&loaded&&<><div style={{overflowX:'auto',marginTop:16}}><table className="cash-flow-table" style={{minWidth:490}}><thead><tr><th>Módulo</th><th>Ver</th></tr></thead><tbody>{ids.map(id=><tr key={id}><td>{labels[id]}</td><td><label><input aria-label={'Ver '+labels[id]} type="checkbox" checked={effective(id)} disabled={readOnly||isLocked(id)} onChange={e=>setValues(p=>({...p,[id]:e.target.checked}))}/>{effective(id)?' 🔓':' 🔒'}</label></td></tr>)}</tbody></table></div>
    <div className="quick-actions" style={{marginTop:14}}><button type="button" className="secondary-button" disabled={busy||readOnly} onClick={restore}>Restaurar padrão do perfil</button><button type="button" className="primary-button" style={readOnly?{backgroundColor:'transparent',color:'inherit',border:'1px solid currentColor',opacity:0.75}:undefined} disabled={busy||readOnly} onClick={()=>void save()}>{busy?'Salvando...':'Salvar permissões'}</button></div></>}
    {message&&<p role="status">{message}</p>}
  </section>
}
