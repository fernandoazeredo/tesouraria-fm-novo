/** Relatório de Comissões no mesmo modelo do app relatorio-comissao-agentes (puro, sem Firebase). */

export const COMMISSION_REPORT_TITLE = 'Relatório de Comissões - Marques & Müller'

/** Agentes: nome completo e código da conta (Plano de Contas 4.02.03.xx). O texto da conta vem do Plano de Contas. */
export const COMMISSION_AGENTS: { name: string; code: string; aliases: string[] }[] = [
  { name: 'Alexandre Couto', code: '4.02.03.02', aliases: ['ALEXANDRE'] },
  { name: 'Ana Beatriz Stei', code: '4.02.03.03', aliases: ['ANA BEATRIZ'] },
  { name: 'Ana Paula Azeredo', code: '4.02.03.04', aliases: ['ANA PAULA'] },
  { name: 'Ana Rodrigues', code: '4.02.03.05', aliases: [] },
  { name: 'Debora Moura', code: '4.02.03.06', aliases: ['DEBORA'] },
  { name: 'Expedictus', code: '4.02.03.07', aliases: [] },
  { name: 'Isabela Moraes', code: '4.02.03.08', aliases: ['ISABELA', 'ISABELLA'] },
  { name: 'Jamily Silva', code: '4.02.03.09', aliases: ['JAMILY'] },
  { name: 'Vanessa', code: '4.02.03.10', aliases: [] },
  { name: 'Leonardo Jun', code: '4.02.03.11', aliases: ['LEO JUN', 'LEONARDO', 'LEO'] },
  { name: 'Marcio Mesquita', code: '4.02.03.12', aliases: ['MARCIO'] },
  { name: 'Massau Veronez', code: '4.02.03.13', aliases: ['MASSAU'] },
  { name: 'Nadja Costa', code: '4.02.03.14', aliases: ['NADJA'] },
  { name: 'Pedro Villela', code: '4.02.03.15', aliases: ['PEDRO'] },
  { name: 'Rafael Ciminelli', code: '4.02.03.16', aliases: ['RAFAEL'] },
  { name: 'Reinaldo Freire', code: '4.02.03.17', aliases: ['REINALDO'] },
  { name: 'Romulo Pimentel', code: '4.02.03.18', aliases: ['ROMULO'] },
  { name: 'Ronald Bragion', code: '4.02.03.19', aliases: ['RONALD'] },
  { name: 'Willian Larangeira', code: '4.02.03.20', aliases: ['WILLIAN', 'WILIAM', 'WILLIAM', 'WILIAN'] },
  { name: 'Walter Brajowicht', code: '4.02.03.21', aliases: ['WALTER'] },
  { name: 'Tais', code: '4.02.03.22', aliases: [] },
  { name: 'Solange', code: '4.02.03.23', aliases: [] },
  { name: 'Michael', code: '4.02.03.24', aliases: [] },
]

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

export type ChartAccount = { code: string; name: string }

/** Conta contábil "código - nome" lida do Plano de Contas (ex.: 4.02.03.21 - Walter Brajowi (Participação…)). */
function accountText(code: string, chart: ChartAccount[]) {
  const found = chart.find((item) => item.code === code)
  // No relatório o nome sai sem o prefixo "Comissão" (ex.: 4.02.03.11 - Leonardo Jun), como no modelo.
  return found ? `${found.code} - ${found.name.replace(/^Comiss[aã]o\s+/i, '')}` : code
}

/** "COMISSÃO / WALTER" → Walter Brajowicht + conta do Plano de Contas. Sem correspondência, mantém o texto. */
export function resolveAgent(raw: unknown, chart: ChartAccount[] = []): { name: string; account: string } {
  const text = plain(String(raw ?? '')).replace(/^COMISSAO\s*(DE\s+AGENTE)?\s*[/:\-–]\s*/, '').replace(/^AGENTE\s*[/:\-–]?\s*/, '').trim()
  if (!text) return { name: '—', account: '—' }
  const first = text.split(' ')[0]
  const found = COMMISSION_AGENTS.find((agent) => plain(agent.name) === text || agent.aliases.some((alias) => alias === text))
    ?? COMMISSION_AGENTS.find((agent) => text.startsWith(plain(agent.name)) || agent.aliases.some((alias) => first === alias))
  if (found) return { name: found.name, account: accountText(found.code, chart) }
  // Agente novo: procura no Plano de Contas (4.02.03.xx) pelo primeiro nome.
  const fromChart = chart.find((item) => item.code.startsWith('4.02.03.') && plain(item.name).replace(/^COMISSAO\s+/, '').split(' ')[0] === first)
  if (fromChart) return { name: fromChart.name.replace(/\s*\(.*\)\s*$/, '').replace(/^Comiss[aã]o\s+/i, ''), account: `${fromChart.code} - ${fromChart.name.replace(/^Comiss[aã]o\s+/i, '')}` }
  const clean = String(raw ?? '').replace(/^\s*comiss[aã]o\s*\/\s*/i, '').trim()
  const titled = clean === clean.toUpperCase() ? clean.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : clean
  return { name: titled || '—', account: '' }
}

