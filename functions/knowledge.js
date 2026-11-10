// Conteúdo operacional fechado ao escopo do Tesouraria FM Novo.
export const SYSTEM_KNOWLEDGE = `
MÓDULOS DISPONÍVEIS (use estes caminhos):
Dashboard (/): indicadores consolidados de receitas recebidas, despesas efetivas e saldo/resultado.
Despesas (/despesas): novo demonstrativo, documentos, rascunho, aprovação, pagamento e arquivamento; ações conforme permissão.
Receitas (/alvaras): criar demonstrativo, editar rascunho, corrigir receita devolvida, anexar alvará, enviar à Tesouraria.
Repasse de Alvarás (/repasse-alvaras): obrigação de cliente oriunda de alvará confirmado; programar pagamento, enviar à aprovação, baixar parcelas efetivamente pagas.
Repasse Societário (/repasse-societario): repasses vinculados aos honorários do escritório; aprovação antes da Tesouraria; 11,33% de imposto e divisão líquida 60/40 conforme parâmetros oficiais.
Nota Fiscal (/nota-fiscal): vínculo da NFSe aos honorários e documentos; número, data e status.
Comissões de Agentes (/comissoes-agentes): comissão originada da receita confirmada; valor bruto - deduções = líquido, à vista ou parcelado, aprovar e dar baixa na Tesouraria.
Tesouraria — Recebimentos (/tesouraria): confirma crédito real de alvará ou devolve para correção; não passa pela fila geral de aprovação.
Aprovações (/aprovacoes): pendências de despesas e repasses; o fato de ver não permite aprovar. Distinga Devolver de Rejeitar.
DRE Gerencial (/dre-gerencial): classificações sugeridas por histórico/regras com confiança; confirmação humana; receitas e despesas segundo os status do módulo.
Plano de Contas (/plano-contas): códigos oficiais hierarquizados 3.xx receitas, 4.xx despesas e 5.xx patrimônio/dívidas. Edição TXT apenas por Master. Não cria novas contas automaticamente.
Contabilidade (/contabilidade): selecionar competência/unidade/movimento; ZIP com Excel, documentos, comprovantes e relatório de pendências; não presume comprovantes inexistentes.
Calendário Financeiro (/calendario-financeiro): receitas e pagamentos organizados por data efetiva, com acesso a demonstrativos quando disponíveis.
Fluxo de Caixa (/fluxo-caixa): consultar entradas/saídas, realizados e previstos por período; não confundir previsto com realizado.
Conciliação Bancária (/conciliacao-bancaria): importar arquivo OFX, conferir sugestões de correspondência por valor/data, clicar Conciliar para confirmar; fechamento/reabertura sob restrições.
Arquivo de Documentos (/documentos): metadados e anexos associados; não inventar documentos.
Usuários (/usuarios): ativar/bloquear cadastros e consultar perfis, restrito ao Master.
Auditoria (/auditoria): registros de ações, usuários, datas e eventos.
Utilitários (/utilitarios): backup/restauração JSON do Firestore NÃO inclui arquivos binários de Storage; limpeza total é irreversível.
Configurações (/configuracoes): dados institucionais e permissões Ver por usuário; coluna Fazer não ativa nesta versão.
DICAS (/dicas) e Como Usar (/como-usar): ajuda e orientações internas.
Robô — Tire suas dúvidas: assistente documental já disponível aos usuários. IA Executiva (/ia) é privada e distinta.

REGRAS OPERACIONAIS:
- Alvará: Receita → enviar à Tesouraria → confirmação real de recebimento → obrigações de repasse/comissão → Aprovações → pagamento.
- Honorários são parte do escritório; comissões são calculadas conforme o demonstrativo e podem diminuir o valor devido ao cliente.
- Repasse societário usa impostos de 11,33% sobre honorários e divide o líquido em 60% Flávio / 40% Ana, sujeito à configuração oficial.
- A sugestão da DRE é adaptativa mas não autoriza classificar sem decisão humana.
- Conciliação provável não equivale a conciliação concluída.
- Master principal é único destinatário da IA Executiva. Sem permissão de escrita.
- Se não houver dado suficiente do Firestore, não afirmar totais nem dizer que uma transação existe.
- Para consultas de movimentações muito amplas, indicar filtros e o caráter parcial da amostra.
`;
