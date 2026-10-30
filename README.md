# Monitor OLX, Enjoei & Mercado Livre — monitoramento de produtos

## Validação e retomada de notebooks OLX

- As quatro CPUs prioritárias são consultadas primeiro: 14700HX, 13980HX, 14900HX e 13900HX. As demais seguem rodízio e frequência por rendimento. Intel de 12ª geração está fora da seleção; falhas ou ausência de cobertura não contam como sucesso.
- `-FullSweep` em `scripts/run-olx-monitor.ps1` consulta todos os termos. O CLI correspondente aceita `--full-sweep`; `--cpu` consulta explicitamente os termos solicitados.
- Preço é lido do elemento do anúncio ou de sua oferta estruturada, comparado com a listagem. Divergências de preço/especificações, possível parcela/entrada ou falta de evidência deixam o candidato pendente. RAM do sistema é separada da VRAM.
- Descrição reprovada mantém o anúncio rejeitado e fora das ofertas válidas. Pendentes aparecem em seção própria do relatório/painel e não entram nos alertas de novas ofertas ou alterações de preço válidas. “Validado” é conferência automática dos dados, sem confirmação de estado físico, autenticidade ou entrega.
- Cache de detalhe só reusa validação da versão atual, com título/preço iguais e leitura de até 12 horas. O histórico anterior precisa de nova leitura; não recebe validação retroativa.
- A conexão é renovada após a pausa entre lotes. Falha transitória de busca recebe uma tentativa adicional após 30 segundos, com sessão nova; não repete os termos já concluídos.
- `data/olx/collection-progress.json` grava a fila após cada termo. Uma nova execução pode retomar uma rodada incompleta de até seis horas, com a mesma configuração, preservando resultados concluídos e a referência anterior. Artefatos do relatório continuam sendo salvos por lote e ao final.
- Verificação, login ou limite interrompem a rodada e preservam os termos restantes. A pausa de acesso é de 24 horas; após liberação manual, `-ResumeAfterVerification` / `--resume-after-verification` permite retomar. `-FullSweep` não contorna esse bloqueio.
- O desenho aprofundado das futuras buscas por modelos e do ranking está em [docs/olx-discovery-and-opportunity-plan.md](docs/olx-discovery-and-opportunity-plan.md). Esses dois recursos ainda não foram ativados.

## Tênis barefoot e minimalistas no Enjoei

- Mantém masculino, numeração 42 e preço anunciado até R$ 500. Tamanho é confirmado nos campos/variações disponíveis; não é inventado quando a API omite a numeração.
- Prioriza Fiber e FOT em toda rodada. FOT aceita **somente Walka, Lito, Noga, Voet e Bruk**, inclusive quando o modelo é confirmado na descrição; Urban, Rudo, Kava e Yuva são excluídos. FOT sem modelo identificado fica pendente. As regras atuais também filtram os relatórios antigos no painel e nos alertas.
- Fiber exige identificação de linha de tênis barefoot (Ultra, Free ou Racing); Fly/Recovery, Running Fire, Echoa e Maxis são excluídos. Sapatilhas convencionais continuam excluídas; FiveFingers anunciado como sapatilha é aceito. A palavra “foto” não comprova FOT.
- Marca/linha identificada pode confirmar o candidato automaticamente; Merrell genérico, marketing “minimalista” e “zero drop” isolado ficam pendentes. Para marcas não identificadas, a descrição precisa declarar biqueira larga, zero drop e solado fino/flexível. Isso não autentica o produto nem comprova seu estado físico.
- Candidatos pendentes aparecem separados no painel e não entram nos alertas de ofertas confirmadas. Relatórios históricos reapresentados também respeitam a regra atual.
- Agenda: quatro consultas prioritárias a cada rodada (`fiber`, `feet of tomorrow`, `fot walka`, `barefoot`); Lems e Vita Barefoot a cada 24 horas; outras marcas/modelos em rodízio a cada 72 horas. Aliases `fot lito/noga/voet/bruk`, `fot`, `freet`, `minimalista(s)` e buscas complementares Fiber/FOT sem departamento iniciam ciclos semanais, retomados até concluir. Os aliases atraem resultados aproximados: os modelos FOT também são conferidos nas buscas prioritárias pela marca e por barefoot. Tamanho 42 é reconferido nas consultas complementares.
- Orçamento padrão: **12 páginas habituais + até 6 páginas de descoberta**, duas páginas por termo habitual e três minutos. A primeira página das prioritárias é atualizada antes de continuar seus cursores antigos. Termos adiados não são marcados como pesquisados. O painel separa prioridade, diárias, rodízio e descoberta; cobertura nova aparece em implantação até ser concluída. Frequências são intervalos mínimos, sujeitos ao orçamento e à execução das rodadas.
- Cursores persistidos por consulta, independentes da ordem/lista e da versão do classificador; mudanças de tamanho/departamento/preço reiniciam o contexto correspondente. Cache de até mil descrições por título/marca: 24 horas para Fiber/FOT e sete dias para outros candidatos; alteração apenas de preço não invalida descrição. Até **quatro** leituras novas por rodada, marcas prioritárias primeiro. Limites configuráveis por `ENJOEI_SHOE_PAGES_PER_TERM`, `ENJOEI_SHOE_MAX_PAGES`, `ENJOEI_SHOE_DISCOVERY_PAGES`, `ENJOEI_SHOE_MAX_MINUTES` e `ENJOEI_SHOE_DETAIL_MAX`.
- O teto continua R$500, sem frete/taxas. A preferência de marca ordena as ofertas antes do preço; não presume desconto sobre um preço novo nem autenticidade. Detalhes da política em [docs/enjoei-barefoot-plan.md](docs/enjoei-barefoot-plan.md).

## Visão geral

Sistema modular de monitoramento diário (2× por dia, 07:00 e 16:00 BRT). Busca em OLX (scraping + Playwright) e Enjoei (GraphQL API). Envia WhatsApp (CallMeBot); e-mail (Gmail) é opcional e está desativado por padrão. O Mercado Livre roda sob demanda. Dashboard HTML em GitHub Pages. Requer Node.js 20 ou superior (CI usa Node 22).

**Principais características:**
- Filtros semânticos profundos: CPU exatas, voltagem (110V vs 220V), capacidade (ml), termos de exclusão (defeito, mamadeira), part numbers
- Histórico persistido: distinção novo × mudança de preço, com delta (±R$), teto de R$ 10 mil
- Multi-fonte unificada (OLX + Enjoei no mesmo card)
- Zero custo, sem APIs pagas
- Arquitetura de watchlist extensível: o registro central em `scripts/lib/watchlists-registry.mjs` alimenta o orquestrador, dashboard, saúde e publicação

---

## Monitores principais

### Calças Zegna no Enjoei

