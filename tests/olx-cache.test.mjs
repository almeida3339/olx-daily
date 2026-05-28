import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  getReusablePreviousEnrichedItem,
  needsDetailEnrichment,
} from "../scripts/monitor-olx-notebooks-por-cpu.mjs";

describe("OLX detail reuse", () => {
  test("GPU faltando sozinha nao exige abertura do anuncio", () => {
    assert.equal(needsDetailEnrichment({ ram_gb: 16, storage_gb: 512, gpu: null }), false);
  });

  test("reaproveita detalhes anteriores mesmo quando o preco mudou", () => {
    const reused = getReusablePreviousEnrichedItem(
      {
        items: [
          {
            id: "1498259084",
            url: "https://sc.olx.com.br/notebooks/zenbook-1498259084",
            title: "Notebook Asus ZenBook 14",
            cpu_term: "155h",
            price_brl: 6000,
            ram_gb: 16,
            storage_gb: 1024,
            gpu: "Intel Arc integrada",
            status: "not_seen",
            notes: null,
          },
        ],
      },
      {
        url: "https://sc.olx.com.br/notebooks/zenbook-1498259084",
        title: "Notebook Asus ZenBook 14 Intel Core Ultra i7-155H",
        text: "",
        cpu_term: "155h",
        price_brl: 6500,
      },
    );

    assert.equal(reused.price_brl, 6500);
    assert.equal(reused.ram_gb, 16);
    assert.equal(reused.storage_gb, 1024);
    assert.equal(reused.gpu, "Intel Arc integrada");
    assert.equal(reused.status, "active");
  });

  test("nao reaproveita item que nunca foi enriquecido", () => {
    const reused = getReusablePreviousEnrichedItem(
      {
        items: [
          {
            id: "1498259084",
            url: "https://sc.olx.com.br/notebooks/zenbook-1498259084",
            title: "Notebook Asus ZenBook 14",
            price_brl: 6000,
            ram_gb: null,
            storage_gb: null,
            status: "active",
            notes: "Validado apenas pela página de listagem; descrição do anúncio não foi aberta.",
          },
        ],
      },
      {
        url: "https://sc.olx.com.br/notebooks/zenbook-1498259084",
        title: "Notebook Asus ZenBook 14 Intel Core Ultra i7-155H",
        text: "",
        cpu_term: "155h",
        price_brl: 6500,
      },
    );

    assert.equal(reused, null);
  });
});
