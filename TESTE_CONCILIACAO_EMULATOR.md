# Teste controlado — Conciliação Bancária com Firebase Emulator

Este roteiro testa a Conciliação Bancária sem gravar no Firebase de produção do FM.

## Segurança do ambiente

O app só usa os emuladores quando iniciado com:

```powershell
npm run dev:emulator
```

Esse comando carrega `.env.emulator`, que define:

```
VITE_USE_FIREBASE_EMULATORS=true
```

Nesse modo:
- Auth -> 127.0.0.1:9099
- Firestore -> 127.0.0.1:8080
- Storage -> 127.0.0.1:9199
- Emulator UI -> http://127.0.0.1:4000

O comando normal `npm run dev` e o build/deploy de produção não ativam os emuladores.

## 1. Preparar a branch

```powershell
git fetch origin
git checkout feat/conciliacao-bancaria-fm
git pull origin feat/conciliacao-bancaria-fm
npm install
```

## 2. Terminal 1 — iniciar Firebase Emulator Suite

```powershell
npm run emulators:start
```

Mantenha esse terminal aberto.

## 3. Terminal 2 — iniciar o app em modo emulator

```powershell
npm run dev:emulator
```

Abra a URL local mostrada pelo Vite.

No console do navegador deve aparecer:

```
[FM NOVO] Firebase Emulator Suite ATIVO — nenhum dado deve ir para a produção.
```

## 4. Criar o Administrador Master local

Como o Auth Emulator começa vazio:

1. Na tela de login, clique em **Primeiro acesso? Solicitar cadastro**.
2. Use o e-mail oficial do Administrador Master do FM.
3. Defina uma senha de teste com pelo menos 6 caracteres.
4. Esse cadastro existe somente no Auth Emulator e no Firestore Emulator.

O perfil Master local fica ativo automaticamente pelas mesmas regras do app.

## 5. Importar o OFX real

1. Abra **Contabilidade**.
2. Selecione a competência usada no teste.
3. Em **Extrato consolidado do banco**, anexe o OFX real do Itaú.
4. Confirme que a mensagem informa separadamente:
   - movimentos conciliáveis;
   - linhas de saldo;
   - aplicações/resgates/rendimentos automáticos;
   - linhas inválidas, caso existam.
5. Abra **Conciliação Bancária** e confira se saldos e aplicações automáticas não aparecem como pendências.

## 6. Testar conciliação

Como o Emulator começa sem despesas e receitas de produção, crie localmente alguns lançamentos de teste correspondentes a movimentos reais do OFX:

- uma Despesa paga pelo Itaú;
- uma Receita recebida no Itaú;
- opcionalmente um Repasse/Comissão.

Use os mesmos valores e datas de movimentos escolhidos do OFX real. Não é necessário copiar nomes ou dados sensíveis para fora do computador.

Confirme:
- correspondência provável;
- conciliação manual;
- desfazer;
- fechar a competência;
- bloqueio de alterações com mês fechado;
- reabertura somente pelo Master;
- novo fechamento após reabertura.

## 7. Teste obrigatório de substituição do OFX

1. Concilie pelo menos um movimento.
2. Importe um segundo OFX que contenha parte dos mesmos movimentos, mas com período inicial diferente.
3. Confirme que:
   - o mesmo movimento não duplica;
   - a conciliação anterior continua vinculada;
   - o movimento pode ser desfeito normalmente;
   - movimentos de outro mês permanecem apenas na competência da data bancária;
   - o arquivo anterior continua preservado no Storage Emulator.

## 8. Conferência pela Emulator UI

Abra:

```
http://127.0.0.1:4000
```

Confira as coleções:
- bankStatements
- bankTransactions
- bankReconciliations
- bankReconciliationPeriods
- auditLogs

E o Storage Emulator para verificar as versões dos OFX.

## 9. Encerrar o teste

Pare os dois terminais com `Ctrl+C`.

Sem usar `--import` ou `--export-on-exit`, os dados locais desaparecem quando o ambiente do Emulator é reiniciado.

## Aceite mínimo antes de publicar

- OFX real lido sem acentos quebrados.
- Saldos não geram pendências.
- Aplicações/resgates/rendimentos automáticos não geram pendências.
- Movimentos reais permanecem conciliáveis.
- Substituição de OFX não perde conciliações.
- Sobreposição entre extratos não duplica movimentos.
- Competências fechadas ficam protegidas pelas regras.
- Master reabre com justificativa e Tesouraria consegue fechar novamente.
- Nenhum arquivo antigo é apagado automaticamente.