- `node scripts/monitor-enjoei-zegna.mjs`: calças masculinas Zegna (incluindo Ermenegildo Zegna e Zegna Sport), tamanho de cintura 40, preço anunciado **menor que R$ 250**; frete e taxas não entram nesse teto.
- Usa a busca-base fornecida, com categoria e tamanho na API, e reconfere esses campos em cada produto. Pesquisa em todo o Brasil, sem depender de uma localização de sessão para ordenar por proximidade.
- Integrado às rodadas existentes do Enjoei (07h e 16h), aos alertas e ao painel. Dados em `data/enjoei-zegna`; override `ENJOEI_ZEGNA_DATA_DIR`. Paginação limitada a dez páginas; falhas preservam os anúncios anteriores e sinalizam cobertura incompleta.

### Jeans Ricardo Almeida no Enjoei

- `node scripts/monitor-enjoei-ricardo-almeida.mjs`: jeans masculinos Ricardo Almeida, cintura 40, preço anunciado **menor que R$ 250**, sem frete/taxas, em todo o Brasil.
- Marca e tamanho são conferidos no anúncio. Exige tecido jeans/denim; sarja, linho e calças sociais não entram pela marca. Se a listagem omitir categoria ou tecido, consulta a ficha do produto, até oito leituras por rodada, com cache de 12 horas. Candidatos sem confirmação aparecem separados e não geram alerta de oferta válida.
- Integrado às rodadas do Enjoei (07h e 16h), painel e alertas. Dados em `data/enjoei-ricardo-almeida`; override `ENJOEI_RICARDO_ALMEIDA_DATA_DIR`. Até dez páginas por coleta; falhas preservam o histórico e sinalizam cobertura incompleta.

### Jeans Jacob Cohën e Brunello Cucinelli no Enjoei

- Somente jeans masculinos, cintura **40**. Jacob Cohën: preço anunciado **menor que R$ 250**. Brunello Cucinelli: preço anunciado **até R$ 400, inclusive**. Frete e taxas ficam fora desses tetos.
- `node scripts/monitor-enjoei-jacob-cohen.mjs` e `node scripts/monitor-enjoei-brunello-cucinelli.mjs`. Jacob Cohën é reconhecido com ou sem acento. Marca, categoria, numeração disponível e tecido são conferidos; sarja e calças sociais não são aceitas apenas por serem da marca.
- Compartilham o coletor de jeans com Ricardo Almeida: até dez páginas, até oito leituras de ficha por rodada/marca e cache de 12 horas. Pendentes ficam separados e fora dos alertas de ofertas válidas.
- Integrados às rodadas das 07h e 16h, painel e alertas. Pastas `data/enjoei-jacob-cohen` e `data/enjoei-brunello-cucinelli`; overrides `ENJOEI_JACOB_COHEN_DATA_DIR` e `ENJOEI_BRUNELLO_CUCINELLI_DATA_DIR`.

### Outras marcas de jeans no Enjoei — até R$ 350

Big John e Denime foram excluídas das coletas em 15/10/2026 a pedido do usuário. O histórico anterior foi preservado.

- Momotaro Jeans, Pure Blue Japan (PBJ), The Strike Gold, Kapital, Fullcount e OrSlow. Somente jeans masculinos, cintura **40**, preço anunciado **até R$ 350, inclusive**, sem frete/taxas.
- `node scripts/monitor-enjoei-japanese-jeans.mjs` coleta as seis marcas ativas em sequência; `--watchlist pure-blue-japan` permite selecionar uma delas. Configurações em `scripts/lib/enjoei-japanese-jeans.mjs`; cada marca possui pasta, relatório, histórico e estado de saúde próprios.
- PBJ/Pure Blue Japan e OrSlow/Or Slow têm buscas alternativas, com deduplicação. Resultados aproximados do Enjoei precisam confirmar a marca no título/campo de marca.
- Usa o mesmo coletor de jeans: categoria, numeração e tecido conferidos, até dez páginas por termo e oito fichas por marca, com cache de 12 horas. Incluído nas rodadas das 07h e 16h, painel e alertas; candidatos sem confirmação ficam separados.

| Nome | Fonte | Faixa | Detalhes |
|---|---|---|---|
| **OLX Notebooks** | OLX (20 CPUs + famílias em rodízio) | R$ 2.000–8.000 | RAM ≥32 GB, CPU confirmada (mudança até R$ 10k) |
| **Enjoei Notebooks** | Enjoei (GraphQL) | R$ 1.500–8.000 | 20 CPUs, RAM ≥32 GB |
| **Enjoei Tênis 42** | Enjoei (GraphQL) | até R$ 500 | Masculino, tamanho 42; 24 termos, variantes e descrição dos candidatos |
| **Enjoei Calças Zegna 40** | Enjoei (GraphQL) | menos de R$ 250 | Masculino, cintura 40; inclui Ermenegildo Zegna e Zegna Sport |
| **Enjoei Jeans Ricardo Almeida 40** | Enjoei (GraphQL) | menos de R$ 250 | Masculino, cintura 40; jeans/denim confirmado |
| **Enjoei Jeans Jacob Cohën 40** | Enjoei (GraphQL) | menos de R$ 250 | Masculino, cintura 40; jeans/denim confirmado |
| **Enjoei Jeans Brunello Cucinelli 40** | Enjoei (GraphQL) | até R$ 400 | Masculino, cintura 40; jeans/denim confirmado |
| **Enjoei Jeans — Momotaro, PBJ, Strike Gold, Kapital, Fullcount, OrSlow** | Enjoei (GraphQL) | até R$ 350 | Masculino, cintura 40; monitor separado por marca |
| **Dockstations — pausada** | OLX + Enjoei + ML sob demanda | até R$ 500 | SD25TB4 e WD22TB4; histórico preservado |
| **Fitbit Air — pausada** | OLX + Enjoei | R$ 300–600 | Smartwatch Fitbit Air exato |
| **Lifefactory** | OLX + Enjoei | R$ 25–75 | Garrafa térmica 500ml–1L (exclui mamadeira, bivolt OK) |
| **Tela Galaxy Book3** | OLX + Enjoei | até R$ 1.000 | Part number BA96-08462A (Galaxy Book3 Ultra) |
| **Melanger** | OLX (2 categorias) + Enjoei | R$ 1.000–5.000 | Moinho de chocolate 110V (exclui 220V puro, bivolt OK) |
| **Galaxy Buds4 Pro** | OLX + Enjoei + Mercado Livre | R$ 500–1.000 | Busca pausada; dados históricos preservados |
| **OnePlus Buds Pro 3** | OLX + Enjoei | R$ 300–800 | Exclui linha Nord e modelos próximos |
| **Google Pixel Watch 4 — pausada** | OLX + Enjoei | Wi‑Fi até R$ 2.000 · LTE até R$ 2.500 | Somente 45 mm |
| **Google Pixel Watch 5** | OLX + Enjoei + ML sob demanda | R$ 1.000–2.200 (inclusive) | Somente 45 mm; Wi-Fi e LTE |
| **Oura Ring 5 — pausada** | OLX + Enjoei | R$ 1.800–2.700 | Tamanhos 9–11 |
| **Monitores OLED** | OLX + Enjoei; ML sob demanda | R$ 1.500–3.000 | Modelo e descrição conferidos, cache de 24h, descoberta e rodízio |

