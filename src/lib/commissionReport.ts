/** Relatório de Comissões no mesmo modelo do app relatorio-comissao-agentes (puro, sem Firebase). */

export const COMMISSION_REPORT_TITLE = 'Relatório de Comissões - Marques & Müller'

const SUFFIX = '(Participação no Processo - Alvará/Acordo)'
/** Agentes com nome completo e conta contábil (Plano de Contas 4.02.03.xx), como no app de relatórios. */
export const COMMISSION_AGENTS: { name: string; account: string; aliases: string[] }[] = [
  { name: 'Alexandre Couto', account: '4.02.03.02 - Alexandre Couto', aliases: ['ALEXANDRE'] },
  { name: 'Ana Beatriz Stei', account: '4.02.03.03 - Ana Beatriz Stei', aliases: ['ANA BEATRIZ'] },
  { name: 'Ana Paula Azeredo', account: '4.02.03.04 - Ana Paula Azeredo', aliases: ['ANA PAULA'] },
  { name: 'Ana Rodrigues', account: '4.02.03.05 - Ana Rodrigues', aliases: [] },
  { name: 'Debora Moura', account: '4.02.03.06 - Debora Moura', aliases: ['DEBORA'] },
  { name: 'Expedictus', account: '4.02.03.07 - Expedictus', aliases: [] },
  { name: 'Isabela Moraes', account: '4.02.03.08 - Isabela Moraes', aliases: ['ISABELA', 'ISABELLA'] },
  { name: 'Jamily Silva', account: '4.02.03.09 - Jamily Silva', aliases: ['JAMILY'] },
  { name: 'Vanessa', account: '4.02.03.10 - Vanessa', aliases: [] },
  { name: 'Leonardo Jun', account: '4.02.03.11 - Leonardo Jun', aliases: ['LEO JUN', 'LEONARDO', 'LEO'] },
  { name: 'Marcio Mesquita', account: '4.02.03.12 - Marcio Mesquita', aliases: ['MARCIO'] },
  { name: 'Massau Veronez', account: '4.02.03.13 - Massau Veronez', aliases: ['MASSAU'] },
  { name: 'Nadja Costa', account: '4.02.03.14 - Nadja Costa', aliases: ['NADJA'] },
  { name: 'Pedro Villela', account: '4.02.03.15 - Pedro Villela', aliases: ['PEDRO'] },
  { name: 'Rafael Ciminelli', account: '4.02.03.16 - Rafael Ciminelli', aliases: ['RAFAEL'] },
  { name: 'Reinaldo Freire', account: '4.02.03.17 - Reinaldo Freire', aliases: ['REINALDO'] },
  { name: 'Romulo Pimentel', account: '4.02.03.18 - Romulo Pimentel', aliases: ['ROMULO'] },
  { name: 'Ronald Bragion', account: '4.02.03.19 - Ronald Bragion', aliases: ['RONALD'] },
  { name: 'Willian Larangeira', account: '4.02.03.20 - W. Larangeira', aliases: ['WILLIAN', 'WILIAM', 'WILLIAM', 'WILIAN'] },
  { name: 'Walter Brajowicht', account: '4.02.03.21 - Walter Brajowi', aliases: ['WALTER'] },
  { name: 'Tais', account: '4.02.03.22 - Tais', aliases: [] },
  { name: 'Solange', account: '4.02.03.23 - Solange', aliases: [] },
  { name: 'Michael', account: '4.02.03.24 - Michael', aliases: [] },
]

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** "COMISSÃO / WALTER" → Walter Brajowicht + conta 4.02.03.21. Sem correspondência, mantém o texto. */
export function resolveAgent(raw: unknown): { name: string; account: string } {
  const text = plain(String(raw ?? '')).replace(/^COMISSAO\s*(DE\s+AGENTE)?\s*[/:\-–]\s*/, '').replace(/^AGENTE\s*[/:\-–]?\s*/, '').trim()
  if (!text) return { name: '—', account: '—' }
  const found = COMMISSION_AGENTS.find((agent) => plain(agent.name) === text || agent.aliases.some((alias) => alias === text))
    ?? COMMISSION_AGENTS.find((agent) => text.startsWith(plain(agent.name)) || agent.aliases.some((alias) => text.split(' ')[0] === alias))
  if (!found) return { name: String(raw ?? '').replace(/^\s*comiss[aã]o\s*\/\s*/i, '').trim() || '—', account: '—' }
  return { name: found.name, account: `${found.account} ${SUFFIX}` }
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
export function buildCommissionReport(items: CommissionReportInput[]): ReportGroup[] {
  const byAgent = new Map<string, { agent: { name: string; account: string }; months: Map<string, CommissionReportInput[]> }>()
  for (const item of items) {
    const agent = resolveAgent(item.agent)
    if (item.accountOverride && item.accountOverride.trim()) agent.account = item.accountOverride.trim()
    const key = plain(agent.name)
    const entry = byAgent.get(key) ?? { agent, months: new Map() }
    if (entry.agent.account === '—' && agent.account !== '—') entry.agent.account = agent.account
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
