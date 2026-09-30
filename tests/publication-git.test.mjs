import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
let shellAvailable = true;
try { execFileSync(shell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { stdio: "ignore" }); }
catch { shellAvailable = false; }

const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
function inspect(cwd, script) {
  const code = `$ErrorActionPreference='Stop'; . ${quote(path.join(root, "scripts/lib/publication-git.ps1"))}; ${script}`;
  return JSON.parse(execFileSync(shell, ["-NoProfile", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")], { cwd, encoding: "utf8" }));
}

test("recuperacao aceita dados staged e distingue trabalho ainda nao preparado", { skip: !shellAvailable }, async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "olx-publication-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "core.autocrlf", "false");
  await fs.mkdir(path.join(fixture, "data/olx"), { recursive: true });
  const snapshot = path.join(fixture, "data/olx/snapshot.json");
  await fs.writeFile(snapshot, "{}\n");

  const before = inspect(fixture, "ConvertTo-Json -Compress -InputObject @(Get-UnstagedGeneratedFiles -Paths @('data/olx'))");
  assert.deepEqual(before, ["data/olx/snapshot.json"]);
  git("add", "data/olx");
  assert.ok(git("status", "--porcelain").trim(), "git status inclui staged mesmo depois de preparar tudo");
  const prepared = inspect(fixture, "@{remaining=@(Get-UnstagedGeneratedFiles -Paths @('data/olx')); changed=(Test-GitStagedChanges); outside=@(git diff --cached --name-only --no-renames | Where-Object { -not (Test-RegisteredGeneratedPath -FilePath $_ -RegisteredPaths @('data/olx')) })} | ConvertTo-Json -Compress");
  assert.deepEqual(prepared.remaining, []);
  assert.deepEqual(prepared.outside, []);
  assert.equal(prepared.changed, true);

  git("commit", "-m", "fixture");
  assert.equal(inspect(fixture, "Test-GitStagedChanges | ConvertTo-Json"), false);
  await fs.rm(snapshot);
  assert.deepEqual(inspect(fixture, "ConvertTo-Json -Compress -InputObject @(Get-UnstagedGeneratedFiles -Paths @('data/olx'))"), ["data/olx/snapshot.json"]);
  git("add", "--all", "data/olx");
  assert.deepEqual(inspect(fixture, "ConvertTo-Json -Compress -InputObject @(Get-UnstagedGeneratedFiles -Paths @('data/olx'))"), []);

  const membership = inspect(fixture, "@{allowed=(Test-RegisteredGeneratedPath 'data/olx/runs/report.md' @('data/olx')); sibling=(Test-RegisteredGeneratedPath 'data/olx-backup/report.md' @('data/olx')); code=(Test-RegisteredGeneratedPath 'scripts/monitor.mjs' @('data/olx')); dashboard=(Test-RegisteredGeneratedPath 'index.html' @('index.html'))} | ConvertTo-Json -Compress");
  assert.deepEqual(membership, { allowed: true, sibling: false, code: false, dashboard: true });
});
