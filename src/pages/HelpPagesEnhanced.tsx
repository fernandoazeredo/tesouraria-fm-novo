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
    <Header eyebrow="Ajuda rápida" title="DICAS" description="Aprovações, comprovantes de pagamento, PDF, Contabilidade, Calendário e limpeza irreversível com Auditoria." />

    <div className="tips-grid enhanced-tips-grid">
      <article className="tip expense-tip"><ReceiptText /><h3>Despesa</h3><p><strong>Tesouraria/Operador → Nova Despesa → preencher demonstrativo → anexar documentos → enviar para aprovação.</strong> Depois do envio, a despesa segue para a fila de Aprovações.</p></article>
      <article className="tip"><FileCheck2 /><h3>Aprovações centralizadas</h3><p>O menu <strong>Aprovações</strong> reúne pendências de Despesas, Repasses de Alvarás, Comissões de Agentes e Repasse Societário. Diretor autorizador e Master de homologação podem <strong>Aprovar, Devolver ou Rejeitar</strong>; os demais perfis autorizados acompanham a fila em modo consulta.</p></article>
      <article className="tip"><AlertTriangle /><h3>Devolver não é Rejeitar</h3><p><strong>Devolver</strong> exige justificativa, deixa o motivo visível e permite ajustar e reenviar conforme as permissões do módulo. <strong>Rejeitar</strong> registra uma decisão negativa e não equivale a uma devolução para ajustes. Consulte o histórico na Auditoria.</p></article>
      <article className="tip"><WalletCards /><h3>Baixa Financeira</h3><p>Na tela <strong>Despesas</strong>, o painel Pagamento e Arquivamento executa o fluxo <strong>Aprovado → Pago → Arquivado</strong>. Informe a data e use <strong>Marcar como Pago</strong>; depois use <strong>Arquivar</strong>. As duas ações ficam registradas na Auditoria.</p></article>
      <article className="tip"><Filter /><h3>Filtros de Despesas</h3><p>Use o botão <strong>Filtros</strong> para restringir a listagem por <strong>Status</strong> e <strong>Competência</strong>. É possível combinar os dois filtros e usar Limpar filtros para voltar à visão completa.</p></article>
      <article className="tip"><BarChart3 /><h3>Classificação de Lançamentos</h3><p>Em <strong>DRE Gerencial → Classificação de Lançamentos</strong>, os lançamentos ficam em Pendentes ou Classificados. O sistema sugere uma conta com classificador híbrido/adaptativo, mas a confirmação continua sendo humana.</p></article>
      <article className="tip"><BarChart3 /><h3>DRE Gerencial</h3><p>Depois de confirmada a classificação, o lançamento elegível entra automaticamente na DRE. Despesas consideradas: <strong>Aprovado, Pago ou Arquivado</strong>. Receitas entram conforme os estados financeiros válidos e as contas marcadas para aparecer na DRE.</p></article>
      <article className="tip revenue-tip"><BadgeDollarSign /><h3>Receita / Alvará</h3><p><strong>Área de origem → Nova Receita → preencher o demonstrativo completo → anexar alvará/acordo e documentos → enviar à Tesouraria.</strong> <strong>Regra 1 — Recebimento do Alvará:</strong> NÃO passa pela fila de Aprovações. A Tesouraria confere o crédito e confirma diretamente o recebimento.</p></article>
      <article className="tip"><Calculator /><h3>Composição do Alvará</h3><p>O demonstrativo possui impostos, honorários, despesas, linhas de <strong>Outras Deduções / Participações</strong> e identificação do agente/beneficiário quando houver comissão.</p></article>
      <article className="tip"><RefreshCw /><h3>Percentuais e valores</h3><p>Valores monetários usam o padrão <strong>1.000,00</strong>. Percentuais têm duas casas decimais e seguem a regra definida: terceira casa de 0 a 5 desce; de 6 a 9 sobe.</p></article>
      <article className="tip"><BadgeDollarSign /><h3>Repasse de Alvarás</h3><p><strong>Regra 2 — Repasse de Alvarás:</strong> PASSA pela fila central de Aprovações, assim como Despesas, Comissões de Agentes e Repasse Societário. Fluxo: Área de origem → Nova Receita → demonstrativo → Tesouraria confere o crédito e confirma o recebimento → Repasse de Alvarás → programar pagamento (À vista ou Parcelado) → informar datas e valores → Enviar para aprovação (status Aguardando aprovação) → Master/Diretoria aprova → Tesouraria registra cada parcela pela data efetiva. O valor devido ao cliente é dinheiro de terceiro, não despesa operacional do escritório.</p></article>
      <article className="tip"><Users /><h3>Comissões de Agentes</h3><p>Quando houver comissão, siga: <strong>Comissões de Agentes → Programar → Adicionar dedução (data, histórico e valor) quando aplicável → programar o líquido à vista ou parcelado → Enviar para aprovação → Master/Diretoria aprova → Tesouraria registra cada parcela efetivamente paga.</strong> O sistema calcula <strong>Comissão Bruta − Deduções = Valor Líquido a Pagar</strong>.</p></article>
      <article className="tip"><FileText /><h3>Nota Fiscal</h3><p>O menu Nota Fiscal reaproveita os dados do cliente e o valor dos Honorários do Escritório. Registre <strong>Status NFS-e, Nº NFSe e Data</strong>.</p></article>
      <article className="tip"><LayoutDashboard /><h3>Dashboard</h3><p>Receitas aparecem em azul, Despesas em vermelho e Saldo/Resultado em verde. Os indicadores consolidam o movimento financeiro conforme o fluxo atual.</p></article>
      <article className="tip"><BookOpenCheck /><h3>Plano de Contas</h3><p>O Plano de Contas oficial é a referência do sistema. O classificador da DRE utiliza somente contas existentes; não cria códigos novos automaticamente. A manutenção é exclusiva do Administrador Master.</p></article>
      <article className="tip"><Calculator /><h3>ZIP da Contabilidade</h3><p>Selecione <strong>Competência, Unidade e Movimento</strong> e baixe o ZIP. Ele reúne <strong>Movimento_Contabilidade.xlsx</strong>, a pasta <strong>Creditos/</strong> (uma por operação, unindo receita, repasse ao cliente, comissão e comprovantes) e <strong>Debitos/</strong> (uma por despesa, com seu PDF e comprovantes). Não existem pastas separadas para receitas, repasses e comissões. A aba Operacoes e as abas do Excel mostram o caminho de cada operação. Repasses, comissões e <strong>Repasses Societários</strong> pertencem ao mês do pagamento efetivo. A mesma operação inclui <strong>04_demonstrativo_repasse_societario.pdf</strong> e os comprovantes existentes em <strong>comprovantes/repasse_societario/</strong>. O Excel inclui a aba <strong>Repasses_Societarios</strong>. <strong>O ZIP não exporta Plano de Contas, classificações nem DRE Gerencial</strong>; esses dados continuam exclusivamente nos módulos internos do sistema.</p></article>
      <article className="tip"><Paperclip /><h3>Comprovantes de pagamento — onde anexar</h3><p><strong>Despesa:</strong> em <strong>Despesas → Nova Despesa</strong> ou <strong>Editar</strong> um rascunho/devolvido, utilize <strong>Documentos comprobatórios → Selecionar arquivos</strong> para enviar nota fiscal, boleto e documentos disponíveis. Faça isso <strong>antes de enviar para aprovação</strong>, pois a tela de Baixa Financeira somente marca o pagamento e não tem botão de upload. <strong>Repasse de Alvarás e Comissões de Agentes:</strong> os painéis <strong>Programação / Pagamento</strong> registram parcelas e datas, mas <strong>ainda não possuem um botão próprio para anexar comprovantes bancários</strong>; não confunda <strong>Salvar pagamentos</strong> com envio de arquivos. Quando houver documentos efetivamente anexados ao registro da operação, o ZIP os coloca em <strong>Creditos/.../comprovantes/</strong>; os anexos da despesa ficam em <strong>Debitos/.../comprovantes/</strong>. Comprovantes ausentes aparecem em <strong>Pendencias/RELATORIO_DE_PENDENCIAS.txt</strong> e no Excel, sem que o sistema invente arquivos.</p></article>
      <article className="tip"><AlertTriangle /><h3>Apagar tudo — limpeza irreversível</h3><p>Em <strong>Utilitários → Limpeza total</strong>, exclusivamente o <strong>Administrador Master</strong> pode confirmar a operação digitando <strong>APAGAR TUDO</strong>. A limpeza exclui registros dos módulos operacionais — inclusive Despesas, Receitas, Repasses de Alvarás, Comissões, <strong>Repasse Societário</strong>, Notas Fiscais, classificações, extratos e documentos — e tenta remover os <strong>arquivos vinculados a esses registros no Firebase Storage</strong>, inclusive demonstrativos. <strong>A exclusão é irreversível</strong> pelo próprio aplicativo: o backup JSON anterior contém somente dados do Firestore, <strong>não</strong> os arquivos físicos. Usuários, Configurações e Plano de Contas são preservados. Ao concluir ou falhar parcialmente, o sistema registra na <strong>Auditoria</strong> o usuário, data e hora, quantidades removidas por módulo, arquivos excluídos e eventuais falhas. Execute somente com autorização formal e confira o resultado.</p></article>
      <article className="tip"><FileText /><h3>Demonstrativos oficiais em PDF</h3><p>Após finalizar um lançamento, o PDF é gerado a partir do <strong>mesmo componente visual React</strong> usado na prévia, com logomarca, seções, tabelas e paginação A4. O arquivo salvo no Storage é imutável. O pacote contábil recupera demonstrativos históricos finalizados sem sobrescrever os PDFs anteriores, organizados por operação.</p></article>
      <article className="tip"><AlertTriangle /><h3>Pendências do pacote</h3><p>A aba <strong>Pendencias</strong> do Excel e o relatório <strong>Pendencias/RELATORIO_DE_PENDENCIAS.txt</strong> identificam os documentos faltantes ou inacessíveis. Não considere completo um pacote com pendências. Despesa apenas <strong>Aprovada</strong>, sem pagamento, ainda não exige PDF de baixa.</p></article>
      <article className="tip"><RefreshCw /><h3>Calendário Financeiro</h3><p>Exibe recebimentos, despesas e repasses/comissões pagos por data efetiva. Use <strong>Demonstrativo</strong> para abrir o PDF salvo, <strong>Visualizar demonstrativo</strong> para a prévia e os links dos comprovantes para consultar anexos. Se faltar PDF, a tela informa o <strong>tipo e a referência</strong> do lançamento; não confunda documento ainda não aplicável com falha de armazenamento.</p></article>
      <article className="tip"><ShieldCheck /><h3>Proteção de dados da Contabilidade</h3><p>Demonstrativos de receitas podem incluir <strong>CPF, banco, agência, conta e PIX</strong> de clientes. Antes de enviar o ZIP, confirme a autorização do destinatário, a necessidade desses campos para o serviço contábil e o canal seguro de compartilhamento. A geração do ZIP não representa autorização automática para divulgar dados pessoais.</p></article>
      <article className="tip"><Landmark /><h3>Extrato bancário</h3><p>O extrato consolidado é <strong>opcional</strong> para gerar o ZIP da Contabilidade. Se estiver anexado, será incluído automaticamente; se não estiver, o pacote pode ser baixado normalmente.</p></article>
      <article className="tip"><ShieldCheck /><h3>Auditoria</h3><p>Aprovações, recebimentos, pagamentos, arquivamentos, repasses, comissões e demais ações relevantes ficam registrados com usuário, data e detalhe.</p></article>
      <article className="tip"><Paperclip /><h3>Documentos / Storage</h3><p>Despesas e Receitas/Alvarás aceitam anexos no Firebase Storage. O <strong>Arquivo de Documentos</strong> centraliza os documentos gravados e seus demonstrativos. A ausência de comprovante é sinalizada nas Pendências, sem inventar arquivos ou pastas vazias.</p></article>
      <article className="tip"><Moon /><h3>Modo Claro / Escuro</h3><p>Use o controle de tema para alternar entre <strong>Modo Claro e Modo Escuro</strong>. A preferência fica salva no navegador e é reaplicada nos próximos acessos.</p></article>
      <article className="tip"><Wrench /><h3>Utilitários</h3><p>Somente o Administrador Master acessa Utilitários. Backup e restauração JSON não incluem os arquivos físicos do Storage. O botão <strong>Apagar tudo</strong> elimina registros operacionais e arquivos vinculados, preserva Usuários, Configurações e Plano de Contas e gera um novo registro de Auditoria. A limpeza não pode ser desfeita pelo aplicativo.</p></article>
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
        <div><Paperclip /><span><strong>Onde anexar comprovantes:</strong> Despesas → Nova Despesa ou Editar rascunho/devolvido → Documentos comprobatórios → Selecionar arquivos, antes da aprovação. Repasses e Comissões ainda não têm upload próprio na tela de pagamento; o que estiver ausente aparece em Pendências. Os anexos vinculados ficam em <strong>comprovantes/</strong> no ZIP da operação.</span></div>
        <div><AlertTriangle /><span><strong>Apagar tudo:</strong> exclusivo do Master, em Utilitários → Limpeza total. Confirme apenas com autorização, pois remove registros operacionais e arquivos vinculados do Storage, sem recuperação pelo app. Usuários, Configurações e Plano de Contas permanecem; uma nova Auditoria registra usuário, horário e contagens.</span></div>
        <div><Calculator /><span><strong>Fechamento mensal:</strong> Contabilidade → escolha competência/unidade e movimento → gerar o ZIP → conferir a aba Pendencias e o relatório de pendências. O extrato bancário é opcional; caso anexado, entra no pacote.</span></div>
        <div><FileText /><span><strong>PDF não aparece no Calendário:</strong> confira a identificação exibida junto ao aviso. Despesa apenas aprovada aguarda a baixa financeira; se o lançamento já foi finalizado e o PDF ainda não foi salvo, revise a geração e os registros da Contabilidade.</span></div>
        <div><ShieldCheck /><span><strong>Antes de enviar documentos à Contabilidade:</strong> confirme quais dados pessoais são indispensáveis, a autorização de acesso do destinatário e o meio seguro de compartilhamento.</span></div>
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
    ['11', 'Enviar o Alvará à Tesouraria', 'Regra 1 — Recebimento do Alvará: NÃO passa pela fila de Aprovações. Envie à Tesouraria; ela confere o crédito e confirma diretamente o recebimento.'],
    ['12', 'Repasse de Alvarás', 'Após a confirmação do crédito, o Valor Líquido Devido ao Cliente alimenta Repasse de Alvarás. Esse valor é dinheiro de terceiro e não deve ser tratado como despesa operacional do escritório.'],
    ['13', 'Programar e aprovar o repasse', 'Regra 2 — Repasse de Alvarás: PASSA pela fila central de Aprovações, assim como Despesas, Comissões de Agentes e Repasse Societário. Após o recebimento confirmado pela Tesouraria, acesse Repasse de Alvarás → Programar pagamento (À vista ou Parcelado) → datas e valores → Enviar para aprovação (Aguardando aprovação) → Master/Diretoria aprova → Tesouraria registra cada parcela pela data efetiva. O valor do cliente é dinheiro de terceiro, não despesa operacional.'],
    ['14', 'Comissões de Agentes', 'Comissões de Agentes → Programar → Adicionar dedução (data, histórico e valor), quando aplicável → Comissão Bruta − Deduções = Valor Líquido a Pagar → programar líquido à vista ou parcelado → Enviar para aprovação → Master/Diretoria aprova → Tesouraria registra o pagamento de cada parcela pela data efetiva.'],
    ['15', 'Nota Fiscal', 'O menu Nota Fiscal recebe dados do cliente e o valor dos Honorários do Escritório. Registre Status NFS-e, Número da NFSe e Data de emissão.'],
    ['16', 'Consultar a Dashboard', 'A Dashboard consolida Receitas, Despesas e Resultado e oferece atalhos para os principais fluxos.'],
    ['17', 'Plano de Contas', 'O Plano de Contas oficial é utilizado pelos lançamentos e pela classificação da DRE. O sistema não deve inventar contas; a manutenção do plano é exclusiva do Administrador Master.'],
    ['18', 'Gerenciar usuários', 'O Master visualiza usuários Pendentes e pode alterar os estados permitidos, mantendo o controle de perfis e acessos.'],
    ['19', 'Preparar o fechamento contábil', 'Em Contabilidade, escolha competência e unidade. O ZIP reúne os documentos em Creditos/{processo}_{reclamante}_{id}/ ou Debitos/{competencia}_{fornecedor}_{id}/. Repasse e comissão do mesmo processo ficam na mesma operação e entram no movimento do mês do pagamento efetivo.'],
    ['20', 'Baixar o ZIP da Contabilidade', 'O ZIP pode ser gerado mesmo sem extrato bancário. O extrato é opcional e, quando anexado, é incluído automaticamente junto do Excel e as pastas Creditos/ e Debitos/ agrupadas por operação.'],
    ['21', 'Consultar Auditoria', 'A Auditoria registra as ações relevantes, incluindo aprovação de despesas, baixa como Pago, Arquivamento, recebimentos, aprovações e execuções financeiras.'],
    ['22', 'Modo Claro / Escuro', 'Use o seletor de tema para alternar entre Claro e Escuro. A preferência fica persistida no navegador.'],
    ['23', 'Backup e restauração', 'No menu Utilitários, exclusivo do Master, o Backup JSON preserva os dados do Firestore. Arquivos físicos do Storage não fazem parte do JSON.'],
    ['24', 'Comprovantes de pagamento', 'Despesas → Nova Despesa ou Editar rascunho/devolvido → Documentos comprobatórios → Selecionar arquivos, antes de enviar à Aprovação. A Baixa Financeira não anexa comprovante. Repasse de Alvarás e Comissões não têm upload próprio do comprovante bancário; os arquivos já vinculados vão para comprovantes/ no ZIP e as ausências são listadas em Pendências.'],
    ['25', 'Apagar tudo — limpeza irreversível', 'Utilitários → Limpeza total → confirmação APAGAR TUDO pelo Master. Remove dados operacionais e arquivos do Storage vinculados aos registros, incluindo repasses societários e demonstrativos. Preserva usuários, configurações e plano de contas. A limpeza fica registrada na Auditoria com usuário, data/hora e contagens. O backup JSON não restaura PDFs excluídos.'],
  ]

  return <>
    <Header eyebrow="Guia operacional" title="Como Usar" description="Passo a passo atualizado de Despesas, baixa financeira, DRE Gerencial, Receitas, Contabilidade, usuários e auditoria." />
    <div className="howto-steps enhanced-howto">{steps.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    <section className="page-card tour-callout"><Lightbulb size={24} /><div><h2>Referência operacional</h2><p>Este guia acompanha o fluxo atualmente disponível no aplicativo e deve ser usado como referência para homologação e treinamento dos usuários.</p></div></section>
  </>
}
