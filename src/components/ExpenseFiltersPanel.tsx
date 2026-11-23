import { Filter, RotateCcw, X } from 'lucide-react'
import '../expense-filters.css'

export type ExpenseFilterState = { status: string; competence: string }

export const expenseFilterStatusOptions = [
  ['', 'Todos os status'],
  ['Rascunho', 'Rascunho'],
  ['Enviado para Aprovação', 'Enviado para Aprovação'],
  ['Em Análise', 'Em Análise'],
  ['Aprovado', 'Aprovado'],
  ['Devolvido p/ Correção', 'Devolvido p/ Correção'],
  ['Rejeitado', 'Rejeitado'],
  ['Pago', 'Pago'],
  ['Arquivado', 'Arquivado'],
] as const

/** Painel de filtros de Despesas (Status e Competência), controlado pela página. */
export function ExpenseFiltersPopover({ filters, onChange, onClose, competences, visibleCount }: {
  filters: ExpenseFilterState
  onChange: (filters: ExpenseFilterState) => void
  onClose: () => void
  competences: string[]
  visibleCount: number
}) {
  const activeCount = Number(Boolean(filters.status)) + Number(Boolean(filters.competence))
  return <div className="expense-filter-popover" role="dialog" aria-label="Filtros de despesas">
    <div className="expense-filter-heading">
      <div><Filter size={17} /><strong>Filtros de Despesas</strong></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar filtros"><X size={17} /></button>
    </div>
    <div className="expense-filter-grid">
      <label>
        <span>Status</span>
        <select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value })}>
          {expenseFilterStatusOptions.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>Competência</span>
        <select value={filters.competence} onChange={(event) => onChange({ ...filters, competence: event.target.value })}>
          <option value="">Todas as competências</option>
          {competences.map((competence) => <option key={competence} value={competence}>{competence}</option>)}
        </select>
      </label>
    </div>
    <div className="expense-filter-footer">
      <span>{activeCount > 0 ? `${activeCount} filtro(s) ativo(s) · ${visibleCount} resultado(s)` : `${visibleCount} despesa(s)`}</span>
      <button type="button" className="secondary-button" onClick={() => onChange({ status: '', competence: '' })}><RotateCcw size={15} /> Limpar filtros</button>
    </div>
  </div>
}
