/**
 * Lista canônica de termos de CPU monitorados.
 * Importada por todos os scripts de monitor — alterar aqui
 * atualiza OLX e Enjoei simultaneamente.
 *
 * Cada termo é o token curto/distintivo do modelo (ex.: "13980hx"). Para os
 * casos cujo número sozinho seria genérico demais para buscar (ex.: "395",
 * "390"), use CPU_SEARCH_QUERIES para mapear o termo a uma query com contexto
 * de marca — o token continua sendo usado para casar o texto do anúncio.
 */
export const DEFAULT_CPU_TERMS = [
  "9955hx3d",  // AMD Ryzen 9 9955HX3D
  "290hx",     // Intel Core Ultra 9 290HX (Plus)
  "9955hx",    // AMD Ryzen 9 9955HX
  "285hx",     // Intel Core Ultra 9 285HX
  "275hx",     // Intel Core Ultra 9 275HX
  "aimax395",  // AMD Ryzen AI Max+ 395 e AI Max+ PRO 395 (mesmo número)
  "7945hx",    // AMD Ryzen 9 7945HX
  "7945hx3d",  // AMD Ryzen 9 7945HX3D
  "255hx",     // Intel Core Ultra 7 255HX
  "13980hx",   // Intel Core i9-13980HX
  "8940hx",    // AMD Ryzen 9 8940HX
  "7940hx",    // AMD Ryzen 9 7940HX
  "13950hx",   // Intel Core i9-13950HX
  "14900hx",   // Intel Core i9-14900HX
  "13900hx",   // Intel Core i9-13900HX
  "7845hx",    // AMD Ryzen 9 7845HX
  "8840hx",    // AMD Ryzen 7 8840HX
  "aimax390",  // AMD Ryzen AI Max PRO 390
  "14700hx",   // Intel Core i7-14700HX
  "hx470",     // AMD Ryzen AI 9 HX 470
  "12900hx",   // Intel Core i9-12900HX
  "12800hx",   // Intel Core i7-12800HX
];

/**
 * Termos cujo número do modelo é genérico demais para buscar sozinho.
 * A busca (OLX e Enjoei) usa esta query com contexto de marca; o casamento
 * de texto continua usando o token (ver textContainsCpuTerm).
 */
export const CPU_SEARCH_QUERIES = {
  // "notebook" no fim evita que a busca geral do Enjoei retorne tênis "Air Max"
  // (colisão "max" + número). No OLX a busca ja e escopada em notebooks.
  aimax395: "ryzen ai max 395 notebook",
  aimax390: "ryzen ai max 390 notebook",
};

/** Query de busca para um termo (com contexto de marca quando necessário). */
export function cpuSearchQuery(term) {
  return CPU_SEARCH_QUERIES[term] ?? term;
}
