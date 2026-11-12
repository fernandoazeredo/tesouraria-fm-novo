import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getCurrentInstitutionalSettings } from '../hooks/useInstitutionalSettings'

/**
 * Contas bancárias do escritório. Cadastradas pelo Fernando em Configurações → Bancos e Contas
 * (Firestore appConfig/bankAccounts). Enquanto nada for salvo, valem as contas iniciais abaixo.
 */
export type BankAccount = {
  id: string
  bank: string
  agency: string
  account: string
  holder: string
  holderType: 'PJ' | 'PF / Sócio'
  active?: boolean
}

export const INITIAL_BANK_ACCOUNTS: BankAccount[] = [
  { id: 'itau', bank: 'Itaú', agency: '8548', account: '26486-3', holder: '', holderType: 'PJ', active: true },
  { id: 'bb', bank: 'Banco do Brasil', agency: '5974-9', account: '5875-0', holder: 'FLAVIO MARQUES DE SOUZA', holderType: 'PF / Sócio', active: true },
  { id: 'cef', bank: 'Caixa Econômica Federal', agency: '3131', account: '1000225249', holder: 'FLAVIO MARQUES DE SOUZA', holderType: 'PF / Sócio', active: true },
]

export const DEFAULT_BANK_ACCOUNT_ID = 'itau'

let currentAccounts: BankAccount[] = INITIAL_BANK_ACCOUNTS
const listeners = new Set<(accounts: BankAccount[]) => void>()
let unsubscribe: (() => void) | null = null

export function sanitizeBankAccounts(raw: unknown): BankAccount[] {
  if (!Array.isArray(raw)) return INITIAL_BANK_ACCOUNTS
  const list = raw.map((item) => {
    const value = (item ?? {}) as Record<string, unknown>
    return {
      id: String(value.id || '').trim(),
      bank: String(value.bank || '').trim(),
      agency: String(value.agency || '').trim(),
      account: String(value.account || '').trim(),
      holder: String(value.holder || '').trim(),
      holderType: value.holderType === 'PF / Sócio' ? 'PF / Sócio' : 'PJ',
      active: value.active !== false,
    } as BankAccount
  }).filter((item) => item.id && item.bank)
  return list.length ? list : INITIAL_BANK_ACCOUNTS
}

function startListening() {
  if (unsubscribe) return
  unsubscribe = onSnapshot(doc(db, 'appConfig', 'bankAccounts'), (snapshot) => {
    currentAccounts = snapshot.exists() ? sanitizeBankAccounts(snapshot.data().accounts) : INITIAL_BANK_ACCOUNTS
    listeners.forEach((listener) => listener(currentAccounts))
  }, () => { /* mantém a última lista conhecida */ })
}

/** Todas as contas cadastradas (inclusive inativas), para resolver lançamentos antigos. */
export function getBankAccounts() { return currentAccounts }

/** Lista ao vivo das contas. `onlyActive` filtra as que aparecem nos menus suspensos. */
export function useBankAccounts(onlyActive = true) {
  const [accounts, setAccounts] = useState<BankAccount[]>(currentAccounts)
  useEffect(() => {
    startListening()
    listeners.add(setAccounts)
    setAccounts(currentAccounts)
    return () => { listeners.delete(setAccounts) }
  }, [])
  return onlyActive ? accounts.filter((item) => item.active !== false) : accounts
}

/** Converte os ids antigos (itau-pj, bb-pf, cef-pf) para os ids atuais. */
export function normalizeBankAccountId(id: string | null | undefined): string {
  const value = String(id || '').trim()
  if (value === 'itau-pj' || !value) return 'itau'
  if (value === 'bb-pf') return 'bb'
  if (value === 'cef-pf') return 'cef'
  return value
}

export function holderOf(account: BankAccount) {
  return account.holder || (account.holderType === 'PJ' ? getCurrentInstitutionalSettings().razaoSocial || 'FLÁVIO MARQUES ADVOGADOS ASSOCIADOS' : '')
}

/** Conta pelo id, com o titular resolvido (PJ sem titular = Razão Social). */
export function getBankAccount(id: string | null | undefined): BankAccount {
  const normalizedId = normalizeBankAccountId(id)
  const found = currentAccounts.find((item) => item.id === normalizedId)
    ?? INITIAL_BANK_ACCOUNTS.find((item) => item.id === normalizedId)
    ?? currentAccounts.find((item) => item.active !== false)
    ?? currentAccounts[0]
  return { ...found, holder: holderOf(found) }
}

export function bankAccountLabel(account: BankAccount) {
  return `${account.bank} — Ag. ${account.agency} — C/C ${account.account}${account.active === false ? ' (inativa)' : ''}`
}
