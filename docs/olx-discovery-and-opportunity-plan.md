# OLX notebooks: descoberta e classificação de oportunidades

08/10/2026. Escopo: somente OLX. Os itens 5 e 6 abaixo são propostas, ainda não ativadas. A análise histórica encontrou 189 anúncios por ID e 30 candidatos entre R$ 2 mil e R$ 8 mil; isso não comprova máquinas distintas, preços corretos ou compras realizadas.

## 5. Busca por modelos

### Problema e escolha

A busca atual exige a CPU no card antes de abrir o detalhe. Títulos como “Helios Neo 16” podem ser perdidos quando a CPU aparece só na descrição. A execução agendada limita a descoberta a 12 cards por CPU; o CLI direto usa 20. Esses limites não comprovam cobertura integral.

| Alternativa | Ganho | Limite | Escolha |
|---|---|---|---|
| Aliases de CPU | Recupera grafias diferentes | Repete consultas semelhantes; não resolve CPU ausente do título | Usar onde houver falha comprovada |
| Famílias de notebooks | Recupera títulos genéricos | Mistura configurações e gerações | Primeira expansão recomendada |
| GPU genérica | Amplia descoberta | Muitas peças, desktops e CPUs fora da lista | Experimento posterior |
| Notebook gamer | Muito abrangente | Alto custo de detalhes e pouco controle | Baixa prioridade inicial |

### Cadastro inicial proposto

Registro separado da lista de CPUs compartilhada com outros marketplaces:

| Consulta inicial | Família/aliases de classificação |
|---|---|
| `helios neo 16` | Predator Helios Neo, PHN16-72 |
| `rog strix g16` | Strix G16, G614 |
| `legion pro 5` | Legion Pro 5/5i |
| `dell g16` | Dell G16; confirmar variante |
| `avell a65` | A65 ION |
| `avell storm` | Storm 460; confirmar variante |

Esses modelos podem ter CPUs diferentes. O nome da família ajuda a descobrir e normalizar, mas não substitui a confirmação de CPU/GPU no anúncio. CPU fora da lista continua rejeitada; CPU não identificada fica pendente.

### Fluxo e orçamento

