import { createHash } from "node:crypto";

// Cursors are opaque: use the value returned by Enjoei, never synthesize offsets.
// A short page can still have a next cursor (the server can cap page sizes).
export async function collectEnjoeiPages({
  progress, fetchPage, onPage, checkpoint,
  maxPages = 500, deadline = Infinity, delayMs = 400,
}) {
  if (progress.complete) return { complete: true, pagesFetched: 0 };
  if (progress.stalled) {
    progress.after = null;
    progress.signatures = [];
    progress.pages = 0;
    progress.stalled = false;
  }
  progress.signatures ??= [];
  progress.pages ??= 0;
  let pagesFetched = 0;
  while (pagesFetched < maxPages && Date.now() < deadline) {
    if (pagesFetched > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (Date.now() >= deadline) break;
    const products = await fetchPage(progress.after ?? null);
    if (!products || !Array.isArray(products.edges)) throw new Error("Resposta sem lista data.search.products.edges");
    const edges = products.edges;
    const hasNextPage = products.pageInfo?.hasNextPage;
    if (edges.length === 0 && hasNextPage === true) throw new Error("Página vazia com próxima página indicada pela API");
    if (edges.length === 0 && progress.after == null && Number(products.total) > 0) {
      throw new Error("Busca retornou página vazia apesar de indicar resultados");
    }
    const cursor = products.pageInfo?.endCursor ?? edges.at(-1)?.cursor ?? null;
    const signature = createHash("sha256").update(JSON.stringify(edges.map((edge) => edge.node?.id))).digest("hex");
    const stalled = edges.length > 0 && hasNextPage !== false
      && (!cursor || cursor === progress.after || progress.signatures.includes(signature));
    await onPage(edges);
    // Advance only after all candidates on this page are safely processed.
    progress.pages += 1;
    pagesFetched += 1;
    progress.total_reported = products.total ?? null;
    progress.complete = edges.length === 0 || hasNextPage === false;
    progress.stalled = stalled;
    progress.last_error = stalled ? "Cursor ausente/repetido ou página repetida; fim da busca não confirmado" : null;
    if (!progress.complete && !stalled) {
      progress.after = cursor;
      progress.signatures.push(signature);
    }
    await checkpoint();
    if (progress.complete || stalled) return { complete: progress.complete, pagesFetched, reason: progress.last_error };
  }
  progress.last_error = Date.now() >= deadline ? "Limite de tempo; retomada pendente" : "Limite de páginas por rodada; retomada pendente";
  await checkpoint();
  return { complete: false, pagesFetched, reason: progress.last_error };
}
