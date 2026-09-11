import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Save } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { db } from '../lib/firebase'
import { clearRequiredFieldErrors, showRequiredFieldErrors } from '../lib/requiredFieldValidation'

const DEFAULTS = {
  razaoSocial: 'MARQUES & MÜLLER ADVOGADOS ASSOCIADOS',
  cnpj: '04.344.462/0001-87',
  endereco: 'Rua México, 21 / 1102 – Centro – Rio de Janeiro – RJ',
}

export function InstitutionalSettingsEditor() {
  const location = useLocation()
  const { profile } = useAuth()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [form, setForm] = useState(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (location.pathname !== '/configuracoes' || profile?.role !== 'master') {
      setHost(null)
      return
    }

    const locate = () => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('.page-card')).find((item) =>
        item.textContent?.includes('Configurações do Aplicativo'),
      ) ?? null
      setHost(card)
    }

    locate()
    const timer = window.setTimeout(locate, 0)
    return () => window.clearTimeout(timer)
  }, [location.pathname, profile?.role])

  useEffect(() => {
    if (location.pathname !== '/configuracoes' || profile?.role !== 'master') return
    let active = true
    void getDoc(doc(db, 'appConfig', 'institutional')).then((snapshot) => {
      if (!active || !snapshot.exists()) return
      const data = snapshot.data()
      setForm({
        razaoSocial: String(data.razaoSocial || DEFAULTS.razaoSocial),
        cnpj: String(data.cnpj || DEFAULTS.cnpj),
        endereco: String(data.endereco || DEFAULTS.endereco),
      })
    }).catch(() => undefined)
    return () => { active = false }
  }, [location.pathname, profile?.role])

  useEffect(() => {
    if (!host) return
    const original = host.querySelector<HTMLElement>('.settings-grid')
    if (original) original.style.display = 'none'
    return () => { if (original) original.style.removeProperty('display') }
  }, [host])

  async function save() {
    if (!profile || profile.role !== 'master') return
    const missingKeys: string[] = []
    if (!form.razaoSocial.trim()) missingKeys.push('institution-name')
    if (!form.cnpj.trim()) missingKeys.push('institution-cnpj')
    if (!form.endereco.trim()) missingKeys.push('institution-address')
    if (missingKeys.length) { showRequiredFieldErrors('.institutional-settings-editor', missingKeys); return }
    clearRequiredFieldErrors('.institutional-settings-editor')
    setSaving(true)
    setMessage('')
    try {
      await setDoc(doc(db, 'appConfig', 'institutional'), {
        ...form,
        updatedAt: serverTimestamp(),
        updatedBy: profile.uid,
        updatedByName: profile.displayName,
        updatedByEmail: profile.email,
      }, { merge: true })
      setMessage('Dados institucionais salvos com sucesso.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível salvar. Verifique a permissão do Administrador Master.')
    } finally {
      setSaving(false)
    }
  }

  if (!host || location.pathname !== '/configuracoes' || profile?.role !== 'master') return null

  return createPortal(
    <div className="settings-grid institutional-settings-editor">
      <label><span>Razão Social</span><input data-required-key="institution-name" value={form.razaoSocial} onChange={(e) => setForm((current) => ({ ...current, razaoSocial: e.target.value }))} /></label>
      <label><span>CNPJ</span><input data-required-key="institution-cnpj" value={form.cnpj} onChange={(e) => setForm((current) => ({ ...current, cnpj: e.target.value }))} /></label>
      <label className="settings-full-width"><span>Endereço</span><input data-required-key="institution-address" value={form.endereco} onChange={(e) => setForm((current) => ({ ...current, endereco: e.target.value }))} /></label>
      <div className="settings-full-width" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="primary-button" type="button" disabled={saving} onClick={() => void save()}><Save size={17} /> {saving ? 'Salvando...' : 'Salvar alterações'}</button>
        {message && <span>{message}</span>}
      </div>
    </div>,
    host,
  )
}