Agenda, filtros, limites e critérios de aprovação: [política de monitores OLED](docs/oled-monitor-search-policy.md).

**OLX: 2 categorias customizadas para Melanger**
- `https://www.olx.com.br/eletro/eletroportateis-para-cozinha-e-limpeza?q=melanger`
- `https://www.olx.com.br/comercio-e-escritorio/gastronomia?q=melanger`

---

## Rodar manualmente

```powershell
# Watchlists individuais
npm run monitor:olx
npm run monitor:enjoei-notebooks
npm run monitor:enjoei-tenis
npm run monitor:dockstations
npm run monitor:fitbit
npm run monitor:lifefactory
npm run monitor:tela-galaxybook3
npm run monitor:melanger

# Todos em paralelo + notificação e-mail/WhatsApp
npm run monitor:todos

# Forçar envio mesmo sem novidades (teste)
npm run monitor:todos:forcar-email

# Regenerar dashboard HTML
npm run dashboard

# Mercado Livre com perfil autenticado
npm run mercadolivre:login
# Entre na conta, feche esse Chrome e execute:
npm run monitor:mercadolivre

# Ver ou operar notificações pendentes
npm run monitor:notificacoes
node scripts/manage-notification-outbox.mjs --retry ID
node scripts/manage-notification-outbox.mjs --discard ID

# Limitar o histórico de snapshots/relatórios por fonte (padrão: 120 rodadas)
npm run data:prune -- --keep-runs 120

# Local + commit + push automático (PowerShell Windows)
.\scripts\run-local-olx-and-publish.ps1
```

**Flags opcionais:**
- `--skip-olx`, `--skip-enjoei`, `--skip-dockstations`, etc: pula watchlist específica
- `--dry-run`: simula notificações sem enviá-las nem gravar status
- `--skip-monitors --dry-run`: testa apenas notificações com relatórios salvos

---

## Variáveis de ambiente

**Credenciais (notificação):**
O WhatsApp usa `CALLMEBOT_PHONE` e `CALLMEBOT_APIKEY`. Para ativar o e-mail,
defina também `NOTIFY_EMAIL_DISABLED=0`, `GMAIL_USER` e `GMAIL_APP_PASSWORD`.
Sem essa ativação, o e-mail é ignorado inclusive com `--force-email`.

```powershell
setx NOTIFY_EMAIL_DISABLED "0"       # somente se quiser reativar e-mail
setx GMAIL_USER       "seu@gmail.com"
setx GMAIL_APP_PASSWORD "xxxx xxxx xxxx xxxx"    # senha de app Google
setx NOTIFY_EMAIL_TO  "destino@email.com"
setx CALLMEBOT_PHONE  "5541999999999"            # número com DDI, sem +
setx CALLMEBOT_APIKEY "123456"                   # chave CallMeBot
```

**Diretórios de dados (opcional, default interno):**
```powershell
setx OLX_DATA_DIR                    "C:\caminho\data\olx"
setx ENJOEI_DATA_DIR                 "C:\caminho\data\enjoei"
setx ENJOEI_NOTEBOOKS_DATA_DIR       "C:\caminho\data\enjoei-notebooks"
setx DOCKSTATIONS_DATA_DIR           "C:\caminho\data\dockstations"
setx FITBIT_DATA_DIR                 "C:\caminho\data\fitbit"
setx LIFEFACTORY_DATA_DIR            "C:\caminho\data\lifefactory"
setx TELA_GALAXYBOOK3_DATA_DIR       "C:\caminho\data\tela-galaxybook3"
setx MELANGER_DATA_DIR               "C:\caminho\data\melanger"
```

**GitHub Actions:** mesmas variáveis em `Settings → Secrets and variables → Actions`

Falhas de rede como `fetch failed` são transitórias e entram em nova tentativa.
Entregas antigas já marcadas como `blocked` exigem revisão com
`npm run monitor:notificacoes`; use `--retry ID` para reenviar ou `--discard ID`
para descartar uma mensagem antiga. Bloqueios do Cloudflare exigem atenção e
ficam identificados no painel; eles não são resolvidos por repetição automática.

**Dashboard público:** os botões locais não publicam o caminho da máquina. Eles
usam `OLX_DAILY_REPO` quando definido; caso contrário, assumem
`$HOME\Downloads\olx-daily` no PowerShell.

---

## GitHub Actions (CI)

**Workflow:** `.github/workflows/monitor.yml` (disparado via `workflow_dispatch` por cron-job.org)

**Fluxo:**
1. Checkout do main
2. Setup Node 22 + dependências
3. Instala Playwright + Chromium
4. Roda as watchlists remotas (OLX e Mercado Livre ficam locais):
   - Enjoei Notebooks
   - Enjoei Tênis
   - Dockstations
   - Fitbit
   - Lifefactory
    - Tela Book3
    - Melanger
    - Galaxy Buds4 Pro
    - Oura Ring 5
    - Monitores OLED
5. **Notifica**: e-mail + WhatsApp se totais > 0 ou errors presentes
6. **Loop de publicação** (até 4 tentativas):
   - `git fetch origin`
   - `git rebase -X theirs origin/main` (resolve conflito de `index.html` automaticamente)
   - Regenera dashboard `generate-dashboard.mjs` (com dados frescos de origin)
   - Amend ao commit anterior se houver mudança no dashboard
   - `git push origin main` (com retry exponencial)

**Por que `rebase -X theirs`:**  
Local e CI disparam juntos (16h). Ambos geram um `index.html` diferente. A estratégia `theirs` pega a versão do origin (CI traz os dados frescos), e logo após regeneramos o dashboard com tudo integrado.

---

## Dashboard

**URL:** `https://almeida3339.github.io/olx-daily/` (GitHub Pages)

**Geração:** `generate-dashboard.mjs` lê os **5 reports mais recentes** de cada watchlist (com novidades) e monta cards com:
- **Novos itens** (até 5 por watchlist)
- **Mudanças de preço** (até 5, com delta: verde desceu, vermelho subiu)
- **Timestamp** da última coleta (convertido UTC→BRT)
- **Specs** para OLX/Enjoei Notebooks; suprimido para Tênis/Dockstations/Fitbit/Lifefactory/Tela/Melanger

**Filtro retroativo:** itens acima de R$ 10 mil são suprimidos da exibição (mesmo de relatórios antigos pré-filtro).

---

## Relatórios

