import test from "node:test";
import assert from "node:assert/strict";
import { ENJOEI_SHOE_TERMS, matchesEnjoeiShoeSearchTerm } from "../scripts/lib/shoe-search-rules.mjs";

test("Enjoei tenis: termos genericos ganham contexto", () => {
  assert.ok(ENJOEI_SHOE_TERMS.includes("vita barefoot"));
  assert.ok(ENJOEI_SHOE_TERMS.includes("vibram fivefingers"));
  assert.ok(!ENJOEI_SHOE_TERMS.includes("vita"));
  assert.ok(!ENJOEI_SHOE_TERMS.includes("vibram"));
});

test("Enjoei tenis: mocassim La Vita nao entra pela busca Vita", () => {
  const item = { title: "sapato mocassim casual masculino marrom - la vita", brand: "La Vita" };
  assert.equal(matchesEnjoeiShoeSearchTerm(item, "vita barefoot"), false);
  assert.equal(matchesEnjoeiShoeSearchTerm(item, "vibram fivefingers"), false);
});

test("Enjoei tenis: calcado alvo continua aceito", () => {
  assert.equal(
    matchesEnjoeiShoeSearchTerm({ title: "Tenis Vibram FiveFingers V-Alpha preto", brand: "Vibram" }, "vibram fivefingers"),
    true,
  );
  assert.equal(
    matchesEnjoeiShoeSearchTerm({ title: "Tenis Vita Barefoot minimalista", brand: "Vita" }, "vita barefoot"),
    true,
  );
});
