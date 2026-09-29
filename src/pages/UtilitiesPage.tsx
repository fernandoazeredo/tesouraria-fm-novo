import { useRef, useState } from 'react'
import { AlertTriangle, DatabaseBackup, Download, Trash2, Upload } from 'lucide-react'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { PRIMARY_ADMIN_EMAIL, useAuth } from '../auth/AuthContext'

const BACKUP_COLLECTIONS = [
  'users',
  'expenses',
  'receivables',
  'alvaraTransfers',
  'agentCommissions',
  'fiscalNotes',
  'accountingDispatches',
  'accountingPackages',
  'auditLogs',
  'settings',
  'chartOfAccounts',
  'bankStatements',
  'bankTransactions',
  'bankReconciliations',
  'bankReconciliationPeriods',
  'societaryTransfers',
] as const

const PROTECTED_COLLECTIONS = new Set<string>(['users', 'settings', 'chartOfAccounts'])
const WIPE_COLLECTIONS = BACKUP_COLLECTIONS.filter((name) => !PROTECTED_COLLECTIONS.has(name))

type BackupFile = {
  app: 'controle-despesas-receitas-mm'
  version: 1
  createdAt: string
  createdBy: string
  collections: Record<string, Array<{ id: string; data: unknown }>>
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function encodeValue(value: unknown): unknown {
  if (value instanceof Timestamp) return { __firebaseType: 'timestamp', iso: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(encodeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, encodeValue(child)]))
  }
  return value
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (object.__firebaseType === 'timestamp' && typeof object.iso === 'string') return Timestamp.fromDate(new Date(object.iso))
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, decodeValue(child)]))
  }
  return value
}

function attachmentPaths(data: DocumentData) {
  const paths: string[] = []
  const attachments = Array.isArray(data.attachments) ? data.attachments : []
  for (const item of attachments) {
    if (item && typeof item === 'object' && typeof item.path === 'string') paths.push(item.path)
  }
  if (typeof data.storagePath === 'string') paths.push(data.storagePath)
  return paths
}

