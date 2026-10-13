export type BankAccount = {
  id: 'itau' | 'bb' | 'cef' | 'itau-pj' | 'bb-pf' | 'cef-pf'
  bank: string
  agency: string
  account: string
  holder: string
  holderType: 'PJ' | 'PF / Sócio'
}

export const BANK_ACCOUNTS: BankAccount[] = [
  {
    id: 'itau',
    bank: 'Itaú',
    agency: '8548',
    account: '26486-3',
    holder: 'MARQUES & MÜLLER ADVOGADOS ASSOCIADOS',
    holderType: 'PJ',
  },
  {
    id: 'bb',
    bank: 'Banco do Brasil',
    agency: '5974-9',
    account: '5875-0',
    holder: 'FLAVIO MARQUES DE SOUZA',
    holderType: 'PF / Sócio',
  },
  {
    id: 'cef',
    bank: 'Caixa Econômica Federal',
    agency: '3131',
    account: '1000225249',
    holder: 'FLAVIO MARQUES DE SOUZA',
    holderType: 'PF / Sócio',
  },
]

export const DEFAULT_BANK_ACCOUNT_ID: BankAccount['id'] = 'itau'

export function normalizeBankAccountId(id: string | null | undefined): 'itau' | 'bb' | 'cef' {
  if (id === 'bb' || id === 'bb-pf') return 'bb'
  if (id === 'cef' || id === 'cef-pf') return 'cef'
  return 'itau'
}

export function getBankAccount(id: string | null | undefined) {
  const normalizedId = normalizeBankAccountId(id)
  return BANK_ACCOUNTS.find((item) => item.id === normalizedId) ?? BANK_ACCOUNTS[0]
}
