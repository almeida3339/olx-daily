# Política da busca barefoot — 15/10/2026

## Seleção

Tênis tamanho 42, preço anunciado até R$500. Marcas prioritárias: Fiber e Feet of Tomorrow. FOT somente Walka, Lito, Noga, Voet e Bruk. A descrição pode confirmar o modelo de um anúncio que identifica a marca, mas não nomeia o modelo no título. Marca sem modelo fica pendente, sem alerta. Urban e demais modelos fora da seleção não entram, mesmo em relatórios históricos reapresentados.

Fiber: tênis Barefoot Ultra, Free e Racing reconhecidos por linha; outras linhas e sapatilhas não são confirmadas pela marca. Modelos não identificados exigem conferência, sem presumir que todo Fiber é barefoot. Demais marcas mantêm as regras de evidência anteriores.

## Agenda e limites

| Grupo | Consultas | Intervalo mínimo | Validade de cobertura |
|---|---|---|---|
| Prioridade | fiber, feet of tomorrow, fot walka, barefoot | Toda rodada | 24h |
| Diário | lems, vita barefoot | 24h | 48h |
| Rodízio | Marcas secundárias e modelos específicos; zero drop/drop zero | 72h | 96h |
| Descoberta | fot lito/noga/voet/bruk, fot, freet, minimalista(s), Fiber e Feet of Tomorrow sem departamento | 7 dias entre conclusões | 14 dias |

Até 12 páginas habituais e seis adicionais de descoberta, quatro descrições novas, três minutos. Na configuração padrão e resultados de uma página, as quatro prioritárias deixam oito páginas para diárias e rodízio. Filas secundárias usam a consulta há mais tempo não tentada, com diárias antes de rodízio. Intervalos dependem da continuidade dos disparos; não são garantias de conclusão se o catálogo crescer. Consultas incompletas ficam devidas na próxima rodada. Não se inventa uma conclusão ao esgotar orçamento.

A coleta de implantação encontrou 69 resultados aproximados para `fot lito` e 159 para `fot noga`, sem novos candidatos válidos nas páginas lidas. Por isso esses aliases usam descoberta semanal. As buscas prioritárias por marca e barefoot aceitam todos os cinco modelos selecionados; o nome de modelo consultado não restringe a conferência local. Anúncios mal cadastrados podem demorar até a varredura ampla para aparecer.

A primeira página de uma prioritária incompleta é relida sem avançar seu cursor; a continuação usa o cursor opaco salvo. Os demais termos retomam seu ciclo. Cursores com mais de 14 dias reiniciam para evitar depender indefinidamente de uma paginação antiga. Mudanças de ordem ou inclusão de termos preservam os cursores existentes. Mudança de filtro redefine o contexto.

## Estado, cache e comunicação

Cada consulta registra tentativa, última conclusão, próxima data devida, paginação e grupo. O estado de saúde respeita a validade de cada grupo e identifica consultas novas como em implantação. Falhas de acesso são problemas; adiamentos por orçamento são registrados separadamente. Um ciclo amplo parcialmente percorrido não transforma a rodada prioritária em erro, mas permanece pendente no relatório e na cobertura.

Anúncios de termos não consultados são preservados com o último avistamento conhecido. Itens antigos de ciclos incompletos não são enviados ao merge como recém-observados. Descrições por ID/título/marca: 24h para Fiber/FOT, sete dias para outros candidatos, máximo mil entradas. Mudança de preço não invalida evidência textual. A descrição é reavaliada com a versão atual das regras. Anúncios inconclusivos continuam separados, sem alerta de oferta confirmada.

Preferência de marca vem antes do preço na ordenação. Mantido o teto de descoberta R$500. Não foram aplicados tetos menores por marca nem alegações de desconto calculadas sem referência atual por modelo/condição/frete. Não foi assumido suporte a filtro por marca da API: a implementação usa consultas textuais e conferência local.

Snapshots futuros registram custo em páginas e rendimento por consulta: confirmados, pendentes e exclusivos entre as consultas executadas naquela rodada. Esses registros permitem comparar os próximos 30 dias. Exclusividade de uma rodada não é exclusividade histórica; grupos com frequências diferentes precisam ser comparados por janela de tempo.

## Fontes oficiais para linhas e nomes

- [Fiber: catálogo](https://www.fiberoficial.com.br/collections/tenis)
- [Fiber Barefoot Ultra](https://www.fiberoficial.com.br/products/tenis-barefoot-ultra)
- [Fiber Barefoot Free](https://www.fiberoficial.com.br/products/barefoot-free)
- [Feet of Tomorrow: modelos](https://feetoftomorrow.com.br/)
