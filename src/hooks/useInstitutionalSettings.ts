import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'

export type InstitutionalSettings = {
  razaoSocial: string
  cnpj: string
  endereco: string
}

export const DEFAULT_INSTITUTIONAL_SETTINGS: InstitutionalSettings = {
  razaoSocial: 'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS',
  cnpj: '04.344.462/0001-87',
  endereco: 'Rua México, 21 / 1102 – Centro – Rio de Janeiro – RJ',
}

let currentInstitutionalSettings: InstitutionalSettings = DEFAULT_INSTITUTIONAL_SETTINGS
export function getCurrentInstitutionalSettings(): InstitutionalSettings { return currentInstitutionalSettings }

export function useInstitutionalSettings() {
  const [settings, setSettings] = useState<InstitutionalSettings>(DEFAULT_INSTITUTIONAL_SETTINGS)

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'appConfig', 'institutional'), (snapshot) => {
      if (!snapshot.exists()) {
        currentInstitutionalSettings = DEFAULT_INSTITUTIONAL_SETTINGS
        setSettings(DEFAULT_INSTITUTIONAL_SETTINGS)
        return
      }
      const data = snapshot.data()
      const next: InstitutionalSettings = {
        razaoSocial: String(data.razaoSocial || DEFAULT_INSTITUTIONAL_SETTINGS.razaoSocial),
        cnpj: String(data.cnpj || DEFAULT_INSTITUTIONAL_SETTINGS.cnpj),
        endereco: String(data.endereco || DEFAULT_INSTITUTIONAL_SETTINGS.endereco),
      }
      currentInstitutionalSettings = next
      setSettings(next)
    }, () => { currentInstitutionalSettings = DEFAULT_INSTITUTIONAL_SETTINGS; setSettings(DEFAULT_INSTITUTIONAL_SETTINGS) })

    return unsubscribe
  }, [])

  return settings
}