**Estrutura `data/`:**
```
data/
  olx/
    report-2026-06-10T10-27-53-123Z.md
    snapshot-2026-06-10T10-27-53-123Z.json
  enjoei-notebooks/
    report-2026-06-03T08-00-42-419Z.md
    snapshot-2026-06-03T08-00-42-419Z.json
  enjoei/
    report-2026-06-03T08-00-53-125Z.md
    snapshot-2026-06-03T08-00-53-125Z.json
  dockstations/
    report-2026-06-05T10-27-31-515Z.md
    snapshot-2026-06-05T10-27-31-515Z.json
  fitbit/
    report-2026-06-05T10-27-16-012Z.md
    snapshot-2026-06-05T10-27-16-012Z.json
  lifefactory/
    report-2026-06-04T13-54-31-515Z.md
    snapshot-2026-06-04T13-54-31-515Z.json
  tela-galaxybook3/
    report-2026-06-04T13-58-28-093Z.md
    snapshot-2026-06-04T13-58-28-093Z.json
  melanger/
    report-2026-06-10T20-43-31-091Z.md
    snapshot-2026-06-10T20-43-31-091Z.json
```

**Relatório (`report-*.md`):**
```markdown
# Monitor OLX Notebooks — 2026-06-10

## Resumo executivo
- Novos anúncios válidos (R$ 2.000–R$ 8.000): **3**
- Alterações de preço detectadas: **2**
- (... mais stats)

## Novos anúncios (R$ 2.000–R$ 8.000)
- R$ 7.500 — Notebook Asus i9 — 32GB RAM / 1TB — https://...

## Mudanças de preço
- R$ 8.000 → R$ 7.200 — Asus ROG Strix — https://...
```

**Snapshot (`snapshot-*.json`):**
```json
{
  "timestamp": "2026-06-10T10:27:53.123Z",
  "items": [
    {
      "id": "1234567",
      "url": "https://...",
      "title": "Notebook Asus i9 14900HX",
      "price_brl": 7200,
      "ram_gb": 32,
      "storage_gb": 1024,
      "status": "active",
      "first_seen": "2026-06-08T10:15:00Z",
      "last_seen": "2026-06-10T10:27:00Z",
      "desc_checked": true
    }
  ]
}
```

---

## Arquitetura de Watchlist

**Padrão modular** (`lib/watchlist-monitor.mjs`):

```javascript
runWatchlistMonitor({
  label: "Lifefactory",
  dataDir: "...",
  profileDir: ".chrome-lifefactory-profile",
  terms: ["lifefactory"],                              // busca
  minPrice: 25,
  maxPrice: 75,
  minSizeMl: 500,                                      // filtro capacidade
  maxSizeMl: 1000,
  excludeTerms: ["mamadeira"],                         // exclusão
  keepTerms: ["garrafa"],                              // override exclusão
  olxCategoryUrls: [                                   // OLX categorias custom
    "https://www.olx.com.br/eletro/...",
    "https://www.olx.com.br/comercio-e-escritorio/...",
  ],
})
```

**Suportado por watchlist:**
- `minPrice`, `maxPrice`: faixa de preço
- `terms`: palavras-chave para buscar (array)
- `minSizeMl`, `maxSizeMl`: filtro de capacidade em ml (opcional, e.g. garrafas)
- `excludeTerms`: palavras que descartam itens (e.g. "220v", "mamadeira")
- `keepTerms`: override — mantém item mesmo que case excludeTerm (e.g. "bivolt" vence "220v")
- `olxCategoryUrls`: URLs de categoria OLX (default: busca geral `/brasil`)

**Cada watchlist é um arquivo mínimo** (~20 linhas):
- `scripts/monitor-dockstations.mjs`
- `scripts/monitor-fitbit.mjs`
- `scripts/monitor-lifefactory.mjs`
- `scripts/monitor-tela-galaxybook3.mjs`
- `scripts/monitor-melanger.mjs`

Adicionar uma nova: copiar um, mudar config, pronto.

---

## Coleta OLX (Notebooks)

**Arquivo:** `scripts/monitor-olx-notebooks-por-cpu.mjs`

**Características especiais:**
- **20 CPUs de notebooks**, sem Intel de 12ª geração. Regras, agenda e orçamentos: [política de notebooks](docs/notebook-search-policy.md).
- **Enriquecimento de specs**: RAM, SSD, GPU extraídos da página de detalhe
- **Filtro de defeitos** (descrição): "defeito", "avaria", "não liga", "não ligou", "queimou", "surto elétrico", "retirada de peças"
- **Abertura de detalhe:** sempre abre itens na faixa do relatório (R$ 2k–8k), mesmo com specs completas em listagem, para validar descrição contra defeitos
- **Persistência de validação:** marca `desc_checked: true` nos itens verificados, força reabertura se histórico antigo não tem essa marca
- **Infinite scroll:** aguarda estabilização dos cards; bloqueios ou verificações interrompem a coleta.
- **Deduplicação:** ignora itens já no snapshot em dias anteriores
- **Progresso por lote:** salva snapshot, relatório e manifesto antes da pausa entre lotes. O lote intermediário fica marcado como coleta em andamento e cobertura parcial; o resultado final é salvo em outro artefato.
- **Cobertura por CPU:** registra termos concluídos, falhas e termos não consultados. Os anúncios dos termos sem cobertura são preservados. Uma falha de termo retorna código de erro após salvar os dados válidos.
- **Pausas com horário:** informa a conclusão do lote e a previsão de retomada no fuso de Brasília, com atualização a cada cinco minutos. Exemplo: `Lote concluído (15/22 termos) às 19:33. Pausa de 46 min antes do próximo lote (por volta de 20:20)...`
- **Saída UTF-8:** os scripts PowerShell configuram a leitura e o encaminhamento da saída do Node para manter os acentos no terminal e no transcript.

---

## Coleta Enjoei

**Arquivo:** `scripts/lib/watchlist-monitor.mjs` (função `collectEnjoei`)

**Características:**
- **GraphQL API** em `enjusearch.enjoei.com.br` (sem Cloudflare)
- **Secondary fetch** para specs: `pages.enjoei.com.br/products/{id}/v2.json`
- **Backfill de specs** do título quando fetch falha
- **Validação de termos**: confirma que CPU/termo está no título/descrição (evita false positives do fuzzy search)

### Notebooks: paginação e retomada

O coletor `scripts/monitor-enjoei-notebooks.mjs` segue o cursor `after` retornado
pela API até uma página vazia ou uma indicação explícita de fim. Uma página com
menos de 30 anúncios também pode ter continuação. Os resultados são deduplicados
por anúncio e passam pelos filtros de preço e pela confirmação de CPU.

- O cursor, os candidatos e os detalhes já confirmados são salvos atomicamente
  após cada página/descrição em `data/enjoei-notebooks/collection-progress.json`
  (ou em `ENJOEI_NOTEBOOKS_DATA_DIR`). O arquivo acompanha a publicação dos dados,
  permitindo retomar também no próximo GitHub Actions.
