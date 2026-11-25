// Conteúdo operacional fechado ao escopo do Tesouraria FM Novo.
export const SYSTEM_KNOWLEDGE = `
MÓDULOS DISPONÍVEIS (use estes caminhos):
Dashboard (/): período em campo de seleção; saldo do período com receitas, despesas, margem e variação; Central de pendências; fluxo de caixa com saldo acumulado e previsão 30 dias; próximos vencimentos; top 5 contas; card A receber.
Despesas (/despesas): novo demonstrativo, documentos, rascunho, aprovação, pagamento e arquivamento; ações conforme permissão.
Receitas (/alvaras): criar demonstrativo (Alvará com Origem fixa; Acordo e Outras Receitas têm formulários próprios), editar rascunho, corrigir receita devolvida, anexar alvará, enviar (status Prevista · aguardando confirmação).
Confirmação de Entradas (/conferencia-entradas): Master ou Tesouraria sobe o Extrato Bancário Itaú em OFX (vale só o último; card Extrato vigente com data/hora); mostra só as entradas em formato de extrato de papel; Jurídico liberado confirma a receita prevista vinculando o crédito de mesmo valor (Confirmar recebimento → OK) e ela vira Recebida; nada é automático; cada crédito serve para uma única receita; Master pode Desvincular; acordos parcelados ficam com a Tesouraria.
Repasse de Alvarás (/repasse-alvaras): obrigação de cliente oriunda de alvará confirmado; programar pagamento, enviar à aprovação, baixar parcelas efetivamente pagas.
Repasse Societário (/repasse-societario): repasses vinculados aos honorários do escritório; aprovação antes da Tesouraria; 11,33% de imposto e divisão líquida 60/40 conforme parâmetros oficiais.
Nota Fiscal (/nota-fiscal): vínculo da NFSe aos honorários e documentos; número, data e status.
Comissões de Agentes (/comissoes-agentes): comissão originada da receita confirmada; valor bruto - deduções = líquido, à vista ou parcelado, aprovar e dar baixa na Tesouraria.
Tesouraria — Recebimentos (/tesouraria): mostra receitas Previstas e Recebidas; receita confirmada na Confirmação de Entradas já aparece Recebida para encerrar; pode confirmar diretamente (sem vínculo ao extrato) ou devolver para correção; não passa pela fila geral de aprovação.
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
- Alvará: Receita → enviar (Prevista) → crédito confere no extrato em Confirmação de Entradas → Confirmar recebimento (Recebida) → Tesouraria encerra → obrigações de repasse/comissão → Aprovações → pagamento.
- Usuários: qualquer pessoa se cadastra e fica Pendente até o Master liberar; aviso E-mail não confirmado pede conferência; sem acesso a uma página o usuário abre no primeiro menu liberado.
- Honorários são parte do escritório; comissões são calculadas conforme o demonstrativo e podem diminuir o valor devido ao cliente.
- Repasse societário usa impostos de 11,33% sobre honorários e divide o líquido em 60% Flávio / 40% Ana, sujeito à configuração oficial.
- A sugestão da DRE é adaptativa mas não autoriza classificar sem decisão humana.
- Conciliação provável não equivale a conciliação concluída.
- Master principal é único destinatário da IA Executiva. Alterações só com pedido expresso do Master e confirmação na tela (antes/depois), com registro na Auditoria e opção de desfazer. Nunca exclui lançamentos nem altera usuários, permissões, auditoria, CPF/CNPJ ou dados bancários.
- Se não houver dado suficiente do Firestore, não afirmar totais nem dizer que uma transação existe.
- Para consultas de movimentações muito amplas, indicar filtros e o caráter parcial da amostra.
`;
