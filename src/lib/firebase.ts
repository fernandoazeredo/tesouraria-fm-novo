import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

/**
 * Configuração pública do Firebase Web App do TESOURARIA FM NOVO.
 *
 * Este projeto é dedicado exclusivamente ao aplicativo FM NOVO,
 * mantendo Auth, Firestore, Storage e Hosting isolados do MM e dos
 * demais projetos Firebase.
 *
 * As variáveis VITE_* podem sobrescrever os valores abaixo quando
 * desejarmos usar outro ambiente no futuro.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDpBeBUEn8RRFLNM3aTmT4g9F31pe7H9so',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'tesouraria-fm-novo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'tesouraria-fm-novo',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'tesouraria-fm-novo.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '753261410306',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:753261410306:web:3e941ba1ce07ebe65ecf1b',
}

export const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)

// Os controles financeiros possuem metadados opcionais por parcela
// (aprovação, baixa, usuário responsável). O Firestore deve ignorar campos
// opcionais ainda não preenchidos, sem transformar isso em erro de gravação.
let firestoreDb
try {
  firestoreDb = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true })
} catch {
  firestoreDb = getFirestore(firebaseApp)
}
export const db = firestoreDb

export const storage = getStorage(firebaseApp)
export const firebaseProjectId = firebaseConfig.projectId
