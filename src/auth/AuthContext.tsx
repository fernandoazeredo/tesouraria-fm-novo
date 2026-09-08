import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

/**
 * Perfis oficiais do sistema:
 * - master: Fernando — administração do sistema, usuários e configurações.
 * - diretor: Flávio Marques — autorizador oficial de pagamentos/despesas.
 * - gerente: Reinaldo — gestão e acompanhamento operacional.
 * - tesouraria: Socorro — operação financeira/Tesouraria.
 * - operador: demais colaboradores.
 *
 * UserRole permanece aberto como string para compatibilidade com módulos legados já existentes;
 * a autorização efetiva é feita pelas regras oficiais e pelas Security Rules do Firebase.
 */
export type UserRole = string

export type UserStatus = 'pending' | 'active' | 'inactive' | 'blocked'

export type AppUser = {
  uid: string
  email: string
  displayName: string
  role: UserRole
  status: UserStatus
  photoURL?: string
}

type AuthContextValue = {
  user: User | null
  profile: AppUser | null
  loading: boolean
  signInEmail: (email: string, password: string) => Promise<void>
  registerEmail: (name: string, email: string, password: string) => Promise<void>
  signInGoogle: () => Promise<void>
  logout: () => Promise<void>
}

export const PRIMARY_ADMIN_EMAIL = 'fernandoazeredo64@gmail.com'
export const TREASURY_EMAIL = 'socorro@marquesemuller.adv.br'
export const MANAGER_EMAIL = 'reinaldo@marquesemuller.adv.br'
export const DIRECTOR_EMAIL = 'flavio.marques@marquesemuller.adv.br'
export const DIRECTOR_EMAILS = [DIRECTOR_EMAIL] as const

export function isOfficialDirectorEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase()
  return DIRECTOR_EMAILS.includes(email as (typeof DIRECTOR_EMAILS)[number])
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function officialRoleForEmail(rawEmail: string): 'master' | 'diretor' | 'gerente' | 'tesouraria' | 'operador' {
  const email = rawEmail.trim().toLowerCase()
  if (email === PRIMARY_ADMIN_EMAIL) return 'master'
  if (isOfficialDirectorEmail(email)) return 'diretor'
  if (email === MANAGER_EMAIL) return 'gerente'
  if (email === TREASURY_EMAIL) return 'tesouraria'
  return 'operador'
}

function normalizeProfile(uid: string, data: Record<string, unknown>): AppUser {
  const email = String(data.email ?? '').trim().toLowerCase()
  const officialRole = officialRoleForEmail(email)
  const storedRole = String(data.role ?? '')
  const legacyRoles = ['admin', 'diretoria', 'alvaras', 'contabilidade', 'consulta']
  const role = officialRole !== 'operador'
    ? officialRole
    : legacyRoles.includes(storedRole) || !storedRole ? 'operador' : storedRole

  return {
    uid,
    email,
    displayName: String(data.displayName ?? data.name ?? ''),
    role,
    status: (data.status as UserStatus) ?? 'pending',
    photoURL: data.photoURL ? String(data.photoURL) : undefined,
  }
}

async function ensureProfile(firebaseUser: User, requestedName?: string): Promise<AppUser> {
  const ref = doc(db, 'users', firebaseUser.uid)
  const snapshot = await getDoc(ref)

  if (snapshot.exists()) {
    await updateDoc(ref, { lastLoginAt: serverTimestamp() })
    return normalizeProfile(firebaseUser.uid, snapshot.data())
  }

  const email = (firebaseUser.email ?? '').trim().toLowerCase()
  const role = officialRoleForEmail(email)
  const isPrimaryAdmin = role === 'master'
  const profile: AppUser = {
    uid: firebaseUser.uid,
    email,
    displayName: requestedName?.trim() || firebaseUser.displayName || email.split('@')[0] || 'Usuário',
    role,
    status: isPrimaryAdmin ? 'active' : 'pending',
    photoURL: firebaseUser.photoURL ?? undefined,
  }

  await setDoc(ref, {
    ...profile,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  })

  return profile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true)
      try {
        setUser(firebaseUser)
        if (!firebaseUser) {
          setProfile(null)
          return
        }
        setProfile(await ensureProfile(firebaseUser))
      } finally {
        setLoading(false)
      }
    })
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    signInEmail: async (email, password) => {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
      setProfile(await ensureProfile(credential.user))
    },
    registerEmail: async (name, email, password) => {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      setProfile(await ensureProfile(credential.user, name))
    },
    signInGoogle: async () => {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const credential = await signInWithPopup(auth, provider)
      setProfile(await ensureProfile(credential.user))
    },
    logout: async () => {
      await signOut(auth)
      setProfile(null)
    },
  }), [loading, profile, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
