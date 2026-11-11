export { OFFICIAL_CHART_OF_ACCOUNTS_VERSION, OFFICIAL_CHART_OF_ACCOUNTS_SOURCE, officialChartOfAccounts, type ChartOfAccount } from '../../functions/chart-of-accounts.js'

import type { ChartOfAccount } from '../../functions/chart-of-accounts.js'

export function categoryFromCode(code: string): ChartOfAccount['category'] {
  if (code.startsWith('3.')) return 'Receita'
  if (code.startsWith('4.')) return 'Despesa'
  return 'Patrimonial / Dívida'
}

export function storedToChart(item: Record<string, unknown>): ChartOfAccount | null {
  const code = String(item.code ?? '').trim()
  const name = String(item.name ?? '').trim()
  if (!code || !name) return null
  return {
    code,
    name,
    dre: item.dre ? String(item.dre) : null,
    parentCode: item.parentCode ? String(item.parentCode) : null,
    level: Number(item.level ?? code.split('.').length),
    kind: item.kind === 'group' ? 'group' : 'account',
    category: ['Receita', 'Despesa', 'Patrimonial / Dívida'].includes(String(item.category))
      ? item.category as ChartOfAccount['category']
      : categoryFromCode(code),
  }
}
