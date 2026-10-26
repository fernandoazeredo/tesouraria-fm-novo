import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSocietaryDistribution } from '../src/lib/societaryDistribution.ts'

test('Alvará de 150 mil, cliente 50 mil: imposto e 40/60 sobre honorários', () => {
  const gross = 150000
  const client = 50000
  const result = calculateSocietaryDistribution(gross - client)
  assert.deepEqual(result, {
    officeFees: 100000,
    taxPercent: 11.33,
    taxes: 11330,
    netFees: 88670,
    flavioPercent: 60,
    flavioShare: 53202,
    anaPercent: 40,
    anaShare: 35468,
  })
})
test('O imposto é cobrado apenas sobre honorários, nunca sobre a parte do cliente', () => {
  const value = calculateSocietaryDistribution(30000)
  assert.equal(value.taxes,3399)
  assert.equal(value.netFees,26601)
  assert.equal(value.anaShare,10640.4)
})
test('As parcelas divididas sempre recompõem a base líquida ao centavo', () => {
  for (const amount of [0, 0.01, 0.02, 123.45, 9999.99, 100000]) {
    const x = calculateSocietaryDistribution(amount)
    assert.equal(Math.round((x.anaShare+x.flavioShare)*100),Math.round(x.netFees*100))
  }
})
test('Valor inválido não permite apuração', () => {
  assert.throws(()=>calculateSocietaryDistribution(-10))
})
