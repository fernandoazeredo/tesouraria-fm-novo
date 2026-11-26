// Dados fixos do escritório no Emissor Nacional da NFS-e, conforme a NFS-e nº 303 (XML de 24/11/2026).
export const NFSE_FIXED_FIELDS: Array<{ label: string; value: string }> = [
  { label: 'Local da prestação / incidência', value: 'Rio de Janeiro/RJ (3304557)' },
  { label: 'Código de Tributação Nacional', value: '17.14.01 — Advocacia' },
  { label: 'Código de Tributação Municipal', value: '001 — Advocacia' },
  { label: 'ISSQN', value: 'Operação tributável — sem retenção' },
  { label: 'Simples Nacional', value: 'Não optante' },
  { label: 'Regime especial', value: 'Sociedade de profissionais' },
  { label: 'PIS/COFINS', value: 'CST 00 — sem retenção' },
  { label: 'Tributos aproximados', value: 'Federais 11,33% · Estaduais 0% · Municipais 0%' },
]

export type NfseDescriptionSource = Record<string, unknown> & {
  natureza?: unknown
  processo?: unknown
  reclamante?: unknown
  titular?: unknown
  reclamada?: unknown
}

const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')

// Mesmo padrão da descrição usada na NFS-e nº 303.
export function buildNfseDescription(source: NfseDescriptionSource) {
  const natureza = clean(source.natureza)
  const processo = clean(source.processo)
  const cliente = clean(source.reclamante) || clean(source.titular)
  const reu = clean(source.reclamada)
  let text = `Recebimento de Honorários Advocatícios Acordo${natureza ? ` ${natureza}` : ''}`
  if (processo) text += ` processo número ${processo}`
  if (cliente && reu) text += `, ${cliente} X ${reu}`
  else if (cliente) text += `, ${cliente}`
  return `${text}.`
}
