/** Aviso exibido enquanto um card de Configurações tem alterações ainda não salvas. */
export function UnsavedBadge() {
  return <p role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '12px 0 0', padding: '6px 12px', borderRadius: 8, background: '#fff4e5', color: '#8a4b00', border: '1px solid #f5b971', fontWeight: 600 }}>
    ⚠ Alterações não salvas — clique em salvar para valer.
  </p>
}
