import test from "node:test";
import assert from "node:assert/strict";
import { runMonitorProcess } from "../scripts/lib/monitor-process.mjs";
import { automationChildEnvironment } from "../scripts/lib/watchlists-registry.mjs";
import path from "node:path";

test("processo falho conserva causa sanitizada e transmite progresso", async () => {
  const output = [];
  const sink = { write: (chunk) => output.push(chunk.toString()) };
  await assert.rejects(runMonitorProcess(process.execPath, ["-e",
    "console.log('coletando'); console.error('Cloudflare bloqueando após 15s; token=segredo'); process.exitCode = 1;"
  ], { stdout: sink, stderr: sink }), (error) => {
    assert.match(error.message, /código 1.*Cloudflare/);
    assert.doesNotMatch(error.message, /segredo/);
    return true;
  });
  assert.match(output.join(""), /coletando/);
});

test("processo bem sucedido resolve mesmo com avisos", async () => {
  const sink = { write() {} };
  await runMonitorProcess(process.execPath, ["-e", "console.error('aviso');"], { stdout: sink, stderr: sink });
});

test("erro ao iniciar processo rejeita sem aguardar close", async () => {
  const sink = { write() {} };
  await assert.rejects(runMonitorProcess("monitor-inexistente-olx-daily", [], { stdout: sink, stderr: sink }), /ENOENT/);
});

test("processo filho do CI recebe o diretorio de coleta publicado", async () => {
  const root = path.resolve("fixture/repo");
  const chunks = [];
  await runMonitorProcess(process.execPath, ["-e", "process.stdout.write(process.env.ENJOEI_DATA_DIR)"], {
    env: automationChildEnvironment(root, { ...process.env, GITHUB_ACTIONS: "true", ENJOEI_DATA_DIR: undefined }),
    stdout: { write: (chunk) => chunks.push(chunk.toString()) },
    stderr: { write() {} },
  });
  assert.equal(chunks.join(""), path.join(root, "data", "enjoei"));
});