- Por padrão, cada execução permite até 24 requisições de busca no total, quatro
  páginas por termo e dois minutos incluindo detalhes. `--max-pages` /
  `ENJOEI_NOTEBOOKS_MAX_PAGES` e `--max-minutes` / `ENJOEI_NOTEBOOKS_MAX_MINUTES`
  ajustam esses limites. `--first` aceita 1 a 30.
- Até oito candidatos recebem leitura de descrição por rodada, com cache de 24h
  para resultados positivos e negativos. Falhas ou detalhes ainda não lidos ficam
  na fila e mantêm cobertura parcial; dados conflitantes lidos ficam em revisão.
- Quando há páginas ou descrições pendentes, o relatório detalha o progresso,
  o coletor retorna código 1 e o aviso aparece na notificação/status da rodada.
  Os itens antigos desses termos são preservados. A busca só fica completa após
  confirmar o fim da paginação e resolver os candidatos pendentes.
- Quatro CPUs prioritárias rodam em cada execução; as outras 16 rodam após 24h,
  com retomada de cursores pendentes. Alterações de região, tamanho da página ou
  faixa de preço iniciam um ciclo novo. A cobertura distingue termos agendados
  nesta rodada dos termos configurados.
- Para `aimax395`, o Enjoei usa `ryzen ai max 395`: a palavra `notebook` ampliava
  a busca difusa para milhares de outros modelos. OLX e Mercado Livre mantêm
  suas consultas atuais.

---

## Automação local (Windows)

**Script:** `scripts/run-local-olx-and-publish.ps1`

**Fluxo:**
1. **Espera por internet** (até 20 min): testa TCP 443 em github.com/olx.com.br
2. **Git clean** (untracked Enjoei test files)
3. **Fetch + rebase** inicial
4. **Roda OLX** (via Chrome debug)
5. **Roda Enjoei** monitores (Notebooks, Tênis, Dockstations, Fitbit, Lifefactory, Tela, Melanger)
6. **Loop de publicação** (até 4 tentativas):
   - Commit dados (data/olx, data/dockstations, data/fitbit, data/lifefactory, data/tela-galaxybook3, data/melanger)
   - Fetch + rebase -X theirs origin/main
   - **Regenera dashboard** com dados sincronizados
   - Amend ao commit se houver mudança
   - Push com retry exponencial (3s, 6s, 9s entre tentativas)

**Task Scheduler:**
- `Monitor-OLX-0700`: 07:00 BRT
- `Monitor-OLX-1600`: 16:00 BRT

---

## Chrome Debug (OLX local)

**Script:** `scripts/run-olx-monitor.ps1` + `scripts/start-chrome-debug.ps1`

**Particularidades:**
- **Perfil persistente** `.chrome-olx-profile`: mantém cookies/Cloudflare session entre rodadas
- **Reciclagem obrigatória** a cada rodada: fecha Chrome anterior, abre novo (evita sessão zumbi)
- **Port 9222** (Chrome DevTools Protocol): Playwright comunica via CDP

---

## Testes

**Rodar:** `npm test`

**Cobertura:**
- Parsing de preços BRL (com pontos/vírgulas)
- Extração de RAM/SSD/GPU de títulos e descrições
- Reuso de specs do snapshot anterior
- Filtro de defeitos (excludePatterns)
- Filtro de capacidade (ml)
- Parsing de relatórios (novo count, price count, timestamp)
- Teto de R$ 10 mil retroativo
- Bivolt vs 220V puro

**Estado atual:** 256 testes passando, incluindo filtros semânticos, integração
de notificações, retenção de artefatos e sanitização de caminhos locais.

---

## Troubleshooting

### OLX falha com "exit 1"
**Causa:** Chrome zumbi (PID antigo) segurando port 9222  
**Solução:**
```powershell
# Listar processes Chrome do perfil OLX
Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | 
  Where-Object { $_.CommandLine -like "*chrome-olx-profile*" } | 
  Select-Object ProcessId, CommandLine

# Matar PID específico
Stop-Process -Id 12345 -Force
```

### Dashboard não reflete mudança de preço do Enjoei
**Causa:** CI rodou, mas push falhou (rebase conflict) — dados não chegaram ao repo  
**Solução:** rebase -X theirs resolve, mas certifique regeneração do dashboard pós-sincronização (fluxo fix já aplicado)

### Tarefa local não iniciou por falta de Wi-Fi
**Esperado:** script aguarda até 20 min por conectividade (novo comportamento, desde 2026-06-03)  
**Próxima tentativa:** schedule roda de novo em 2h

### Bivolt errado sendo excluído
**Revisar:** `monitor-melanger.mjs` → `keepTerms` deve incluir "bivolt", "110v", etc.

---

## Estrutura de código

```
scripts/
  lib/
    monitor-core.mjs               ← schema, cobertura, merge e histórico compartilhados
    snapshot.mjs                   ← compatibilidade dos monitores especializados
    watchlist-monitor.mjs          ← coleta OLX/Enjoei e relatório
    mercadolivre-production.mjs    ← coleta e enriquecimento do Mercado Livre
  monitor-olx-notebooks-por-cpu.mjs ← monitores especializados (CPU, defei
tos)
  monitor-enjoei-notebooks.mjs
  monitor-enjoei-tenis.mjs
  monitor-dockstations.mjs         ← watchlists genéricas
  monitor-fitbit.mjs
  monitor-lifefactory.mjs
  monitor-tela-galaxybook3.mjs
  monitor-melanger.mjs
  run-monitors-and-notify.mjs      ← orquestrador (limita concorrência, notifica)
  prune-data.mjs                  ← retenção explícita dos artefatos históricos
  run-local-olx-and-publish.ps1    ← automação Windows (espera rede, push)
  run-olx-monitor.ps1              ← wrapper Chrome debug
  start-chrome-debug.ps1           ← inicia Chrome com port 9222
  generate-dashboard.mjs           ← coleta dados e gera index.html
  lib/dashboard-parsing.mjs        ← parsing de relatórios e timestamps
  lib/dashboard-triggers.mjs       ← comandos dos botões do dashboard
  lib/watchlists-registry.mjs      ← registro único de fontes e diretórios

tests/
  olx-cache.test.mjs
  olx-detail.test.mjs
  parsers.test.mjs
  (suíte distribuída por domínio, cobertura alta)

data/
  olx/, enjoei/, enjoei-notebooks/, dockstations/, fitbit/, 
  lifefactory/, tela-galaxybook3/, melanger/, galaxy-buds4-pro/,
  oneplus-buds-pro-3/, google-pixel-watch-4/, google-pixel-watch-5/,
  oura-ring5/, oled-monitores/, mercadolivre-*/
  (snapshots + relatórios)

.github/
  workflows/
    monitor.yml                    ← CI (cron via workflow_dispatch)

index.html                         ← dashboard gerado
package.json
README.md
.gitignore
```

---

## Histórico de correções recentes

