export type ChartOfAccount = {
  code: string
  name: string
  dre: string | null
  parentCode: string | null
  level: number
  kind: 'group' | 'account'
  category: 'Receita' | 'Despesa' | 'Patrimonial / Dívida'
}

export const OFFICIAL_CHART_OF_ACCOUNTS_VERSION: '2026-08-19'
export const OFFICIAL_CHART_OF_ACCOUNTS_SOURCE: 'Plano_de_Contas_Flavio_Marques_Atualizado(2).txt'
export const officialChartOfAccounts: ChartOfAccount[]
