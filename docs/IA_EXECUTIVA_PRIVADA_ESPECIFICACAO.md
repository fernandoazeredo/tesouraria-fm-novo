# IA Executiva Privada — Especificação funcional e de segurança

Status: especificação inicial, sem implementação nem deploy.
Base: feature/fm-assistente-dev-20261020, após PR #20.
Responsável pelo acesso: somente o usuário autenticado identificado como Administrador Master principal.

## Objetivo
Criar um novo módulo lateral `IA`, com ícone sparkles (estrela de quatro pontas, estilo próprio), exclusivo para o titular Master principal, para perguntas em linguagem natural sobre todos os módulos e registros financeiros reais do Tesouraria FM Novo. A IA responde exclusivamente sobre dados, procedimentos e regras do próprio aplicativo. Não executa ações.

## Matriz dos 20 módulos
| Menu | Escopo autorizado de consulta |
| --- | --- |
| Dashboard | Indicadores e períodos consolidados |
| Despesas | Demonstrativos, status, documentos, pagamentos |
| Receitas | Alvarás, honorários, deduções, documentos, status |
| Repasse de Alvarás | Programação, aprovações, parcelas, saldos |
| Repasse Societário | Cálculo, beneficiários, impostos, aprovações, pagamentos |
| Nota Fiscal | NFS-e e status de emissão |
| Comissões de Agentes | Beneficiários, comissão bruta, deduções, parcelas |
| Tesouraria — Recebimentos | Confirmação de crédito e devoluções |
| Aprovações | Pendências e decisões |
| DRE Gerencial | Contas e classificações confirmadas |
| Plano de Contas | Hierarquia, códigos e classificações |
| Contabilidade | Competências, operações, ZIP e pendências |
| Calendário Financeiro | Movimentos por data efetiva |
| Fluxo de Caixa | Entradas, saídas, realizados e previstos |
| Conciliação Bancária | OFX, correspondências e pendências |
| Arquivo de Documentos | Metadados e vínculos dos documentos |
| Usuários | Perfis e status, quando necessários |
| Auditoria | Eventos, autores e datas |
| Utilitários | Procedimentos de backup, restauração, limpeza |
| Configurações | Permissões e dados institucionais |
Também: DICAS, Como Usar e FM Assistente (base operacional).

## Regras críticas de negócio
- Receita: confirmação pela Tesouraria, não pela fila geral de Aprovações.
- Comissão de Agente: origina-se do demonstrativo; é disponibilizada após confirmação do recebimento; programar, enviar à aprovação e registrar pagamento efetivo.
- Repasse de Alvarás: vinculado ao recebimento confirmado; pagamento e parcelas dependem de aprovação.
- Repasse Societário: honorários líquidos de 11,33% de impostos, repartição 60% Flávio e 40% Ana; confirmar fonte de cada cálculo antes de responder.
- DRE e Plano de Contas: classificador adaptativo sugere contas do plano oficial, não cria contas por IA.
- Conciliação: sugestões baseadas em igualdade de valor e proximidade de datas; usuário confirma; não chamar de conciliação automática confirmada.
- Auditoria e documentos: referências reais; não inventar comprovantes.
- Outras regras específicas: consultar versão ativa do código, documentação e Firestore antes de responder.

## Segurança (obrigatória antes de ativar)
1. Menu só aparece para o perfil autenticado de Master principal, com e-mail oficial validado; também restringir a rota /ia.
2. Controle real no backend: verificar o ID token do Firebase Auth; conferir uid e e-mail do Master principal e estado active, nunca confiar somente na ocultação do menu.
3. Backend consultivo com privilégios mínimos; consultas allowlisted e parametrizadas, limites de quantidade, filtros por competência, processo, pessoa e status; não disponibilizar interface para executar SQL ou consultas Firestore arbitrárias.
4. Nenhuma credencial do modelo, service account ou segredo no navegador; usar servidor/Cloud Function ou serviço equivalente protegido.
5. Resposta com origem, data/hora da consulta, módulo, período, status e identificadores que permitam abrir o registro, evitando inventar saldos.
6. Reduzir envio de CPF, contas bancárias e comprovantes pessoais ao provedor de IA: calcular agregações e mascarar dados no backend sempre que possível.
7. Não alterar, excluir, aprovar, transferir, pagar, importar ou reclassificar registros; sem acesso de escrita da IA.
8. Não aceitar pedidos fora do Tesouraria FM Novo, nem instruções introduzidas em documentos/lançamentos (prompt injection).
9. Não permitir que usuários não autorizados chamem o endpoint mesmo conhecendo sua URL.
10. Auditoria registra quem consultou, quando e categoria de consulta, sem armazenar desnecessariamente perguntas/respostas contendo informações sensíveis.

## Experiência
- Item lateral IA (Sparkles), exibido apenas para o Master principal; mobile e desktop.
- Tela de chat: campo de pergunta, sugestões, referências clicáveis aos módulos, filtros por período e processo.
- Duas fontes distintas: base documental versionada para funcionamento/regras + consultas de dados vivos (somente leitura) para saldos, status, lançamentos e pendências.
- Se dados não encontrados, responder explicitamente; se filtros ambíguos, perguntar qual período ou processo.
- Não criar falsas alegações de acesso a dados ou de ações executadas.

## Implementação faseada
A. Mapear campos reais, coleções e autorizações; validar queries e limitações.
B. Criar endpoint autenticado com verificação do Master, restrições de consulta e testes de acesso negado para outros usuários.
C. Conectar provedor de IA com credencial guardada no backend e resposta fundamentada em dados; configurar limites de custo e de tokens.
D. Criar a interface SPA e menu/rota privados; testar mobile.
E. Testes isolados, segurança, custo, auditoria e homologação; somente depois publicar via GitHub Actions com autorização.

## Não alterar nesta etapa
Não alterar produção, dados de usuários, Firestore Rules, Storage Rules, credenciais, fluxos atuais ou FM Assistente público. Não publicar até a nova camada backend estar implementada e verificada.