| Data | Problema | Solução |
|---|---|---|
| 03/06 12:03 | OLX exit 1 (Chrome zumbi) | Reciclagem obrigatória de Chrome a cada rodada |
| 03/06 16:00 | CI push falha (rebase conflict) | `rebase -X theirs` + regeneração dashboard pós-sync |
| 03/06 16:01 | Queda de preço tênis não aparece no dashboard | Espera internet antes de iniciar; sempre regenera dashboard após origin |
| 02/06 | Tier consolidation incomplete | Removido sistema de "premium", único tier R$ 2k–8k com teto de 10k em mudanças |
| 02/06 | UTD21B persiste no histórico após swap | Validação de histórico contra termos atuais (`itemMatchesAnyTerm`) |

---

## Notas de design

- **Watchlists + lib compartilhada:** add nova source em minutos sem duplicação
- **Núcleo único:** OLX, Enjoei e Mercado Livre compartilham schema, cobertura, merge, histórico e normalização
- **Compatibilidade retroativa:** snapshots antigos continuam legíveis; novas rodadas usam `schema_version: 2`
- **Persistência de validação (`desc_checked`):** força reabertura de itens antigos sem verificação quando entram novamente na faixa
- **Teto de 10k retroativo:** não filtra itens >10k da coleta (podem ser histórico), mas do dashboard (sempre mostra estado atual)
- **Bivolt override (`keepTerms`):** modelo genérico para exceções em filtros, extensível
- **Rebase -X theirs:** estratégia para CI×Local conflict no index.html, mantendo origem como verdade
- **Chrome perfil persistente:** cookies/session não recriam a cada rodada, só o processo
- **Snapshot JSON minimalista:** só campos usados (sem GPU para Dockstations, sem specs para Tênis)

### Mercado Livre

As buscas agora usam uma cadencia adaptativa: notebooks executam no maximo 6 CPUs por rodada. Termos recentes recebem prioridade; termos vazios entram em rotacao mais lenta. Use `--full-sweep` para uma varredura completa, `--force` para ignorar a cadencia e `--clear-cooldown` somente depois de resolver login, challenge ou limite. Uma verificacao ativa uma pausa persistente de 24 horas; limite de acessos, 12 horas. As pausas antigas calculadas em dias sao migradas para horas, preservando o instante do bloqueio.

Cada coleta nova e promovida por `latest-run.json` apenas depois de snapshot, relatorio e checksum validados. Itens malformados vao para `quarantine/` sem invalidar os demais resultados. O painel usa o historico limitado de rodadas para sinalizar degradacao recorrente, exibir preco atual versus minimo observado e mostrar pendencias da outbox de notificacoes.

- `npm run monitor:mercadolivre:notebooks`: busca consolidada dos processadores.
- `npm run monitor:mercadolivre:watchlists`: executa as demais listas em sequência.
- `npm run monitor:mercadolivre`: executa toda a fila do Mercado Livre.
- A busca Galaxy Buds4 Pro está pausada nas filas automáticas locais e do Mercado Livre. Histórico e anúncios publicados continuam disponíveis; os painéis deixam de sinalizar essa watchlist como desatualizada.
- Para executar essa watchlist pontualmente, use `node scripts/monitor-mercadolivre-watchlists.mjs --watchlist galaxy-buds4-pro --include-paused` (Mercado Livre) ou `node scripts/monitor-galaxy-buds4-pro.mjs --include-paused` (OLX + Enjoei). A pausa automática permanece ativa.
- O perfil autenticado fica em `.chrome-mercadolivre-profile` e aceita somente uma coleta por vez.
- Desafio, limitação ou sessão expirada interrompem a fila sem apagar o histórico anterior.
- Notebooks são coletados entre R$ 2.000 e R$ 10.000; o painel mostra somente até R$ 8.000.
- Galaxy Buds4 Pro é uma watchlist oficial na faixa de R$ 500 a R$ 1.000, com variantes de escrita e envio local.
- Fichas técnicas são abertas apenas para anúncios novos ou incompletos, com limite por rodada.
- A rotina automática local de OLX/Enjoei não abre o Mercado Livre. Para o ML, use `npm run mercadolivre:publicar`: a coleta é publicada e os resultados somente daquela rodada são notificados.
- O disparo padrão completa todos os termos de notebooks que estão vencidos,
  em lotes de até seis CPUs. Cada lote salva um snapshot e atualiza a agenda.
  Termos sem sucesso anterior têm prioridade. `-FullSweep` consulta todas as
  CPUs em lotes, inclusive as recentes; login, limite e desafio continuam
  interrompendo a fila. Retomar o disparo padrão aproveita os lotes concluídos.
- Se já existe bloqueio registrado, o comando encerra antes da coleta e informa
  o horário em Brasília e o comando de recuperação. Esse disparo não envia uma
  nova notificação nem publica arquivos gerados sem uma coleta.
- Para resolver uma verificação/login, use
  `npm run mercadolivre:publicar -- -Recover` ou, na pasta do projeto,
  `& .\scripts\run-mercadolivre-and-publish.ps1 -Recover`.
  O Chrome abre visível no perfil exclusivo. Resolva a verificação/login
  manualmente, volte à página da busca e pressione Enter no terminal.
  A pausa só é removida após reconhecer resultados ou uma busca vazia válida;
  se a verificação continuar, o bloqueio é mantido. Depois, a coleta continua
  visível e publica normalmente. Feche previamente outras janelas desse perfil.
  Um limite de acessos ainda ativo exige aguardar a pausa; `-Recover` não o remove.
- `-Visible` mostra a coleta, mas mantém a pausa registrada. `-Recover` inclui a
  etapa manual de recuperação; `--clear-cooldown` é uma opção do coletor Node,
  não um parâmetro do publicador PowerShell.
- Uma página reconhecida como busca sem resultados conclui o termo com zero
  anúncios. Falta de cards sem essa indicação continua sendo falha de coleta.
- Falha na coleta do Mercado Livre gera código de saída diferente de zero mesmo quando os dados parciais foram publicados; `-NoPush` não envia notificações.
- O resumo e o WhatsApp incluem as falhas registradas nos relatorios da rodada. Uma fila impedida por verificacao ou login tambem retorna erro, mesmo sem relatorio novo. Termos nao consultados depois de uma interrupcao mantem seu estado anterior.
- A publicacao seleciona todas as pastas ML do registry, inclusive no Windows PowerShell 5.1. Snapshot, relatorio, manifesto e historico sao publicados juntos.
- A publicação manual inclui também `mercadolivre-oled-monitores`.
- No GitHub Actions o Mercado Livre permanece desativado por não haver perfil autenticado.
- A visão de notebooks do Mercado Livre está consolidada no `index.html`; o dashboard experimental separado foi removido.
- Reaparecimentos não são tratados como novos; mudanças de preço continuam sendo alertadas.
- Itens cujos termos saem da configuração são arquivados como `out_of_scope`.

### Saúde, histórico e recuperação local

