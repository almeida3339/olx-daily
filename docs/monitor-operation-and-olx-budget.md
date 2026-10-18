# Resultados operacionais e orçamento da OLX

## Resultado da execução

Cada manifesto novo registra `run.operational`, calculado depois de validar e
separar eventuais itens inválidos. A gravação do snapshot e do relatório continua
obrigatória antes de confirmar uma rodada ao processo pai.

| Resultado | Significado | Código do coletor |
| --- | --- | --- |
| `success` | Consultas agendadas concluídas | 0 |
| `partial` | Resultados preservados, com limites previstos de cards, páginas ou fichas | 2 |
| `deferred` | Consultas adiadas por frequência, orçamento ou pausa já conhecida | 3 |
| `blocked` | Nova verificação, login ou limitação de acesso | 4 |
| `failed` | Erro técnico, artefato inválido ou gravação interrompida | 1 |

O orquestrador aceita os códigos 2 e 3 somente com a confirmação estruturada de
artefatos gravados pela mesma invocação do coletor. Nessas situações, publica
os dados e a tarefa agendada termina com 0, mantendo o aviso no painel e no
histórico. Código inesperado, sinal de interrupção, bloqueio novo e erro técnico
continuam causando falha. Uma pausa conhecida não é contada como novo bloqueio.

O histórico separa rodadas completas, parciais, adiadas, bloqueadas e falhas.
Rodadas antigas conservam os registros originais; não foram reinterpretadas como
erros de acesso. O fluxo sob demanda do Mercado Livre mantém seus controles de
fila existentes; a alteração de normalização de saída aplica-se ao orquestrador
local/CI e aos coletores locais que ele executa.

## Volume compartilhado da OLX

O arquivo `data/status/olx-traffic.json` soma as tentativas de navegação de busca
e de leitura de fichas de todas as watchlists da OLX. Enjoei, Mercado Livre,
imagens, scripts e outros recursos da página não entram nesses contadores.

| Limite | Buscas | Fichas |
| --- | ---: | ---: |
| Por rodada do orquestrador | 22 | 14 |
| Por dia, no fuso America/Sao_Paulo | 40 | 24 |

As reservas são persistidas **antes** do acesso. Tentativas que falham também
consomem o orçamento, e uma repetição após timeout exige nova reserva. Cache
não consome acesso. A trava de arquivo impede duas execuções de ultrapassarem
o teto simultaneamente. Estado ilegível falha de forma explícita, sem zerar cotas.
Execuções diretas compartilham o teto diário; cada processo direto tem seu teto
de rodada. Um `--full-sweep` ignora frequência, mas respeita os tetos de acesso.

A contagem começa em `tracking_started_at`; acessos anteriores à instalação
dessa política não foram reconstruídos. São mantidos 14 dias de contagem.

Configuração opcional por ambiente: `OLX_DAILY_SEARCH_LIMIT`,
`OLX_DAILY_DETAIL_LIMIT`, `OLX_ROUND_SEARCH_LIMIT`, `OLX_ROUND_DETAIL_LIMIT`.
`OLX_TRAFFIC_RUN_ID` identifica a rodada compartilhada entre os filhos.

## Frequência conforme rendimento

- As quatro CPUs prioritárias mantêm intervalo mínimo de 8h, permitindo as
  rodadas normais das 07h e 16h. Cada rodada inclui até quatro CPUs secundárias
  e uma família, ordenadas pela última tentativa.
- Consultas que retornam ofertas aprovadas ou tiveram mudança válida nos últimos
  sete dias mantêm intervalo de 8h.
- Outras consultas começam com intervalo de 24h. Três consultas completas sem
  oferta aprovada elevam para 48h; seis elevam para 72h. Consulta truncada ou
  bloqueada não é contada como busca vazia.
- Consultas ainda não elegíveis não ocupam os lugares de outras consultas
  elegíveis. As prioritárias OLED também alternam pela última tentativa para
  que o orçamento não favoreça sempre os primeiros modelos.
- Os limites locais de cards/fichas continuam valendo. Bloqueios da OLX mantêm
  a pausa de recuperação existente. Aumentar frequência não ignora a pausa.

O painel mostra o consumo compartilhado e os resultados operacionais. Os prazos
de frescor consideram o intervalo adaptativo, preservando as advertências de
cobertura parcial e de bloqueio real.
