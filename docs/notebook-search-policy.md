# Política de busca de notebooks

Atualizada em 15/10/2026. A lista canônica fica em `scripts/lib/cpu-terms.mjs`.

## Critérios de oferta

- Foram retirados 12900HX e 12800HX. Restam 20 CPUs em OLX, Enjoei e Mercado Livre.
- RAM instalada mínima de 32 GB. Capacidade da GPU e possibilidade de expansão
  não contam como RAM instalada. Capacidades divergentes exigem conferência.
- Armazenamento não informado gera observação, sem impedir a oferta. Uma
  divergência explícita entre listagem e detalhe ainda exige conferência na OLX.
- CPU deve estar confirmada nas evidências. 255H não confirma 255HX; números sem
  sufixo servem para descoberta, não para aprovação automática. CPUs divergentes
  entre título, descrição e ficha impedem a aprovação.
- Peças, desktops, defeitos e reparos declarados são excluídos. Frases como
  “sem defeitos” não são tratadas como defeito declarado.
- Listagem e detalhe precisam corresponder ao mesmo anúncio. Preços divergentes,
  parcelas ou entrada não são aprovados como preço integral.

## Agenda e limites

| Fonte | Busca normal | Detalhes e limites |
| --- | --- | --- |
| OLX | 14700HX, 13980HX, 14900HX e 13900HX nas rodadas das 07h e 16h, respeitando 8h entre consultas; até quatro CPUs secundárias e uma família em rodízio, ordenadas pela última tentativa | Até 12 cards por consulta na tarefa agendada e 12 detalhes no total. Descoberta por descrição: até dois por consulta e oito por rodada, incluídos nos 12. Fila persistida; orçamento global também se aplica. |
| Enjoei | As quatro prioritárias em cada rodada; outras 16 após 24h | Até 24 requisições de busca no total, incluindo tentativas; quatro páginas por termo; oito candidatos com detalhes; prazo global de dois minutos. Cache por ID, título, marca e versão das regras por 24h. |
| Mercado Livre | Sob demanda, mantendo lotes e pausas existentes | Até oito fichas por lote; cache de 24h. Fila persistida prioriza candidatos até R$8 mil. Fichas antigas ou anteriores à política atual precisam de nova leitura. |

Famílias OLX: Helios Neo 16, ROG Strix G16, Legion Pro 5, Dell G16, Avell A65 e
Avell Storm. Encontrar uma família não confirma uma CPU permitida: seus anúncios
passam pelos mesmos critérios. `--full-sweep` permite a varredura completa OLX.

Frequência adaptativa, contagem compartilhada de acessos e estados operacionais:
[política de operação e orçamento OLX](monitor-operation-and-olx-budget.md).

No Enjoei, o fim precisa de página vazia válida, indicação explícita da API ou
total informado já coberto por IDs distintos. Uma página curta não comprova fim.
Estouro de prazo, páginas ou detalhes mantém os dados anteriores e a pendência.

Recomendações da OLX não entram nos resultados nem consomem a fila de fichas.
O total informado pela página e um card de margem distinguem uma lista encerrada
exatamente no limite de uma lista truncada. Relatórios separam listagem incompleta,
fichas aguardando leitura e falhas de acesso; nenhuma cobertura é declarada completa
quando ainda há páginas ou fichas não lidas. Tentativas parciais também avançam o
rodízio de CPUs secundárias e famílias, sem aumentar os limites da rodada.

No Enjoei, falha temporária na ficha preserva uma confirmação anterior somente
com título, marca e preço iguais, política atual, CPU permitida, RAM mínima e
evidência de menos de 24h. A pendência de nova leitura continua registrada.

No ML, fichas são lidas nas seções técnicas do produto, evitando capturar modelos
de recomendações da página. O preço integral do detalhe também é conferido.

## Cobertura e comparação de preços

Os relatórios registram consultas, detalhes, filas e limites. A saúde admite até
24h para prioritárias, 48h para secundárias OLX/Enjoei, sete dias para secundárias
ML sob demanda e 72h para as famílias OLX em rodízio. Esses prazos representam
frescor da cobertura, não duração da validade de uma oferta.

A comparação OLX exige ao menos três outros anúncios independentes recentes com
família, CPU, GPU, RAM e condição semelhantes. Sem essa amostra, informa dados
insuficientes. A mediana de preços anunciados é indicativa: frete, TGP e condição
física ainda precisam de conferência. Não estima preço de transações concluídas.

`scripts/refresh-notebook-policy.mjs` reaplica as preferências aos dados salvos,
preservando datas de coleta e de conferência. Gera manifesto de reclassificação,
sem nova visita e sem adicionar uma coleta ao histórico operacional. Os artefatos
originais são preservados conforme a política de retenção existente.