- A saúde registra a última consulta de cada termo por marketplace. Sucesso no
  Enjoei não limpa uma falha da OLX, e um lote ML não significa cobertura completa.
- O histórico retém as 120 rodadas mais recentes. Registros podem ser recuperados
  dos manifestos salvos com `node scripts/repair-monitor-history.mjs`.
  Duração desconhecida aparece sem valor, em vez de zero.
- Relatórios usam LF no Git. A leitura aceita conversão CRLF de checkouts antigos
  sem aceitar alterações no conteúdo do relatório.
- Tarefas locais recuperam horários perdidos, continuam na bateria e têm limite
  de quatro horas. O publicador impede execuções simultâneas no mesmo checkout.
  O catchup compara a última publicação com o horário previsto mais recente.
  Falhas têm até duas novas tentativas com intervalo de 15 minutos; ausência de
  conexão é registrada como falha. O marcador de publicação evita repetir uma
  rodada que já conseguiu publicar seus dados.
- Falhas transitórias de navegação OLX têm uma nova tentativa; ausência de cards
  sem mensagem explícita de busca vazia continua sendo falha. Verificação exige
  intervenção humana no perfil da watchlist, com `--visible`.
- Um bloqueio Cloudflare interrompe as próximas consultas OLX da watchlist e
  grava uma pausa de 24 horas, sem estendê-la em cada disparo. `--visible` permite
  tentar a recuperação manual. Se a página disser que o acesso foi bloqueado
  sem oferecer verificação, é necessária liberação pelo site; o coletor não
  tenta contornar esse bloqueio.
- Erros do CallMeBot incluem uma resposta sanitizada do provedor. Credenciais e
  telefone são codificados nos parâmetros e não aparecem em logs públicos.
  Uma resposta HTTP 201 com `ERROR` não é considerada entrega bem-sucedida.
- Para arquivar uma pendência sem apagar seu histórico, use
  `node scripts/manage-notification-outbox.mjs --archive ID --source local`.
  `--archive-blocked` seleciona todos os alertas bloqueados do ambiente indicado.
  Repita com `--source ci` se o alerta estiver nos dois ambientes. `--retry ID`
  também recupera um alerta arquivado para a fila ativa.

---

**Última atualização:** 2026-09-20
**Testes:** 256 passando (`npm test`)

### OLX: processador presente somente na descrição

A busca por CPU também aproveita resultados cujo cartão não identifica o processador. Esses candidatos precisam estar entre R$ 2.000 e R$ 8.000 e passar pelo filtro de categoria, peças e defeitos. Um modelo de CPU explicitamente diferente no cartão é descartado; “i7” ou “Ryzen 9” sem modelo não bastam para descartar.

- No máximo **2 consultas adicionais por termo** e **8 por rodada**, incluindo a retomada. Elas ocupam posições dentro do limite atual `--max-per-cpu`; não há paginação ou buscas adicionais.
- Os candidatos aguardam em `description-candidates.json`, deduplicados pelo ID/URL. Nunca lidos vêm primeiro; entre eles, mais evidência de CPU/RAM/GPU e menor preço têm prioridade. MacBooks/Apple Silicon, CPUs fora da seleção, peças, defeitos e RAM explicitamente abaixo de 32 GB são descartados antes da leitura. A fila guarda até 500 candidatos; entradas sem observação por sete dias expiram.
- Até três das 12 leituras ficam reservadas para candidatos novos durante as buscas. Ao final, vagas sem candidatos novos podem atender tentativas antigas. Pendências já lidas esperam 6h, 24h e depois 72h entre tentativas; mudança de título ou preço reinicia essa espera. Reuso de cache pendente preserva a fila.
- Leituras aprovadas são reutilizadas por até 12 horas, rejeições por até 72 horas e pendências por até 30 minutos quando título e preço permanecem iguais. Alterações exigem nova leitura. A fila prioriza fichas ainda não lidas antes de repetir pendências.
- O CPU confirmado na descrição define a classificação, desde que pertença à lista existente. CPU não identificado ou descrição com mais de um CPU fica pendente; modelo identificado fora da lista é rejeitado. Os critérios de preço integral e configuração continuam necessários para validar.
- O console e o relatório registram consultas adicionais, tempo gasto, ofertas válidas recuperadas e tamanho da fila. Termos pesquisados e fila totalmente validada são indicadores separados: concluir as buscas não significa ter aberto todos os candidatos.
- Ao final da rodada, o orçamento de fichas ainda disponível avança também a fila de outras famílias, sem novas buscas. `--descriptions-only` permite essa recuperação isolada; os limites diários, por rodada e por termo continuam valendo.
- `--listing-only` não abre descrições nem alimenta a fila. `--open-details` força a renovação das leituras, mantendo os limites adicionais. Bloqueios interrompem a coleta e preservam a fila.

### Preferência de RAM dos notebooks

OLX, Enjoei Notebooks e Mercado Livre Notebooks só apresentam ofertas e enviam alertas quando o anúncio informa pelo menos **32 GB de RAM instalada**. RAM desconhecida ou capacidades conflitantes não atendem ao filtro até confirmação. VRAM e capacidade máxima de expansão não contam como RAM instalada. O filtro vale também para ofertas antigas exibidas no dashboard e relatórios reutilizados para notificação; o histórico bruto permanece preservado.

A leitura aceita velocidade entre capacidade e RAM, como `32GB 5600MT/s de RAM`. Módulos originais que acompanham a venda separadamente não substituem a capacidade instalada. A evidência original é reprocessada sem atualizar a data da visita. Preços históricos impossíveis de notebook, abaixo do piso de coleta, não entram no cálculo de mínimo do painel; o histórico bruto é preservado.

Descrições como `placa de vídeo dedicada com 8 GB` e `GPU com 12 GB` não confirmam RAM do sistema. Valores derivados antigos iguais à VRAM deixam de comprovar RAM quando falta evidência independente. CPU divergente entre título e ficha permanece pendente.

### Cobertura e validação do Mercado Livre

