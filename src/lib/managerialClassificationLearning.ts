import type { ChartOfAccount } from '../data/chartOfAccounts'
import { mmExpenseSeedSuggestion } from './mmExpenseSeedKnowledge'

export type LearningSourceType = 'expense' | 'revenue'

export type LearningClassification = {
  id?: string
  sourceType?: LearningSourceType
  sourceId?: string
  sourceCounterparty?: string
  sourceDescription?: string
  accountCode?: string
  confirmed?: boolean
}

type Suggestion = {
  account: ChartOfAccount | null
  confidence: number
  reason: string
}

type ClassificationInput = {
  type: LearningSourceType
  sourceId: string
  sourceAccountCode: string
  counterparty: string
  description: string
  origin?: unknown
  nature?: unknown
  history: readonly LearningClassification[]
  accounts: readonly ChartOfAccount[]
}

const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const contains = (text: string, phrase: string) => Boolean(phrase) && ` ${text} `.includes(` ${phrase} `)
const stopWords = new Set('para com sem das dos uma por referente pagamento recebimento despesa receita fornecedor escritorio demonstrativo servico servicos conta fatura'.split(' '))
const terms = (text: string) => new Set(text.split(' ').filter(word => word.length >= 4 && !stopWords.has(word) && !/^\d+$/.test(word)))

function withoutCounterparty(description: unknown, counterparty: unknown) {
  const text = normalize(description)
  const name = normalize(counterparty)
  return contains(text, name) ? ` ${text} `.replaceAll(` ${name} `, ' ').trim() : text
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  const common = [...left].filter(word => right.has(word)).length
  return common / Math.max(left.size, right.size)
}

export function managerialAccounts(chart: readonly ChartOfAccount[], type: LearningSourceType) {
  const category = type === 'expense' ? 'Despesa' : 'Receita'
  return chart.filter(account => account.kind === 'account' && account.category === category
    && (type !== 'expense' || account.dre !== 'Não mostrar no DRE Gerencial'))
}

const expenseSignals = [
  { terms: ['conta de luz', 'energia eletrica', 'eletricidade'], code: '4.07.05' },
  { terms: ['telefonia fixa', 'telefone fixo', 'internet', 'banda larga'], code: '4.05.27' },
  { terms: ['telefonia movel', 'telefone celular', 'linha movel', 'celular'], code: '4.05.28' },
  { terms: ['conta de agua', 'agua e saneamento', 'saneamento'], code: '4.07.01' },
]

export function suggestManagerialClassification(input: ClassificationInput): Suggestion {
  const { type, sourceId, sourceAccountCode, counterparty, description, origin, nature, history, accounts } = input
  const byCode = new Map(accounts.map(account => [account.code, account]))
  const stored = byCode.get(sourceAccountCode)
  if (stored) return { account: stored, confidence: 100, reason: 'Classificação já existente no lançamento' }

  const text = withoutCounterparty(description, counterparty)
  const nameMatches = accounts.filter(account => contains(text, normalize(account.name)))
  const specificNames = nameMatches.filter(account => !nameMatches.some(other => other !== account
    && normalize(other.name) !== normalize(account.name) && contains(normalize(other.name), normalize(account.name))))
  const explicit = new Map(specificNames.map(account => [account.code, account]))
  if (type === 'expense') {
    for (const signal of expenseSignals) {
      const account = byCode.get(signal.code)
      if (account && signal.terms.some(word => contains(text, word))) explicit.set(account.code, account)
    }
  } else {
    const source = normalize(origin)
    const area = normalize(nature)
    const code = area.includes('trabalh') ? (contains(source, 'alvara') ? '3.01.04' : contains(source, 'acordo') ? '3.01.05' : '')
      : contains(area, 'civil') ? '3.01.02' : ''
    const account = byCode.get(code)
    if (account) explicit.set(code, account)
  }
  if (explicit.size === 1) return { account: [...explicit.values()][0], confidence: 98, reason: 'Correspondência direta com a descrição ou a origem do lançamento' }
  if (explicit.size > 1) return { account: null, confidence: 0, reason: 'A descrição indica mais de uma conta. Confira os itens do lançamento.' }

  const currentTerms = terms(text)
  const supplier = normalize(counterparty)
  const confirmed = history.filter(record => record.confirmed && record.sourceType === type
    && record.sourceId !== sourceId && byCode.has(record.accountCode ?? ''))
  const sameSupplier = supplier ? confirmed.filter(record => normalize(record.sourceCounterparty) === supplier) : []
  const bestHistory = new Map<string, number>()
  for (const record of confirmed) {
    const score = similarity(currentTerms, terms(withoutCounterparty(record.sourceDescription, record.sourceCounterparty)))
    if (score < 0.55 || !record.accountCode) continue
    bestHistory.set(record.accountCode, Math.max(score, bestHistory.get(record.accountCode) ?? 0))
  }
  const ranked = [...bestHistory.entries()].sort((a, b) => b[1] - a[1])
  const [top, runnerUp] = ranked
  if (top && runnerUp && top[1] - runnerUp[1] < 0.12) return { account: null, confidence: 0, reason: 'O histórico indica mais de uma conta. Selecione a que se aplica.' }
  if (top) return { account: byCode.get(top[0])!, confidence: top[1] >= 0.72 ? 92 : 82, reason: 'Descrição semelhante à de um lançamento confirmado' }

  if (type === 'expense') {
    const seeded = mmExpenseSeedSuggestion({ counterparty, description: text, accounts })
    if (seeded) return seeded
  }
  const nameScores = accounts.map(account => ({
    account,
    hits: [...terms(normalize(account.name))].filter(term => currentTerms.has(term)).length,
  })).filter(match => match.hits > 0).sort((a, b) => b.hits - a.hits)
  const [bestName, nextName] = nameScores
  if (bestName && bestName.hits > (nextName?.hits ?? 0)) return {
    account: bestName.account,
    confidence: bestName.hits >= 2 ? 82 : 58,
    reason: 'Correspondência por palavras da descrição. Confira a conta.',
  }
  if (bestName) return { account: null, confidence: 0, reason: 'Mais de uma conta corresponde à descrição. Selecione a que se aplica.' }

  // O fornecedor serve como indicação quando o lançamento não descreve o serviço.
  const supplierCodes = new Set(sameSupplier.map(record => record.accountCode))
  if (!currentTerms.size && sameSupplier.length >= 2 && supplierCodes.size === 1) {
    return { account: byCode.get(sameSupplier[0].accountCode!)!, confidence: 65, reason: 'Padrão confirmado do fornecedor. Confira o serviço antes de gravar.' }
  }
  return { account: null, confidence: 0, reason: 'Sem correspondência suficiente para sugerir uma conta.' }
}
