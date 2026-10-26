/** Apuração societária sobre honorários líquidos de impostos.
 * Valores são arredondados a centavos em cada etapa; a quota de Ana é o complemento
 * para impedir divergência de centavos na soma das duas quotas.
 */
export const SOCIETARY_TAX_BASIS_POINTS = 1133 // 11,33%
function cents(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Valor monetário inválido')
  return Math.round(value * 100)
}
/** Arredondamento homologado: terceira casa decimal de 0 a 5 desce, 6 a 9 sobe. */
function roundFinance(amountCents: number, basisPoints: number) {
  const numerator = BigInt(amountCents) * BigInt(basisPoints)
  const denominator = 10000n
  let result = numerator / denominator
  const thirdDigit = Number(((numerator % denominator) * 10n) / denominator)
  if (thirdDigit >= 6) result += 1n
  return Number(result)
}
export function calculateSocietaryDistribution(officeFees: number) {
  const grossCents = cents(officeFees)
  const taxCents = roundFinance(grossCents, SOCIETARY_TAX_BASIS_POINTS)
  const netCents = grossCents - taxCents
  const anaCents = roundFinance(netCents, 4000)
  const flavioCents = netCents - anaCents
  return {
    officeFees: grossCents / 100,
    taxPercent: 11.33,
    taxes: taxCents / 100,
    netFees: netCents / 100,
    flavioPercent: 60,
    flavioShare: flavioCents / 100,
    anaPercent: 40,
    anaShare: anaCents / 100,
  }
}
