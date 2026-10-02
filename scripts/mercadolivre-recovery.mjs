import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { acquireMercadoLivreLock } from "./lib/mercadolivre-production.mjs";
import { buildSearchUrl, detectPageState, pageStateMessage } from "./lib/mercadolivre-monitor.mjs";
import { clearMercadoLivreCooldown, readMercadoLivreSchedule, writeMercadoLivreSchedule } from "./lib/mercadolivre-scheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.MERCADOLIVRE_PROFILE_DIR ?? path.join(root, ".chrome-mercadolivre-profile");

main().catch((error) => {
  console.error(`Recuperacao ML: ${error.message}`);
  process.exitCode = 1;
});

function localTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

async function main() {
  const schedule = await readMercadoLivreSchedule(root);
  const blocked = schedule.global.requires_login || Date.parse(schedule.global.blocked_until ?? "") > Date.now();
  if (process.argv.includes("--check")) {
    if (!blocked) return;
    console.error("Mercado Livre: nenhuma busca iniciada; o perfil tem um bloqueio registrado.");
    if (schedule.global.blocked_until) console.error(`Pausa ate ${localTime(schedule.global.blocked_until)} (Brasilia).`);
    if (schedule.global.block_reason === "rate_limited") {
      console.error("O site limitou os acessos. Aguarde a pausa terminar antes de tentar novamente.");
    } else {
      console.error("Para resolver login/verificacao e retomar, execute:");
      console.error("& .\\scripts\\run-mercadolivre-and-publish.ps1 -Recover");
      console.error("A recuperacao abre o Chrome visivel e precisa da sua intervencao.");
    }
    process.exitCode = 2;
    return;
  }
  if (!process.argv.includes("--recover")) throw new Error("Use --check ou --recover.");
  if (schedule.global.block_reason === "rate_limited" && Date.parse(schedule.global.blocked_until ?? "") > Date.now()) {
    throw new Error(`Limite de acessos ainda ativo ate ${localTime(schedule.global.blocked_until)} (Brasilia). Aguarde esse horario.`);
  }
  if (!process.stdin.isTTY) throw new Error("A recuperacao precisa de um terminal interativo para sua confirmacao apos resolver a verificacao.");
  const lock = await acquireMercadoLivreLock(profileDir);
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once("SIGINT", cancel);
  let context;
  let input;
  try {
    console.log("Recuperacao: abrindo o perfil exclusivo do Mercado Livre.");
    console.log("Se este perfil ja estiver aberto em outra janela, feche apenas essa janela antes de continuar.");
    context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome", headless: false, viewport: null, locale: "pt-BR", args: ["--start-maximized"],
    });
    context.on("close", cancel);
    const page = context.pages()[0] ?? await context.newPage();
    // Use the search that triggered the block, rather than checking only the
    // homepage: the homepage may work while search still requires verification.
    const failedCpu = Object.entries(schedule.watchlists.notebooks?.terms ?? {})
      .filter(([, state]) => /verificacao|verifica[çc][aã]o|captcha|sessao|sessão/i.test(state.last_error ?? ""))
      .sort((a, b) => String(b[1].last_checked_at).localeCompare(String(a[1].last_checked_at)))[0]?.[0] ?? "290hx";
    const searchUrl = buildSearchUrl(failedCpu, { categoryPath: "informatica/portateis-acessorios/notebooks", localShipping: true });
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    input = createInterface({ input: process.stdin, output: process.stdout });
    input.on("SIGINT", cancel);
    input.on("close", cancel);
    console.log("No Chrome, entre na conta ou resolva a verificacao manualmente, se ela aparecer.");
    console.log("Depois de ver os resultados da busca, volte a este terminal. Mantenha o Chrome aberto.");
    try {
      await input.question("Pressione Enter quando a busca estiver liberada (Ctrl+C cancela): ", { signal: cancellation.signal });
    } catch (error) {
      if (cancellation.signal.aborted) throw new Error("Recuperacao cancelada; bloqueio mantido.");
      throw error;
    }
    const currentUrl = new URL(page.url());
    const expectedUrl = new URL(searchUrl);
    // ML can canonicalize category/filter parts during login redirects.
    const querySlug = decodeURIComponent(expectedUrl.pathname.split("/").at(-1).split("_")[0]).toLowerCase();
    const actualPath = decodeURIComponent(currentUrl.pathname).toLowerCase();
    if (currentUrl.hostname !== expectedUrl.hostname || !actualPath.split("/").some((part) => part.split("_")[0] === querySlug)) {
      throw new Error("A pagina aberta nao e a busca usada na recuperacao. O bloqueio foi mantido; volte a busca e execute -Recover novamente.");
    }
    const state = await detectPageState(page);
    if (!["results", "empty"].includes(state)) {
      throw new Error(`${pageStateMessage(state)} O bloqueio foi mantido.`);
    }
    // Clear only after the human completed verification and an actual search
    // page is recognized. Never solve or click verification controls here.
    const currentSchedule = await readMercadoLivreSchedule(root);
    const recovered = clearMercadoLivreCooldown(currentSchedule);
    recovered.global.recovery_checked_at = new Date().toISOString();
    recovered.global.recovery_search = searchUrl;
    await writeMercadoLivreSchedule(root, recovered);
    console.log("Busca reconhecida. Pausa de verificacao removida; o perfil sera fechado para a coleta continuar.");
  } finally {
    input?.close();
    await context?.close().catch(() => {});
    await lock.release();
    process.removeListener("SIGINT", cancel);
  }
}