export type CommissionReportInput = {
  agent: string
  accountOverride?: string
  date: string // data do alvará (AAAA-MM-DD)
  processo: string
  reclamante: string
  reclamada: string
  gross: number
  deduction: number
  payments: { date: string; value: number }[]
}
export type ReportLine = { date: string; history: string; debit: number; credit: number; balance: number }
export type ReportGroup = { agent: string; account: string; month: string; year: string; previousBalance: number; lines: ReportLine[]; finalBalance: number }

const MONTHS = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO']
const round = (n: number) => Math.round(n * 100) / 100

/** Um relatório por agente e mês do alvará, com saldo anterior dos meses anteriores do mesmo agente. */
export function buildCommissionReport(items: CommissionReportInput[], chart: ChartAccount[] = []): ReportGroup[] {
  const byAgent = new Map<string, { agent: { name: string; account: string }; months: Map<string, CommissionReportInput[]> }>()
  for (const item of items) {
    const agent = resolveAgent(item.agent, chart)
    if (item.accountOverride && item.accountOverride.trim()) agent.account = item.accountOverride.trim()
    const key = plain(agent.name)
    const entry = byAgent.get(key) ?? { agent, months: new Map() }
    if (!entry.agent.account && agent.account) entry.agent.account = agent.account
    const month = /^\d{4}-\d{2}/.test(item.date) ? item.date.slice(0, 7) : '0000-00'
    entry.months.set(month, [...(entry.months.get(month) ?? []), item])
    byAgent.set(key, entry)
  }
  const groups: ReportGroup[] = []
  for (const { agent, months } of [...byAgent.values()].sort((a, b) => a.agent.name.localeCompare(b.agent.name, 'pt-BR'))) {
    let carried = 0
    for (const month of [...months.keys()].sort()) {
      const list = [...months.get(month)!].sort((a, b) => a.reclamante.localeCompare(b.reclamante, 'pt-BR') || a.date.localeCompare(b.date))
      const lines: ReportLine[] = []
      let balance = carried
      for (const item of list) {
        const autor = `${item.reclamante || '—'} x ${item.reclamada || '—'}`
        if (item.gross > 0) { balance = round(balance + item.gross); lines.push({ date: item.date, history: `REF. RECEBIMENTO DE HONORÁRIOS PROCESSO Nº ${item.processo || '—'} – Autor: ${autor}`, debit: 0, credit: item.gross, balance }) }
        if (item.deduction > 0) { balance = round(balance - item.deduction); lines.push({ date: item.date, history: `REF. DEDUÇÃO COMPENSATÓRIA PROCESSO Nº ${item.processo || '—'} – Autor: ${autor}`, debit: item.deduction, credit: 0, balance }) }
      }
      const payments = list.flatMap((item) => item.payments).filter((p) => p.value > 0)
      const paid = round(payments.reduce((sum, p) => sum + p.value, 0))
      if (paid > 0) {
        const lastDate = payments.map((p) => p.date).filter(Boolean).sort().pop() || ''
        balance = round(balance - paid)
        lines.push({ date: lastDate, history: 'REF. PAGAMENTO PARTICIPAÇÃO EM DIVERSOS PROCESSOS', debit: paid, credit: 0, balance })
      }
      const [year, mm] = month.split('-')
      groups.push({ agent: agent.name, account: agent.account, month: MONTHS[Number(mm) - 1] || '—', year: year === '0000' ? '—' : year, previousBalance: carried, lines, finalBalance: balance })
      carried = balance
    }
  }
  return groups
}
