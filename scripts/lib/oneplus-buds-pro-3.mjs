// Regras de identificação do fone OnePlus Buds Pro 3, compartilhadas pelo
// monitor OLX/Enjoei (monitor-oneplus-buds-pro-3.mjs) e pela watchlist do
// Mercado Livre (mercadolivre-watchlists.mjs). Ficam num módulo só para as duas
// plataformas não divergirem com o tempo — as outras buscas nasceram com as
// regras duplicadas e hoje filtram diferente em cada lugar.
//
// O modelo tem DOIS vizinhos que confundem:
//   1) OnePlus Nord Buds 3 Pro — outra linha (Nord), bem mais barata. O nome
//      dela contém "buds 3 pro", quase igual ao nosso "buds pro 3", só com os
//      tokens invertidos: comparar por substring normalizada não separa os dois.
//      O discriminador confiável é a palavra "nord".
//   2) OnePlus Buds 3 (sem "pro") — os termos exigem "pro" colado ao "3", então
//      "oneplusbuds3" não casa e esse modelo já fica fora sozinho. Pelo mesmo
//      motivo as gerações anteriores (Buds Pro 2, Buds Pro) também não entram.
// A marca é exigida à parte porque "buds 3 pro" sozinho casaria com
// "Galaxy Buds3 Pro" (Samsung) e "Redmi Buds 3 Pro" (Xiaomi).
import { normalizeMonitorCode } from "./monitor-core.mjs";

export const ONEPLUS_BUDS_PRO3_PRICE = { min: 300, max: 800 };

// Termos do OLX/Enjoei: servem AO MESMO TEMPO de busca e de filtro por
// substring do título (ver textMatchesTerm em watchlist-monitor.mjs). O termo
// com marca deixa a busca precisa (traz o anúncio certo para a 1ª página); os
// dois curtos casam títulos onde "OnePlus" aparece longe do modelo ("Fone
// Bluetooth Buds Pro 3 OnePlus original") ou só no campo de marca do Enjoei.
export const ONEPLUS_BUDS_PRO3_TERMS = ["oneplus buds pro 3", "buds pro 3", "buds 3 pro"];

// No Mercado Livre a busca e o casamento são campos separados: `terms` é só a
// query (uma basta, cada termo custa uma navegação do Playwright) e as variantes
// abaixo é que filtram o resultado.
export const ONEPLUS_BUDS_PRO3_SEARCH_TERMS = ["oneplus buds pro 3"];
export const ONEPLUS_BUDS_PRO3_MATCH_VARIANTS = ["buds pro 3", "buds 3 pro", "budspro3"];

export const ONEPLUS_BUDS_PRO3_EXCLUDE_TERMS = ["nord"];

// requiredAnyTerms do ML compara com o texto normalizado COM espaços, então as
// duas grafias precisam estar aqui. No OLX/Enjoei quem faz esse papel é
// hasOnePlusBrand (compara sem separadores, cobrindo as duas de uma vez).
export const ONEPLUS_BUDS_PRO3_BRAND_TERMS = ["oneplus", "one plus"];

/** Exige a marca no texto. Sem separadores, "OnePlus" e "One Plus" viram "oneplus". */
export function hasOnePlusBrand(text) {
  return normalizeMonitorCode(text).includes("oneplus");
}
