# Busca de monitores OLED

## Ajustes de 21/10/2026

- Política de identificação versão 2: buscas de modelo verificam o modelo no
  título; `monitor oled` mantém descoberta ampla. MiniLED/QLED anunciado como
  produto ou oferecido em troca por OLED é descartado antes de ler ficha.
- OLX descobre candidatos primeiro, depois lê uma fila limitada, priorizando
  modelos reconhecidos e conferências antigas. O intervalo compartilhado entre
  navegações é de 12 segundos; os tetos globais não aumentaram.
- A primeira rodada após bloqueio consulta um termo e no máximo duas fichas.
  Uma nova recusa interrompe a fonte e eleva a pausa para 48h e depois 72h.
  A pausa existente não é antecipada. Consultas não tentadas ficam adiadas,
  sem renovar suas datas de conferência.
- Bloqueios guardam etapa, URL sem parâmetros de rastreamento, status HTTP,
  horário, título e Ray ID. Aviso e captura ficam em `logs/olx-access/`, com
  retenção limitada, sem cookies ou cabeçalhos de autenticação. Esses arquivos
  locais não são publicados. A configuração não garante liberação pelo site.
- No ML, consultas elegíveis alternam pela última tentativa, inclusive quando
  ficaram incompletas. O lote normal reserva até dois lugares para secundárias
  elegíveis, mantendo preferência das prioritárias e os mesmos seis termos por
  lote. Seleção manual aceita uma lista de termos separados por vírgula.

As regras abaixo continuam válidas, com os ajustes acima tendo precedência.

Atualizada em 15/10/2026. Faixa de R$1.500 a R$3.000 preservada nas três fontes.

## Identificação e aprovação

`scripts/lib/oled-monitor-scope.mjs` concentra catálogo, aliases e classificação.
Os códigos usam limites de token: AW2725D, AW2725DF e AW2725DM não são a mesma
identidade. AW2725DM/2724DM e outros painéis explicitamente IPS/VA/TN/LCD são
excluídos. Samsung aceita a ordem variável de OLED/G6/G8/G9 e códigos conhecidos;
G6/G8/G9 isolados não confirmam tecnologia OLED.

LG 27GR95QE, 27GS95QE e 39GS95QE foram incluídos. Os modelos MSI 271QPX e
271QP/274QP QD-OLED X24 são reconhecidos; MAG 274QPX não é usado como prova OLED.
Um modelo desconhecido com contexto OLED de monitor fica pendente para revisão.

A aprovação requer uma descrição lida, modelo confirmado, identidade consistente
e preço integral sem divergência. Peças, acessórios, TVs, consoles e defeitos
declarados são excluídos. Negações como “sem burn-in” e “sem defeitos” são
respeitadas. Aprovação textual não comprova estado físico, entrega ou autenticidade.

O cache tem 24h por ID, título, preço e versão da política, incluindo evidências
negativas. Pendências ainda não lidas ficam em fila. Uma ambiguidade já lida fica
visível para revisão sem manter a coleta em repetição automática infinita.

## Consultas e orçamentos

| Fonte | Agenda normal | Limites |
| --- | --- | --- |
| OLX | Sete prioritárias + até duas secundárias em rodízio + descoberta `monitor oled` | Categoria monitores, entrega OLX, até 60 cards/consulta e seis detalhes/rodada |
| Enjoei | Descoberta `monitor oled` + até três específicas em rodízio | Oito páginas globais e quatro detalhes; até 30 resultados/página |
| ML | Até seis termos por lote | Quatro detalhes por lote por padrão, categoria monitores, envio nacional, pausas existentes |

OLX prioritárias: AW2726DM, AW2725D, AW2725DF, Odyssey OLED G6, Monitor Cepheus,
27GR95QE e 27GS95QE. As secundárias ficam elegíveis após 72h, com precedência
para a consulta menos recentemente tentada. Todas as consultas OLX respeitam
também a frequência adaptativa e os limites compartilhados. Ofertas produtivas
mantêm intervalo de 8h; consultas sem ofertas começam em 24h e podem passar
para 48h ou 72h após buscas completas vazias. A ordem das prioritárias alterna
pela última tentativa para evitar que o orçamento favoreça sempre os mesmos modelos.

Detalhes: [operação e orçamento OLX](monitor-operation-and-olx-budget.md).

Enjoei evita refazer a mesma consulta bem-sucedida em menos de 12h usando a
cobertura publicada, compartilhada entre CI e local. Secundárias entram em rodízio
de sete dias; consultas inéditas ou incompletas mantêm prioridade de cobertura.
`cepheus p1` foi reformulada para `monitor cepheus` para reduzir a busca difusa.
O cursor e os IDs processados são salvos após cada página. Página curta não
comprova fim; total consistente de IDs, indicação da API ou página vazia válida
confirmam o encerramento. Limite de páginas mantém cobertura incompleta.

ML usa intervalos de 24h com rendimento válido recente, 72h para prioritárias
vazias e sete dias para secundárias vazias. Fichas são lidas apenas nas seções
técnicas do produto. Uma fila persistida mantém candidatos ainda não conferidos.
`--full-sweep` continua disponível para varredura completa, respeitando os limites
de detalhes e paginação. Bloqueios e verificações interrompem os acessos.

## Cobertura, painel e alertas

Consultas registram resultados brutos, fora da faixa, descartes de escopo,
aprovados, pendências, rendimento exclusivo e limites. Contadores de páginas,
detalhes e cache são registrados por fonte. Fichas não lidas e limites atingidos
impedem declarar a consulta completa; os resultados anteriores são preservados.

O painel e o WhatsApp usam a mesma elegibilidade. Candidatos pendentes têm seção
própria e não contam como ofertas aprovadas. Evidências com mais de 24h precisam
de atualização antes de gerar alerta de oferta. A saúde considera a agenda de
cada consulta e mostra consultas novas ainda em implantação.

Ofertas com conferência vencida continuam visíveis em **Aguardando atualização**,
com o último preço observado, sem entrar nos alertas de ofertas aprovadas.
Renovar uma confirmação vencida não transforma um anúncio já aprovado em novidade;
depois da renovação ele aparece entre as ofertas ativas atuais.
No painel, as ofertas ativas sem mudança ficam recolhidas em **Ofertas já
conhecidas**, com a data da primeira identificação e da última conferência real.
O horário de uma rodada sem consultas não renova essas datas. Apenas anúncios
novos e mudanças de preço nas últimas 24h levam uma busca para a área de
novidades; pendências aparecem uma única vez em **Pendências atuais**.
No Enjoei, uma oferta aprovada que venceu permite renovar sua consulta antes
do intervalo habitual de 12h, mantendo os mesmos limites de páginas e detalhes.

Durante uma pausa por bloqueio da OLX, as consultas são registradas como adiadas:
não contam como novas tentativas nem alteram a data da última consulta. O painel
e o relatório mostram o prazo de retomada. Após esse prazo, a próxima rodada
retoma pela primeira consulta e interrompe a fonte se o site voltar a bloquear.
Se faltarem até cinco minutos para o fim da pausa, a rodada aguarda localmente,
sem fazer acessos, para aproveitar o horário agendado da manhã.
Abrir uma janela visível não ignora a pausa. Recomendações da página não são
tratadas como resultados da busca.

`scripts/refresh-oled-policy.mjs` reaplica as regras aos dados salvos sem nova
visita nem alteração dos horários de coleta. Manifestos de reclassificação não
entram no histórico de desempenho como novas coletas.
