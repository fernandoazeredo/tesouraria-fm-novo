/** Apuração societária sobre honorários líquidos de impostos.
 * Valores são arredondados a centavos em cada etapa; a quota de Ana é o complemento
 * para impedir divergência de centavos na soma das duas quotas.
 */
export const SOCIETARY_TAX_BASIS_POINTS = 1133 // 11,33%
function cents(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Valor monetário inválido')
  return Math.round(value * 100)
}
export function calculateSocietaryDistribution(officeFees: number) {
  const grossCents = cents(officeFees)
  const taxCents = Math.round(grossCents * SOCIETARY_TAX_BASIS_POINTS / 10000)
  const netCents = grossCents - taxCents
  const flavioCents = Math.round(netCents * 60 / 100)
  const anaCents = netCents - flavioCents
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
