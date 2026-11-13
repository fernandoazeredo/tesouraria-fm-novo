# Ativação da IA Executiva — Tesouraria FM Novo

## Estado
A PR #21 implementa interface privada e Cloud Function consultiva. A publicação integral exige preparação do projeto Firebase; não publicar só o Hosting.

## Pré-requisitos (uma única vez, sem PowerShell)
1. Confirme o plano Blaze no projeto `tesouraria-fm-novo` (Cloud Functions de produção requer faturamento habilitado).
2. Gere uma chave específica da Gemini API no Google AI Studio, com restrições/quota apropriadas; não envie a chave em chats, GitHub ou arquivos do código.
3. No Google Cloud Console > Security > Secret Manager do projeto `tesouraria-fm-novo`, crie o segredo **GOOGLE_GENAI_API_KEY** e adicione a chave como versão habilitada.
4. Confirme que a conta de serviço já configurada em `FIREBASE_SERVICE_ACCOUNT_TESOURARIA_FM_NOVO` tem permissão para publicar Cloud Functions (2ª geração), acessar Cloud Build e vincular o segredo. Não exponha o JSON.
5. Confirme que o usuário Master principal tem e-mail verificado no Firebase Authentication.

## Publicação GitHub Actions
O workflow manual `.github/workflows/deploy-executive-ai.yml`:
- Testa e compila frontend e backend.
- Confere a existência do segredo no projeto.
- Publica primeiro `functions:executive-ai`.
- Só depois publica Hosting.
- Não altera Firestore Rules, Storage Rules, migrações nem dados financeiros.

## Homologação obrigatória
- Master principal visualiza menu IA e acessa `/ia`.
- Outro usuário (mesmo que tente URL direta) não visualiza menu e recebe acesso negado.
- Backend nega requisições sem autenticação, com e-mail não verificado, perfil diferente ou status não ativo.
- Consultar receita, comissão, despesa, conciliação, repasse e auditoria de processo conhecido; conferir registros de origem.
- Testar perguntas fora do escopo; a IA deve rejeitar.
- Testar que não há escrita em nenhuma coleção financeira e que dados bancários/CPF não são enviados à Gemini.
- Testar em mobile e desktop.
- As respostas podem ser parciais (até 80 registros por coleção selecionada) e nunca devem ser interpretadas como somatório global sem conferência.

## Segurança e custos
- Quota máxima de 60 perguntas/dia para o único Master principal.
- Consultas do banco limitadas a quatro coleções identificadas por pergunta e até 80 registros/coleção.
- A conta do provedor Gemini e o Firebase podem gerar cobrança. Configurar alertas orçamentários no Google Cloud e limites de uso do provedor.
- O histórico do chat fica apenas no estado da página; não é persistido.
- Nenhuma ação de lançamento, exclusão, aprovação, transferência ou pagamento está disponível à IA.
- Não mostrar a chave no frontend e não usar a chave pública do Firebase como chave Gemini.
- O segredo para o modelo precisa permanecer em Secret Manager.

## Importante
O workflow Hosting antigo `fm-assistente-hosting.yml` não publica Cloud Functions. Não o utilize para a primeira publicação desta funcionalidade.
