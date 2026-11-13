import type { ChartOfAccount } from '../data/chartOfAccounts'

export type MmSeedSuggestion = {
  account: ChartOfAccount
  confidence: number
  reason: string
}

type SeedRule = {
  label: string
  suppliers?: string[]
  all?: string[]
  any?: string[]
  accountFragments: string[]
  confidence: number
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function expenseAccountByFragments(fragments: string[], accounts: readonly ChartOfAccount[]) {
  for (const fragment of fragments) {
    const needle = normalized(fragment)
    const matching = accounts.filter((account) => ` ${normalized(account.name)} `.includes(` ${needle} `))
    const exact = matching.find(account => normalized(account.name) === needle)
    if (exact) return exact
    if (matching.length === 1) return matching[0]
  }
  return null
}

// Base inicial extraída do padrão real de despesas MM de julho/2026.
// Ela só sugere contas que existem no Plano de Contas vigente; nunca cria códigos.
const seedRules: SeedRule[] = [
  { label: 'FGTS', any: ['fgts'], accountFragments: ['fgts'], confidence: 96 },
  { label: 'INSS', any: ['inss'], accountFragments: ['inss'], confidence: 96 },
  { label: 'ISS', any: ['darm iss', 'iss sobre', 'pagamento iss'], accountFragments: ['iss'], confidence: 97 },
  { label: 'IRPJ / CSLL', all: ['irpj', 'csll'], accountFragments: ['irpj', 'csll'], confidence: 98 },
  { label: 'PIS / COFINS', all: ['pis', 'cofins'], accountFragments: ['pis', 'cofins'], confidence: 98 },
  { label: 'IRRF / Retenções', any: ['irrf', 'codigo 1708', 'retenção nf', 'retencao nf'], accountFragments: ['irrf', 'retenc'], confidence: 97 },
  { label: 'IPTU', any: ['iptu'], accountFragments: ['iptu'], confidence: 97 },
  { label: 'Folha de Pagamento', any: ['folha de pagamento', 'salarios', 'salário', 'salario'], accountFragments: ['salario', 'folha'], confidence: 97 },
  { label: 'Plano de Saúde', suppliers: ['amil', 'sul america', 'assim'], any: ['plano de saude', 'assistencia medica', 'plano medico'], accountFragments: ['plano de saude', 'assistencia medica'], confidence: 97 },
  { label: 'Seguro de Vida', suppliers: ['prudential', 'seguro itau empresas'], any: ['seguro de vida', 'vida global'], accountFragments: ['seguro de vida'], confidence: 96 },
  { label: 'Vale-Transporte', suppliers: ['jae', 'mais mobi'], any: ['vale transporte', 'bilhete unico', 'recarga'], accountFragments: ['vale transporte'], confidence: 97 },
  { label: 'Treinamento e Capacitação', suppliers: ['hotmart'], any: ['curso', 'treinamento', 'capacitacao'], accountFragments: ['treinamento', 'curso'], confidence: 95 },
  { label: 'Energia Elétrica', suppliers: ['light', 'eletropaulo'], any: ['conta de luz', 'energia eletrica'], accountFragments: ['energia'], confidence: 98 },
  { label: 'Condomínio', any: ['condominio'], accountFragments: ['condominio'], confidence: 97 },
  { label: 'Aluguel', any: ['aluguel'], accountFragments: ['aluguel'], confidence: 96 },
  { label: 'Telefonia / Internet', suppliers: ['vivo', 'tim', 'claro', 'embratel', 'mundivox'], any: ['telefone', 'telefonia', 'internet', 'acesso a internet'], accountFragments: ['telefone', 'telefonia', 'internet'], confidence: 97 },
  { label: 'Sistemas / Assinaturas', suppliers: ['thomson reuters', 'legal one', 'snd distrib', 'iprazos', 'iob', 'ikatec', 'assertiva'], any: ['sistema', 'licenca', 'assinatura', 'publicacoes no diario oficial', 'plano base'], accountFragments: ['software', 'sistema', 'assinatura'], confidence: 97 },
  { label: 'TI / Suporte / Backup', suppliers: ['asox'], any: ['suporte de informatica', 'backup', 'sharepoint'], accountFragments: ['informatica', 'suporte', 'backup'], confidence: 97 },
  { label: 'Estacionamento', any: ['estacionamento'], accountFragments: ['estacionamento'], confidence: 96 },
  { label: 'Material de Limpeza e Higiene', suppliers: ['higi365', 'supribem'], any: ['material de limpeza', 'papel toalha', 'papel higienico', 'detergente', 'desinfetante'], accountFragments: ['material de limpeza', 'limpeza'], confidence: 96 },
  { label: 'Limpeza', any: ['faxina'], accountFragments: ['limpeza', 'faxina'], confidence: 96 },
  { label: 'Manutenção / Reparos', suppliers: ['mabrime'], any: ['manutencao', 'reparo', 'troca de lampada', 'torneira'], accountFragments: ['manutencao', 'reparo'], confidence: 95 },
  { label: 'Honorários Contábeis', suppliers: ['quality servicos contabeis'], any: ['honorarios contabeis', 'contabilidade'], accountFragments: ['honorarios contabeis', 'contab'], confidence: 98 },
  { label: 'Honorários Periciais', suppliers: ['baptista souza'], any: ['honorarios periciais', 'calculos de liquidacao'], accountFragments: ['honorarios periciais', 'periciais'], confidence: 98 },
  { label: 'Correspondente / Audiência', any: ['honorario referente a audiencia', 'correspondente', 'audiencia realizada'], accountFragments: ['correspondente', 'audiencia'], confidence: 95 },
  { label: 'Participação em Processos', any: ['participacao ao final', 'participacao em processos', 'participação ao final'], accountFragments: ['participacao no processo', 'participacao'], confidence: 98 },
  { label: 'Transporte / Audiência', suppliers: ['expedictus'], any: ['transporte', 'audiencia', 'onibus', 'metro', 'taxi', 'uber'], accountFragments: ['transporte', 'deslocamento'], confidence: 95 },
  { label: 'Uber / Transporte', any: ['uber', 'despesa de uber'], accountFragments: ['uber', 'transporte'], confidence: 94 },
  { label: 'Combustível / KM', all: ['combustivel'], any: ['km', 'quilometragem'], accountFragments: ['combustivel', 'quilometragem'], confidence: 95 },
  { label: 'Confraternização', any: ['festa junina', 'confraternizacao'], accountFragments: ['confraternizacao', 'festas'], confidence: 96 },
  { label: 'Deslocamento Externo', any: ['deslocamento', 'atendimento externo', 'pegar assinatura', 'assinatura de contrato'], accountFragments: ['deslocamento', 'transporte'], confidence: 91 },
  { label: 'Depósito Judicial', all: ['deposito judicial'], accountFragments: ['deposito judicial'], confidence: 99 },
]

export function mmExpenseSeedSuggestion(args: { counterparty: string; description: string; accounts: readonly ChartOfAccount[] }): MmSeedSuggestion | null {
  const supplier = normalized(args.counterparty)
  const text = normalized(args.description)
  const includes = (haystack: string, value: string) => ` ${haystack} `.includes(` ${normalized(value)} `)

  for (const rule of seedRules) {
    const supplierMatch = Boolean(rule.suppliers?.some((value) => includes(supplier, value)))
    const allMatch = !rule.all?.length || rule.all.every((value) => includes(text, value))
    const anyMatch = !rule.any?.length || rule.any.some((value) => includes(text, value))
    const hasRequiredSignal = Boolean(rule.suppliers?.length ? supplierMatch : true) && allMatch && anyMatch
    if (!hasRequiredSignal) continue

    const account = expenseAccountByFragments(rule.accountFragments, args.accounts)
    if (!account) continue
    return { account, confidence: rule.confidence, reason: `Base inicial MM: ${rule.label}` }
  }

  return null
}