- A paginação usa o endereço real de próxima página ou o botão `Seguinte` controlado por JavaScript (inclusive quando seu `href` está vazio). Há deduplicação por anúncio e detecção de páginas repetidas. O padrão é até **3 páginas por termo**, **12 páginas por lote** (ao menos uma por termo configurado no lote) e **10 minutos por lote**; `--max-pages`, `--page-budget` e `--max-minutes` permitem ajustar esses limites. Orçamentos de fichas permanecem independentes. Limites resultam em cobertura parcial, sem declarar o restante concluído.
- Uma primeira página sem correspondência com o termo encerra a consulta por relevância e grava `first_page_no_match`, com `exhaustive: false`. Isso não comprova ausência de anúncios nas páginas seguintes. Links de paginação desconhecidos, ausência de progresso, login e verificações nunca viram sucesso vazio.
- Todos os lotes do mesmo disparo compartilham uma referência inicial e um identificador. Novidades, alterações de preço, consultas concluídas e limitações são acumuladas em `run.invocation`; uma descoberta do primeiro lote permanece no relatório e alerta finais. Um novo disparo cria outra referência, evitando repetir o alerta da rodada anterior.
- Limitações previstas retornam código 2; consultas adiadas retornam 3. O publicador aceita esses códigos e mantém o aviso de cobertura. Falhas reais e bloqueios continuam sendo propagados. Limites de paginação não aumentam o contador de falhas técnicas; verificações novas prevalecem mesmo quando há fichas pendentes.
- Tênis no ML usam validação barefoot e exigem tamanho brasileiro **42 confirmado**, até R$500. Numerações US/EU/UK não são convertidas automaticamente. As consultas incluem Fiber e FOT; FOT mantém somente Walka, Lito, Noga, Voet e Bruk. A busca genérica Merrell foi substituída por Vapor Glove e Trail Glove. Pendentes ficam fora de ofertas válidas, destaques e alertas.
- `node scripts/revalidate-mercadolivre-saved.mjs` reaplica as políticas aos dados salvos sem rede, mensagens ou alteração das datas observadas. `--since DATA_ISO` permite reconstruir os lotes de uma janela explicitamente identificada. Os artefatos originais são mantidos; revisões são identificadas como reclassificação, sem renovar a atualidade da coleta.

### Atualidade e recuperação das coletas

As tarefas locais usam `--recover-stale-enjoei`: grupos exclusivos do Enjoei são recuperados quando passam de 36 horas sem atualização **ou** perderam uma execução confirmadamente falha do workflow Monitor. Dados coletados depois do início da execução falha dispensam nova recuperação. A próxima rodada local confere a API pública do GitHub; se o CI estiver em fila ou executando, a recuperação aguarda. Se a API estiver indisponível, mantém o critério de idade. O workflow também serializa suas execuções.

A recuperação local usa trava de processo, respeita filtros e orçamentos e grava os grupos/motivos em `data/status/enjoei-recovery.json`. `node scripts/recover-enjoei.mjs --stale-only` executa essa seleção sem enviar notificações. As rodadas agendadas incorporam seus achados ao resumo normal.

### Resumo único e paginação por relevância

Novas coletas gravam os achados estruturados em `run.findings` e os fatos de execução/cobertura em `run.collection_summary`, também conferidos no manifesto. Console, WhatsApp e o painel **Últimas rodadas** usam esse mesmo resumo: buscas previstas/concluídas, descrições/candidatos pendentes, itens novos e alterações de preço. Relatórios antigos mantêm compatibilidade; uma fonte executada sem relatório novo legível passa a sinalizar falha, em vez de sucesso vazio. Entrega do WhatsApp é apresentada separadamente da cobertura.

As consultas `fot`, `fot walka/lito/noga/voet/bruk` exigem candidato no tamanho 42, até R$ 500 e compatível com os modelos selecionados na primeira página. Se faltar identificar o modelo, uma ficha pode ser consultada antes de liberar a continuação, dentro do orçamento de detalhes existente. Sem candidato confirmado, a consulta termina por relevância; incertezas continuam pendentes. Cada ciclo desses aliases usa no máximo duas páginas, com `exhaustive: false` quando encerrado por política. Isso não comprova ausência de anúncios depois. As buscas principais por Fiber e Feet of Tomorrow continuam independentes. Cursores da política anterior são reiniciados.

Terminal, painel e WhatsApp compartilham os totais da rodada: execução técnica, consultas completas/programadas e candidatos pendentes. Consultas secundárias incompletas também sinalizam cobertura parcial; pendências de produto não se tornam erros técnicos.

A saúde separa `collection_state` (execução e idade da coleta) de `coverage_state` (atualização das consultas). Uma coleta recente com família de modelos atrasada fica parcial, mantendo o grupo atrasado visível; isso não produz erro de coletor parado. Snapshot ausente ou antigo, falha técnica e bloqueio continuam sinalizados. `node scripts/refresh-round-summaries.mjs` reconcilia resumos salvos sem renovar a coleta nem reenviar notificações.

A fila de descrições OLX prioriza anúncios até R$ 8.000 com CPU, RAM e GPU identificáveis, tanto durante as buscas como no processamento final da fila. Anúncios acima do teto de ofertas continuam acompanhados, mas aguardam os candidatos elegíveis prontos. Não há aprovação apenas pela prioridade: os filtros de CPU, mínimo de 32 GB, preço e defeitos permanecem obrigatórios.

Uma ficha lida sem configuração suficiente aguarda 48 horas antes da primeira repetição e sete dias após nova tentativa sem resolução. Falhas de leitura mantêm os intervalos de 6/24/72 horas; divergências aguardam 24/72/168 horas. Mudança de título, preço ou evidências de configuração na listagem reinicia a espera e invalida cache incompatível. A migração preserva observação, última tentativa e orçamento já consumido. Permanecem os limites de 12 detalhes por rodada, oito adicionais e os limites por termo, além do orçamento compartilhado diário.

O disparo local inicia o transcript antes de verificar concorrência ou cooldown. Cada tentativa também grava `logs/local-attempt-<id>.json`, com motivo, etapa e resultado. Um publicador ocupado é aguardado por até 180 segundos (`-PublisherWaitSeconds`); se continuar ocupado, o script sai com código 1 para permitir as tentativas já configuradas no Agendador. Uma publicação recente gera um encerramento registrado por cooldown. O marcador é reconferido depois da espera para evitar repetir uma rodada que acabou de concluir. `-Force` ignora somente o cooldown do publicador, mantendo as pausas e os limites dos coletores.

Os publicadores OLX e ML usam o mesmo mutex v2 e o liberam em `finally`, inclusive nas saídas antecipadas e com erro. O protocolo antigo podia ficar preso numa sessão interativa do PowerShell depois da conclusão do ML. A migração mantém a conferência de coletores ativos; uma janela antiga ociosa não precisa ser fechada.

O catálogo OLED inclui AOC Q27G4ZDR, confirmado na [especificação oficial](https://www.aoc.com/ca-en/gaming/monitors/q27g4zdr). A identificação do modelo não dispensa a conferência de descrição, preço integral, identidade do anúncio e defeitos.

No Mercado Livre, `--complete-coverage` percorre os termos configurados em lotes limitados, incluindo OLED em até seis termos por lote. Cada termo é tentado uma vez por execução; resultados parciais são preservados, e um novo bloqueio ou exigência de login interrompe a fila.

A saúde das fontes do Mercado Livre usa uma janela de 24 horas e indica que a execução é sob demanda. O histórico continua visível, mas dados mais antigos aparecem como desatualizados. Nas watchlists OLX, listagens incompletas aguardam até 18 segundos e recebem uma única nova tentativa em outra aba após 30 segundos; bloqueios interrompem a fonte. Recusas sem CAPTCHA são identificadas separadamente de verificações interativas, preservando os resultados anteriores e a pausa de segurança.