1. Manter as seis CPUs prioritárias como núcleo.
2. Começar com duas consultas de famílias por rodada, em rotação. Percorrer seis famílias em três rodadas bem-sucedidas. A expansão deve caber em um orçamento total de acessos, aproveitando a redução de frequência das consultas secundárias.
3. Alternar passagens por mais recentes e por menor preço. A primeira favorece novidade; a segunda encontra anúncios antigos com preço alterado. A OLX documenta essas ordenações e explica que informações incompletas podem reduzir relevância: [busca e filtros](https://ajuda.olx.com.br/s/article/problemas-com-a-busca-e-filtros-de-busca). Confirmar na interface a URL de cada ordenação antes de adicionar parâmetros novos.
4. Separar descoberta de detalhes: proposta inicial de até 40 cards por consulta e até seis detalhes novos de famílias por rodada. São parâmetros para calibração, não capacidade comprovada.
5. Filtrar categoria, peças/defeitos declarados e preço no card. Nas consultas por família, não exigir CPU no card; confirmar no detalhe.
6. Deduplicar ID/URL canônica antes de abrir detalhes. Um ID encontrado em três consultas gera uma leitura e uma notificação.
7. Guardar candidatos excedentes em fila, com expiração. Falha de leitura não vira sucesso vazio; saturação do limite deve aparecer como cobertura parcial.
8. Manter cobertura por consulta (`cpu:14700hx`, `family:helios-neo`) separada da classificação da máquina. Encontrar CPU numa busca por modelo não prova execução da busca específica dessa CPU.

### Persistência e cache

Registrar `matched_queries`, `discovery_method`, `first_observed_at`, `model_family`, `model_code`, `configuration_fingerprint` e estado da validação. Cache depende de título, preço, versão da validação e idade da leitura; alterações exigem nova conferência.

IDs diferentes podem ser republicações da mesma máquina. Modelo/configuração/localização são sinais, não prova de identidade. Marcar possível republicação em vez de fundir automaticamente; limitar o peso desses grupos na referência de preço. Não é necessário guardar contatos pessoais para essa finalidade.

### Medir o ganho

Após 14 dias, avaliar por consulta: candidatos adicionais validados no orçamento, detalhes abertos por candidato adicional, pendências/rejeições, atraso do alerta, falhas/bloqueios e saturação dos limites. Contar ganho incremental sobre CPUs, não quantidade bruta de cards.

A ordem das consultas influencia quem encontra primeiro um ID. Alternar a ordem experimental e conservar todas as consultas que encontraram cada anúncio. Ausência de resultados em uma janela curta não prova que uma família nunca tem boas ofertas.

## 6. Classificação de oportunidades

### Três critérios separados

1. **Qualidade dos dados:** validado, pendente ou rejeitado na leitura automática.
2. **Adequação:** equipamento atende ao perfil e orçamento do comprador?
3. **Preço relativo:** qual sua posição entre comparáveis confiáveis?

Desconto não aumenta confiança no vendedor. Validado na coleta não confirma autenticidade, estado físico ou entrega. Garantia e nota fiscal permanecem declarações do anúncio até confirmação humana.

### Referência por comparáveis

Usar os 45 dias anteriores à avaliação, com preferência por observações recentes. Selecionar uma última observação VALIDADA por anúncio, excluir o próprio anúncio avaliado e comparar nesta ordem:

1. Mesmo modelo/variante, CPU, GPU, estado declarado e configuração semelhante.
2. Mesma família/chassi, CPU, GPU e estado, indicando comparação mais ampla.
3. CPU/GPU em outras famílias somente como faixa indicativa.

A NVIDIA informa que desempenho varia entre modelos de notebooks e recomenda conferir suas especificações: [RTX 40 para laptops](https://www.nvidia.com/en-us/geforce/laptops/40-series/). Mesmo nome de GPU não implica mesma potência, refrigeração ou desempenho. TGP desconhecido deve permanecer desconhecido.

Calcular mediana e percentis 25/75. Proposta inicial: pelo menos oito anúncios independentes no grupo específico para uma classificação estatística mais firme; com três a sete, mostrar faixa e amostra pequena; abaixo disso, somente gatilhos absolutos configuráveis. Esses mínimos precisam de calibração.

Não contar 50 observações diárias do mesmo anúncio como 50 comparáveis. Não usar como referência principal o menor preço que cada anúncio teve em dois meses: isso favorece erros e escolhe retrospectivamente seu melhor instante. Possíveis republicações não devem dominar a amostra.

Excluir da referência parcelas, entradas, peças e leituras divergentes. Preço anômalo vai para revisão com motivo registrado; não removê-lo silenciosamente nem concluir fraude. O histórico antigo precisa de revisão antes de servir como referência confiável, pois inclui a falha de validação identificada.

### Custo e categorias

`custo_total = preço_integral + frete_conhecido + upgrades_necessários_com_custo_configurado`

Frete, taxas ou upgrades desconhecidos não equivalem a zero. Não inventar créditos monetários para 32 GB, OLED ou garantia: comparar variantes semelhantes ou usar custos explicitamente configurados.

`diferença_percentual = (mediana_comparável - custo_comparável) / mediana_comparável`

| Categoria proposta | Regra inicial |
|---|---|
| Revisar com prioridade | Configuração adequada, RTX 4060 até R$ 6.500 ou RTX 4070 até R$ 7.000; não garante bom negócio |
| Preço competitivo | Validado e cerca de 10% abaixo de referência específica suficiente |
| Preço muito competitivo | Cerca de 20% abaixo, amostra suficiente, custos conhecidos e sem conflitos |
| Preço anômalo | Diferença extrema ou leitura incompatível: revisão humana antes de promover |
| Pendente | Evidências insuficientes, mesmo com preço baixo |

Evitar um score único que compense evidência ruim com preço baixo. Ordenar por adequação, qualidade dos dados, preço relativo e custo total, mostrando os motivos. Perfis de jogos, tarefas de CPU e trabalho de GPU devem mudar prioridades sem mudar os fatos coletados.

### Alertas e avaliação

Guardar por ID o último alerta entregue, estado, preço e categoria. Alertar na primeira validação elegível, em queda relevante de preço ou promoção de categoria. Não reenviar a cada consulta; confirmar entrega antes de marcar como enviada. Desaparecimento significa não visto, sem inferir venda.

Operar o ranking inicialmente sem novos tipos de alerta e revisar exemplos classificados, incluindo pendentes e rejeitados. Uma simulação histórica deve usar apenas dados disponíveis em cada instante, sem preços ou mínimos futuros. Essa simulação não foi executada nesta tarefa.

Recolher feedback: interessante, preço errado, não atende, duplicado, contatei e comprei. Sem esse retorno, medir qualidade e preço relativo; não alegar economia realizada ou precisão de compra.

## Sequência futura recomendada

1. Observar a cobertura real da validação implementada nos itens 1–4.
2. Introduzir duas consultas de famílias por rodada, com fila e orçamento.
3. Medir ganho incremental e ajustar consultas/limites.
4. Criar referência por comparáveis, exibindo qualidade e tamanho da amostra.
5. Revisar classificações sem novos alertas.
6. Ativar alertas de oportunidade com deduplicação e feedback.

Os itens 5 e 6 permanecem propostas. Não foram ativados nem usados para enviar notificações nesta tarefa.
