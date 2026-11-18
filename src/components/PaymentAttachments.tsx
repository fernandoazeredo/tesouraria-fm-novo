import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTask } from 'firebase/storage'
import { Paperclip, X } from 'lucide-react'
import { storage } from '../lib/firebase'
import { useAuth } from '../auth/AuthContext'
import './PaymentAttachments.css'

export type PaymentAttachment = { name: string; url: string; path: string; size: number; type: string; uploadedAt: string; uploadedBy: string; uploadedByName?: string }
type Upload = { id: string; name: string; progress: number; status: 'uploading' | 'error'; error?: string }

export function readAttachments(record?: Record<string, unknown> | null): PaymentAttachment[] {
  const list = record?.attachments
  return Array.isArray(list) ? list.filter((item) => item && typeof item === 'object' && (item as PaymentAttachment).url) as PaymentAttachment[] : []
}

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo'
}
function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * Documentos de um pagamento (Comissão, Repasse de Alvarás).
 * Os arquivos vão para o Storage na hora; a lista só é gravada quando o pagamento é salvo/reenviado.
 * `folder` identifica o pagamento (ex.: "comissoes/<id>").
 */
export function PaymentAttachments({ folder, value, onChange, disabled, onUploadingChange }: {
  folder: string
  value: PaymentAttachment[]
  onChange: Dispatch<SetStateAction<PaymentAttachment[]>>
  disabled?: boolean
  onUploadingChange?: (uploading: boolean) => void
}) {
  const { profile } = useAuth()
  const [uploads, setUploads] = useState<Upload[]>([])
  const tasks = useRef(new Map<string, UploadTask>())
  const initial = useRef(new Set(value.map((item) => item.path)))

  useEffect(() => { onUploadingChange?.(uploads.some((item) => item.status === 'uploading')) }, [uploads, onUploadingChange])
  useEffect(() => () => { tasks.current.forEach((task) => task.cancel()) }, [])

  function start(file: File) {
    if (!profile?.uid) return
    if (file.size > 20 * 1024 * 1024) { window.alert(`O arquivo ${file.name} ultrapassa o limite de 20 MB.`); return }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Mesma pasta de documentos das Receitas (regra de Storage já publicada).
    const path = `recebimentos/${profile.uid}/${folder}/${Date.now()}-${safeFileName(file.name)}`
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type || 'application/octet-stream' })
    tasks.current.set(id, task)
    setUploads((list) => [...list, { id, name: file.name, progress: 0, status: 'uploading' }])
    task.on('state_changed', (snap) => {
      const progress = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0
      setUploads((list) => list.map((item) => item.id === id ? { ...item, progress } : item))
    }, (error) => {
      tasks.current.delete(id)
      setUploads((list) => list.map((item) => item.id === id ? { ...item, status: 'error', error: error.code === 'storage/canceled' ? 'Cancelado' : 'Falha no envio' } : item))
    }, async () => {
      tasks.current.delete(id)
      const url = await getDownloadURL(task.snapshot.ref)
      onChange((prev) => [...prev, { name: file.name, url, path, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy: profile.uid, uploadedByName: profile.displayName || '' }])
      setUploads((list) => list.filter((item) => item.id !== id))
    })
  }

  return <section className="payment-attachments">
    <div className="payment-attachments-head"><Paperclip size={18} /><div><strong>Documentos do pagamento</strong><span>Anexe recibos, comprovantes ou o documento solicitado na devolução. Os anexos são gravados ao enviar para aprovação.</span></div></div>
    {value.length === 0 && uploads.length === 0 ? <p className="payment-attachments-empty">Nenhum documento anexado.</p> : <ul>
      {value.map((item) => <li key={item.path}><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a><small>{formatBytes(item.size)}{item.uploadedByName ? ` · ${item.uploadedByName}` : ''}</small>{!disabled && !initial.current.has(item.path) && <button type="button" className="icon-button" title="Remover da lista" onClick={() => onChange((prev) => prev.filter((row) => row.path !== item.path))}><X size={14} /></button>}</li>)}
      {uploads.map((item) => <li key={item.id} className={item.status}><span>{item.name}</span><small>{item.status === 'uploading' ? `Enviando… ${item.progress}%` : item.error}</small></li>)}
    </ul>}
    {!disabled && <label className="secondary-button payment-attachments-pick"><Paperclip size={15} /> Anexar documentos<input type="file" multiple hidden onChange={(event) => { Array.from(event.target.files || []).forEach(start); event.target.value = '' }} /></label>}
  </section>
}

/** Faixa com o motivo da devolução/rejeição, para quem vai corrigir. */
export function DecisionReason({ status, reason, by }: { status?: string; reason?: string; by?: string }) {
  if (!reason || !['devolvido', 'rejeitado'].includes(String(status))) return null
  const title = status === 'devolvido' ? 'Devolvido para correção' : 'Rejeitado'
  return <div className={`decision-reason ${status}`}><strong>{title}{by ? ` por ${by}` : ''}</strong><span>Motivo: {reason}</span></div>
}
