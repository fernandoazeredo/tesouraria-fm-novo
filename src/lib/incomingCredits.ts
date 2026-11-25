/** Confirmação de Entradas: regras puras (sem Firebase). */
import type { ParsedOfx } from './ofx'

export type IncomingCredit = { id: string; date: string; amount: number; memo: string; name: string; fitId: string; refNum: string; matchedReceivableId?: string | null; matchedByName?: string }
type Row = { id: string } & Record<string, any>

/** Só entradas reais do extrato (créditos conciliáveis); saídas, saldos e aplicações automáticas ficam de fora. */
export function creditsFromOfx(parsed: ParsedOfx) {
  return parsed.transactions
    .filter((t) => t.movementClass === 'conciliavel' && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => ({ id: `itau__${t.identityKey}`, date: t.date, amount: Math.round(t.amount * 100) / 100, memo: t.memo || '', name: t.name || '', fitId: t.fitId || '', refNum: t.refNum || '' }))
}

const cents = (v: unknown) => Math.round(Number(v || 0) * 100)
const dayDiff = (a: string, b: string) => !a || !b ? 9999 : Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000

/** Receitas previstas (enviadas à Tesouraria) que podem ser confirmadas por crédito único. Acordos parcelados ficam de fora. */
export const confirmableReceivables = (rows: Row[]) => rows.filter((r) => r.status === 'enviado_tesouraria' && String(r.tipoRecebimento || '') !== 'acordo_trabalhista' && cents(r.valorAlvara) > 0)

/** Créditos livres com o mesmo valor (ao centavo), do mais próximo da data prevista ao mais distante. */
export function suggestCredits(receivable: Row, credits: IncomingCredit[]) {
  const target = cents(receivable.valorAlvara)
  const expected = String(receivable.dataPrevista || '').slice(0, 10)
  return credits.filter((c) => !c.matchedReceivableId && cents(c.amount) === target)
    .sort((a, b) => dayDiff(a.date, expected) - dayDiff(b.date, expected) || a.date.localeCompare(b.date))
}