export function UtilitiesPage() {
  const { profile } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | 'wipe' | ''>('')
  const [message, setMessage] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [phrase, setPhrase] = useState('')

  const isMaster = Boolean(profile && profile.role === 'master' && profile.email.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL)

  if (!isMaster || !profile) {
    return <section className="page-card module-empty"><AlertTriangle size={36} /><strong>Acesso restrito</strong><span>Utilitários são exclusivos do Administrador Master.</span></section>
  }

  const masterProfile = profile

  async function buildBackup(download = true) {
    const collections: BackupFile['collections'] = {}
    for (const name of BACKUP_COLLECTIONS) {
      const snapshot = await getDocs(collection(db, name))
      collections[name] = snapshot.docs.map((item) => ({ id: item.id, data: encodeValue(item.data()) }))
    }
    const backup: BackupFile = {
      app: 'controle-despesas-receitas-mm',
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: masterProfile.email,
      collections,
    }
    if (download) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadJson(backup, `Backup_Controle_Despesas_Receitas_${stamp}.json`)
    }
    return backup
  }

  async function backupNow() {
    setBusy('backup')
    setMessage('')
    try {
      await buildBackup(true)
      setMessage('Backup JSON baixado com sucesso. Ele contém os dados do Firestore; arquivos binários do Storage permanecem no Firebase.')
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível gerar o backup JSON.')
    } finally {
      setBusy('')
    }
  }

  async function restoreFile(file: File) {
    setBusy('restore')
    setMessage('')
    const restoreControl = doc(db, 'systemControl', 'restore')
    let restoreWindowOpened = false

    try {
      const parsed = JSON.parse(await file.text()) as BackupFile
      if (parsed.app !== 'controle-despesas-receitas-mm' || parsed.version !== 1 || !parsed.collections) {
        throw new Error('Arquivo de backup incompatível com este sistema.')
      }

      await setDoc(restoreControl, {
        uid: masterProfile.uid,
        email: masterProfile.email,
        startedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      })
      restoreWindowOpened = true

      for (const name of BACKUP_COLLECTIONS) {
        if (name === 'chartOfAccounts') continue
        const rows = parsed.collections[name] ?? []
        for (const row of rows) {
          if (name === 'users' && row.id === masterProfile.uid) continue
          await setDoc(doc(db, name, row.id), decodeValue(row.data) as DocumentData, { merge: false })
        }
      }

      await setDoc(doc(db, 'settings', 'lastRestore'), {
        restoredAt: serverTimestamp(),
        restoredBy: masterProfile.uid,
        restoredByEmail: masterProfile.email,
        sourceCreatedAt: parsed.createdAt,
      })
      setMessage('Backup JSON restaurado com sucesso. O Plano de Contas atual foi preservado para impedir retorno a versões antigas.')
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : 'Não foi possível restaurar o backup.')
    } finally {
      if (restoreWindowOpened) {
        try { await deleteDoc(restoreControl) } catch (error) { console.error('Não foi possível encerrar a janela de restauração:', error) }
      }
      setBusy('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function wipeAllExceptUsers() {
    if (phrase.trim().toUpperCase() !== 'APAGAR TUDO') return
    setBusy('wipe')
    setMessage('')

    const restoreControl = doc(db, 'systemControl', 'restore')
    let restoreWindowOpened = false
    const failedCollections: string[] = []

    try {
      await buildBackup(true)

      await setDoc(restoreControl, {
        uid: masterProfile.uid,
        email: masterProfile.email,
        startedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      })
      restoreWindowOpened = true

      for (const name of WIPE_COLLECTIONS) {
        try {
          const snapshot = await getDocs(collection(db, name))
          for (const item of snapshot.docs) {
            const data = item.data()

            for (const path of attachmentPaths(data)) {
              try {
                await deleteObject(storageRef(storage, path))
              } catch (error) {
                const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
                if (code !== 'storage/object-not-found' && code !== 'storage/unauthorized') {
                  console.warn('Falha ao remover arquivo do Storage:', path, error)
                }
              }
            }

            await deleteDoc(doc(db, name, item.id))
          }
        } catch (error) {
          console.error(`Falha ao limpar coleção ${name}:`, error)
          failedCollections.push(name)
        }
      }

      if (failedCollections.length) {
        setMessage(`Limpeza concluída parcialmente. Não foi possível apagar: ${failedCollections.join(', ')}. Usuários, Configurações e o Plano de Contas atual foram preservados. Um backup JSON foi baixado antes da operação.`)
      } else {
        setMessage('Limpeza concluída. Usuários, Configurações e o Plano de Contas atual foram preservados. Antes da exclusão, um backup JSON foi baixado automaticamente.')
      }
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error
        ? `A limpeza não foi concluída integralmente: ${error.message}`
        : 'A limpeza não foi concluída integralmente. Usuários, Configurações e Plano de Contas não são removidos por esta operação.')
    } finally {
      if (restoreWindowOpened) {
        try {
          await deleteDoc(restoreControl)
        } catch (error) {
          console.error('Não foi possível encerrar a janela de restauração:', error)
        }
      }
      setConfirmWipe(false)
      setPhrase('')
      setBusy('')
    }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administração Master</span><h1>Utilitários</h1><p>Backup, restauração e limpeza controlada do ambiente.</p></div></div>

    {message && <div className="accounting-feedback success" role="status">{message}</div>}

    <div className="utilities-grid">
      <section className="page-card utility-card">
        <DatabaseBackup size={28} />
        <div><h2>Backup JSON</h2><p>Baixa uma cópia dos dados do Firestore, incluindo usuários, despesas, receitas, repasses, comissões, Notas Fiscais, auditoria, configurações e Plano de Contas.</p></div>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void backupNow()}><Download size={17} /> {busy === 'backup' ? 'Gerando...' : 'Baixar backup JSON'}</button>
      </section>

      <section className="page-card utility-card">
        <Upload size={28} />
        <div><h2>Restaurar backup JSON</h2><p>Exclusivo de Fernando Azeredo (Administrador Master). Selecione um JSON gerado por este sistema para regravar os documentos com seus IDs originais. O Plano de Contas atual não é substituído por versões antigas contidas no backup.</p></div>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}><Upload size={17} /> {busy === 'restore' ? 'Restaurando...' : 'Fazer upload do JSON'}</button>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreFile(file) }} />
      </section>

      <section className="page-card utility-card utility-danger-card">
        <Trash2 size={28} />
        <div><h2>Apagar dados operacionais</h2><p>Remove despesas, receitas, repasses, comissões, Notas Fiscais, auditoria, documentos operacionais e extratos. Usuários, Configurações e o Plano de Contas atual são sempre preservados. Um backup JSON é baixado automaticamente antes da limpeza.</p></div>
        <button className="expense-button" type="button" disabled={Boolean(busy)} onClick={() => setConfirmWipe(true)}><Trash2 size={17} /> Limpeza total</button>
      </section>
    </div>

    {confirmWipe && <div className="modal-backdrop"><section className="decision-modal rejeitado" role="dialog" aria-modal="true">
      <div className="modal-toolbar"><div><span className="eyebrow">Operação irreversível</span><h2>Apagar dados operacionais</h2></div></div>
      <div className="decision-warning"><AlertTriangle size={22} /><div><strong>Confirmação obrigatória</strong><span>Digite APAGAR TUDO para habilitar a exclusão. Usuários, Configurações e Plano de Contas serão preservados.</span></div></div>
      <label className="decision-reason"><span>Confirmação</span><input autoFocus value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="APAGAR TUDO" /></label>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => { setConfirmWipe(false); setPhrase('') }}>Cancelar</button><button className="expense-button" type="button" disabled={busy === 'wipe' || phrase.trim().toUpperCase() !== 'APAGAR TUDO'} onClick={() => void wipeAllExceptUsers()}><Trash2 size={16} /> {busy === 'wipe' ? 'Apagando...' : 'Confirmar limpeza'}</button></div>
    </section></div>}
  </>
}
