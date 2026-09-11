import {
  AlertTriangle,
  BadgeCheck,
  BadgeDollarSign,
  BarChart3,
  BookOpenCheck,
  Calculator,
  DatabaseBackup,
  FileCheck2,
  FileText,
  Filter,
  FolderArchive,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Moon,
  Paperclip,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react'

import { OperationalFlowImage } from '../components/OperationalFlowImage'

function Header({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>
}

export function TipsPageEnhanced() {
  return <>
    <Header eyebrow="Ajuda rápida" title="DICAS" description="Orientações objetivas para operar o Controle de Despesas e Receitas no fluxo atual do sistema." />

    <div className="tips-grid enhanced-tips-grid">
      <article className="tip expense-tip"><ReceiptText /><h3>Despesa</h3><p><strong>Tesouraria/Operador → Nova Despesa → preencher demonstrativo → anexar documentos → enviar para aprovação.</strong> Depois do envio, a despesa segue para a fila de Aprovações.</p></article>
      <article className="tip"><FileCheck2 /><h3>Aprovação de Despesas</h3><p>O autorizador financeiro decide entre <strong>Aprovar, Devolver para Correção ou Rejeitar</strong>. Depois de aprovada, a despesa sai da fila de Aprovações e segue para a baixa financeira.</p></article>
      <article className="tip"><WalletCards /><h3>Baixa Financeira</h3><p>Na tela <strong>Despesas</strong>, o painel Pagamento e Arquivamento executa o fluxo <strong>Aprovado → Pago → Arquivado</strong>. Informe a data e use <strong>Marcar como Pago</strong>; depois use <strong>Arquivar</strong>. As duas ações ficam registradas na Auditoria.</p></article>
      <article className="tip"><Filter /><h3>Filtros de Despesas</h3><p>Use o botão <strong>Filtros</strong> para restringir a listagem por <strong>Status</strong> e <strong>Competência</strong>. É possível combinar os dois filtros e usar Limpar filtros para voltar à visão completa.</p></article>
      <article className="tip"><BarChart3 /><h3>Classificação de Lançamentos</h3><p>Em <strong>DRE Gerencial → Classificação de Lançamentos</strong>, os lançamentos ficam em Pendentes ou Classificados. O sistema sugere uma conta com classificador híbrido/adaptativo, mas a confirmação continua sendo humana.</p></article>
      <article className="tip"><BarChart3 /><h3>DRE Gerencial</h3><p>Depois de confirmada a classificação, o lançamento elegível entra automaticamente na DRE. Despesas consideradas: <strong>Aprovado, Pago ou Arquivado</strong>. Receitas entram conforme os estados financeiros válidos e as contas marcadas para aparecer na DRE.</p></article>
      <article className="tip revenue-tip"><BadgeDollarSign /><h3>Receita / Alvará</h3><p><strong>Área de origem → Nova Receita → preencher o demonstrativo completo → anexar alvará/acordo e documentos → enviar à Tesouraria.</strong> O recebimento do Alvará não passa pela fila geral de Aprovações.</p></article>
      <article className="tip"><Calculator /><h3>Composição do Alvará</h3><p>O demonstrativo possui impostos, honorários, despesas, linhas de <strong>Outras Deduções / Participações</strong> e identificação do agente/beneficiário quando houver comissão.</p></article>
      <article className="tip"><RefreshCw /><h3>Percentuais e valores</h3><p>Valores monetários usam o padrão <strong>1.000,00</strong>. Percentuais têm duas casas decimais e seguem a regra definida: terceira casa de 0 a 5 desce; de 6 a 9 sobe.</p></article>
      <article className="tip"><BadgeDollarSign /><h3>Repasse de Alvarás</h3><p>Depois que a Tesouraria confirma o recebimento, o valor líquido devido ao cliente aparece em <strong>Repasse de Alvarás</strong>. Programe à vista ou parcelado, envie para aprovação e registre cada pagamento pela data efetiva.</p></article>
      <article className="tip"><Users /><h3>Comissões de Agentes</h3><p>Quando houver comissão, a obrigação aparece em Comissões de Agentes. Podem ser lançadas deduções antes da programação. O sistema calcula <strong>Comissão Bruta - Deduções = Valor Líquido a Pagar</strong>.</p></article>
      <article className="tip"><FileText /><h3>Nota Fiscal</h3><p>O menu Nota Fiscal reaproveita os dados do cliente e o valor dos Honorários do Escritório. Registre <strong>Status NFS-e, Nº NFSe e Data</strong>.</p></article>
      <article className="tip"><LayoutDashboard /><h3>Dashboard</h3><p>Receitas aparecem em azul, Despesas em vermelho e Saldo/Resultado em verde. Os indicadores consolidam o movimento financeiro conforme o fluxo atual.</p></article>
      <article className="tip"><BookOpenCheck /><h3>Plano de Contas</h3><p>O Plano de Contas oficial é a referência do sistema. O classificador da DRE utiliza somente contas existentes; não cria códigos novos automaticamente. A manutenção é exclusiva do Administrador Master.</p></article>
      <article className="tip"><Calculator /><h3>Contabilidade</h3><p>O pacote mensal separa <strong>Despesas, Receitas, Repasses de Alvarás e Comissões de Agentes</strong>. Repasses e comissões entram no mês da data efetiva do pagamento.</p></article>
      <article className="tip"><Landmark /><h3>Extrato bancário</h3><p>O extrato consolidado é <strong>opcional</strong> para gerar o ZIP da Contabilidade. Se estiver anexado, será incluído automaticamente; se não estiver, o pacote pode ser baixado normalmente.</p></article>
      <article className="tip"><ShieldCheck /><h3>Auditoria</h3><p>Aprovações, recebimentos, pagamentos, arquivamentos, repasses, comissões e demais ações relevantes ficam registrados com usuário, data e detalhe.</p></article>
      <article className="tip"><Paperclip /><h3>Documentos / Storage</h3><p>Despesas e Receitas/Alvarás aceitam anexos no Firebase Storage, e o <strong>Arquivo de Documentos</strong> centraliza os arquivos gravados.</p></article>
      <article className="tip"><Moon /><h3>Modo Claro / Escuro</h3><p>Use o controle de tema para alternar entre <strong>Modo Claro e Modo Escuro</strong>. A preferência fica salva no navegador e é reaplicada nos próximos acessos.</p></article>
      <article className="tip"><Wrench /><h3>Utilitários</h3><p>Somente o Administrador Master acessa Utilitários. É possível baixar backup JSON, restaurar o JSON e executar limpeza preservando os usuários.</p></article>
      <article className="tip"><DatabaseBackup /><h3>Backup / Restauração</h3><p>O backup JSON preserva os <strong>dados do Firestore</strong>. Ele não contém fisicamente PDFs ou outros arquivos armazenados no Storage.</p></article>
    </div>

    <section className="page-card help-situations-card">
      <h2>O que fazer em cada situação</h2>
      <div className="help-situation-list">
        <div><AlertTriangle /><span><strong>Despesa devolvida:</strong> Despesas → Corrigir e reenviar → ajuste o solicitado → Reenviar para Aprovação.</span></div>
        <div><WalletCards /><span><strong>Despesa aprovada:</strong> abra Despesas → painel Baixa Financeira → informe a data → Marcar como Pago. Depois da baixa, use Arquivar para concluir o fluxo.</span></div>
        <div><BarChart3 /><span><strong>Lançamento ainda não aparece na DRE:</strong> abra DRE Gerencial → Classificação de Lançamentos, confirme a conta sugerida e confira competência, unidade, status financeiro e se a conta está habilitada para aparecer na DRE.</span></div>
        <div><BadgeCheck /><span><strong>Alvará recebido:</strong> confirme o crédito em Tesouraria / Receitas. Depois da confirmação, Repasse, Nota Fiscal e Comissão são alimentados conforme os dados do demonstrativo.</span></div>
        <div><BadgeDollarSign /><span><strong>Repasse parcelado:</strong> Repasse de Alvarás → Programar pagamento → Parcelado → datas/valores → Enviar para aprovação → registrar cada parcela paga.</span></div>
        <div><Users /><span><strong>Comissão com dedução:</strong> Comissões de Agentes → Programar → Adicionar dedução → informe data, histórico e valor → programe o valor líquido.</span></div>
        <div><ShieldCheck /><span><strong>Precisa comprovar quem fez uma ação:</strong> abra Auditoria e pesquise por processo, usuário, módulo ou ação.</span></div>
        <div><FolderArchive /><span><strong>Precisa localizar um anexo:</strong> abra Arquivo de Documentos e pesquise pelos dados disponíveis.</span></div>
        <div><Calculator /><span><strong>Fechamento mensal sem extrato:</strong> Contabilidade → escolha competência/unidade → Baixar ZIP completo. O extrato bancário é opcional; se anexado, entra no pacote automaticamente.</span></div>
      </div>
    </section>
    <OperationalFlowImage />
  </>
}

export function HowToPageEnhanced() {
  const steps = [
    ['1', 'Entrar no sistema', 'Acesse com e-mail/senha ou Google. No primeiro acesso, o usuário solicita o cadastro e fica Pendente até a liberação do Administrador Master.'],
    ['2', 'Perfis e responsabilidades', 'O Master administra e homologa; o Diretor é o autorizador financeiro; Gerente acompanha; Tesouraria executa os fluxos financeiros; Operadores/Colaboradores registram os lançamentos permitidos.'],
    ['3', 'Cadastrar uma despesa', 'Clique em Nova Despesa, preencha o demonstrativo, informe a movimentação financeira prevista, selecione os documentos comprobatórios e envie para Aprovação.'],
    ['4', 'Filtrar despesas', 'Na listagem de Despesas, clique em Filtros. Selecione Status e/ou Competência. Os filtros podem ser combinados; use Limpar filtros para exibir todos os registros novamente.'],
    ['5', 'Autorizar uma despesa', 'Na fila de Aprovações, o autorizador pode Aprovar, Devolver para Correção ou Rejeitar. Uma despesa aprovada deixa a fila e segue para a etapa de baixa financeira.'],
    ['6', 'Registrar o pagamento da despesa', 'Em Despesas, use o painel Baixa Financeira — Pagamento e Arquivamento de Despesas. Para um lançamento Aprovado, informe a data e clique em Marcar como Pago. O status passa para Pago e a Auditoria registra a ação.'],
    ['7', 'Arquivar uma despesa paga', 'Depois de Pago, use Arquivar no mesmo painel. O lançamento passa para Arquivado, continua preservado nos relatórios, DRE e Auditoria e encerra o fluxo operacional da despesa.'],
    ['8', 'Classificar lançamentos para a DRE', 'Abra DRE Gerencial → Classificação de Lançamentos. Em Pendentes, confira a conta sugerida pelo classificador híbrido/adaptativo e confirme a classificação. A decisão final é sempre humana.'],
    ['9', 'Consultar a DRE Gerencial', 'Abra a aba DRE Gerencial e selecione os filtros desejados. Classificações confirmadas entram automaticamente quando o status financeiro e a conta são elegíveis. Despesas Aprovadas, Pagas ou Arquivadas podem compor a DRE.'],
    ['10', 'Cadastrar uma receita / alvará', 'A área de origem preenche o Demonstrativo de Recebimento de Honorários, processo, cliente, dados bancários, composição do valor, dados fiscais e participações quando houver.'],
    ['11', 'Enviar o Alvará à Tesouraria', 'O recebimento do Alvará não entra na fila geral de Aprovações. Envie à Tesouraria; a Tesouraria confere o crédito e confirma o recebimento.'],
    ['12', 'Repasse de Alvarás', 'Após a confirmação do crédito, o Valor Líquido Devido ao Cliente alimenta Repasse de Alvarás. Esse valor é dinheiro de terceiro e não deve ser tratado como despesa operacional do escritório.'],
    ['13', 'Programar e aprovar o repasse', 'Escolha À vista ou Parcelado, informe datas e valores e envie para aprovação dentro do próprio módulo. Depois de aprovado, a Tesouraria registra cada parcela pela data efetiva.'],
    ['14', 'Comissões de Agentes', 'Quando houver comissão, o módulo permite deduções, cálculo do valor líquido, programação à vista ou parcelada, aprovação e baixa das parcelas.'],
    ['15', 'Nota Fiscal', 'O menu Nota Fiscal recebe dados do cliente e o valor dos Honorários do Escritório. Registre Status NFS-e, Número da NFSe e Data de emissão.'],
    ['16', 'Consultar a Dashboard', 'A Dashboard consolida Receitas, Despesas e Resultado e oferece atalhos para os principais fluxos.'],
    ['17', 'Plano de Contas', 'O Plano de Contas oficial é utilizado pelos lançamentos e pela classificação da DRE. O sistema não deve inventar contas; a manutenção do plano é exclusiva do Administrador Master.'],
    ['18', 'Gerenciar usuários', 'O Master visualiza usuários Pendentes e pode alterar os estados permitidos, mantendo o controle de perfis e acessos.'],
    ['19', 'Preparar o fechamento contábil', 'Em Contabilidade, escolha competência e unidade. O pacote separa Despesas, Receitas, Repasses e Comissões; repasses e comissões usam a data efetiva do pagamento.'],
    ['20', 'Baixar o ZIP da Contabilidade', 'O ZIP pode ser gerado mesmo sem extrato bancário. O extrato é opcional e, quando anexado, é incluído automaticamente junto da planilha e dos anexos disponíveis.'],
    ['21', 'Consultar Auditoria', 'A Auditoria registra as ações relevantes, incluindo aprovação de despesas, baixa como Pago, Arquivamento, recebimentos, aprovações e execuções financeiras.'],
    ['22', 'Modo Claro / Escuro', 'Use o seletor de tema para alternar entre Claro e Escuro. A preferência fica persistida no navegador.'],
    ['23', 'Backup e restauração', 'No menu Utilitários, exclusivo do Master, o Backup JSON preserva os dados do Firestore. Arquivos físicos do Storage não fazem parte do JSON.'],
  ]

  return <>
    <Header eyebrow="Guia operacional" title="Como Usar" description="Passo a passo atualizado de Despesas, baixa financeira, DRE Gerencial, Receitas, Contabilidade, usuários e auditoria." />
    <div className="howto-steps enhanced-howto">{steps.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    <section className="page-card tour-callout"><Lightbulb size={24} /><div><h2>Referência operacional</h2><p>Este guia acompanha o fluxo atualmente disponível no aplicativo e deve ser usado como referência para homologação e treinamento dos usuários.</p></div></section>
  </>
}
