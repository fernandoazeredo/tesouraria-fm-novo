import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { officialChartOfAccounts } from '../functions/chart-of-accounts.js'

function load(file, dependencies = {}) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency ' + name)
      return dependencies[name]
    },
  })
  return exports
}

const seeds = load('../src/lib/mmExpenseSeedKnowledge.ts')
const { managerialAccounts, suggestManagerialClassification } = load('../src/lib/managerialClassificationLearning.ts', {
  './mmExpenseSeedKnowledge': seeds,
})
const { storedToChart } = load('../src/data/chartOfAccounts.ts', {
  '../../functions/chart-of-accounts.js': { officialChartOfAccounts },
})
const supplier = 'Fornecedor fictício'
const olderPhoneBill = {
  sourceId: 'antigo', sourceType: 'expense', sourceCounterparty: supplier,
  sourceDescription: 'Serviço de telefonia fixa', accountCode: '4.05.27', confirmed: true,
}
const suggest = (description, overrides = {}) => suggestManagerialClassification({
  type: 'expense', sourceId: 'novo', sourceAccountCode: '', counterparty: supplier, description,
  history: [olderPhoneBill], accounts: managerialAccounts(officialChartOfAccounts, 'expense'), ...overrides,
})

test('conta de luz prevalece sobre o histórico de telefonia do mesmo fornecedor', () => {
  assert.equal(suggest('Conta de luz do escritório RJ').account?.code, '4.07.05')
  assert.equal(suggest('Serviço de telefonia fixa').account?.code, '4.05.27')
  assert.equal(suggest('Fatura de telefone celular').account?.code, '4.05.28')
})

test('indícios de duas contas no mesmo lançamento exigem escolha manual', () => {
  const proposal = suggest('Conta de luz · fatura de internet')
  assert.equal(proposal.account, null)
  assert.match(proposal.reason, /mais de uma conta/)
})

test('o plano importado controla as sugestões, inclusive para contas novas', () => {
  const imported = storedToChart({ code: '4.98.01', name: 'Calibração de equipamentos', dre: 'Despesas Administrativas', kind: 'account' })
  const group = storedToChart({ code: '4.98', name: 'Equipamentos', kind: 'group' })
  const accounts = managerialAccounts([imported, group], 'expense')
  assert.deepEqual(Array.from(accounts, account => account.code), ['4.98.01'])
  assert.equal(suggest('Calibração de equipamentos de teste', { accounts }).account?.code, '4.98.01')
  assert.equal(suggest('Conta de luz', { accounts }).account, null)
})

test('um lançamento sem descrição não herda a conta de um único registro anterior', () => {
  assert.equal(suggest('Demonstrativo de despesa').account, null)
  assert.equal(suggest('Demonstrativo de despesa', { history: [olderPhoneBill, { ...olderPhoneBill, sourceId: 'outro' }] }).account?.code, '4.05.27')
})

test('descrições idênticas com contas diferentes no histórico exigem revisão', () => {
  const historical = accountCode => ({ ...olderPhoneBill, sourceDescription: 'Registro revisão técnica mensal', accountCode })
  assert.equal(suggest('Registro revisão técnica mensal', { history: [historical('4.05.27'), historical('4.07.05')] }).account, null)
})

test('receitas trabalhistas consultam os códigos do plano vigente', () => {
  const accounts = managerialAccounts(officialChartOfAccounts, 'revenue')
  const suggestRevenue = (origin, active) => suggestManagerialClassification({
    type: 'revenue', sourceId: 'novo', sourceAccountCode: '', counterparty: 'Cliente fictício', description: '',
    origin, nature: 'Trabalhista', history: [], accounts: active,
  })
  assert.equal(suggestRevenue('Alvará judicial', accounts).account?.code, '3.01.04')
  assert.equal(suggestRevenue('Acordo trabalhista', accounts).account?.code, '3.01.05')
  assert.equal(suggestRevenue('Acordo trabalhista', accounts.filter(account => account.code !== '3.01.05')).account, null)
})
