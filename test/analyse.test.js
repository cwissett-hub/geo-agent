import { test } from "node:test";
import assert from "node:assert/strict";
import { providersToAsk, analyseImage } from "../lib/analyse.js";
import { ProviderError } from "../lib/providers/common.js";

const settings = {
  active: "anthropic", askAll: false,
  providers: {
    gemini: { key: "g", model: "gm", enabled: true, effort: "high" },
    anthropic: { key: "a", model: "am", enabled: true },
    openai: { key: "", model: "om", enabled: true },
  },
};
const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("providersToAsk returns active only when askAll is off", () => {
  assert.deepEqual(providersToAsk(settings), ["anthropic"]);
});

test("providersToAsk returns enabled providers with keys when askAll is on", () => {
  assert.deepEqual(providersToAsk({ ...settings, askAll: true }), ["gemini", "anthropic"]);
});

test("analyseImage collects one result per provider and captures errors", async () => {
  const calls = [];
  const fake = async (adapter, opts) => {
    calls.push([adapter.id, opts.model, opts.effort, opts.feedbackLines]);
    if (adapter.id === "anthropic") throw new ProviderError("rate_limited", "slow", { raw: "r" });
    return goodResult;
  };
  const round = await analyseImage("data:image/png;base64,AA", { ...settings, askAll: true }, ["fb"], fake);
  assert.equal(round.results.length, 2);
  assert.equal(round.results[0].provider, "gemini");
  assert.equal(round.results[0].result.guess.country, "Chile");
  assert.equal(round.results[1].provider, "anthropic");
  assert.deepEqual(round.results[1].error, { code: "rate_limited", message: "slow", raw: "r" });
  assert.deepEqual(calls[0], ["gemini", "gm", "high", ["fb"]]);
  assert.equal(round.imageDataUrl, "data:image/png;base64,AA");
});

test("analyseImage wraps unexpected errors as code unknown", async () => {
  const fake = async () => { throw new Error("weird"); };
  const round = await analyseImage("d", settings, [], fake);
  assert.deepEqual(round.results[0].error, { code: "unknown", message: "weird", raw: null });
});

test("manual mode asks no provider and yields a round with no results", async () => {
  const manual = { ...settings, manual: true, askAll: true };
  assert.deepEqual(providersToAsk(manual), []);
  let calls = 0;
  const round = await analyseImage("data:image/png;base64,AA", manual, [], async () => { calls++; return goodResult; });
  assert.equal(calls, 0);
  assert.deepEqual(round.results, []);
  assert.equal(round.imageDataUrl, "data:image/png;base64,AA");
});

test("analyseImage passes each provider its own effort, falling back to the adapter default", async () => {
  const calls = {};
  const fake = async (adapter, opts) => { calls[adapter.id] = opts.effort; return goodResult; };
  const s = { ...settings, askAll: true, providers: {
    gemini: { key: "g", model: "gm", enabled: true },
    anthropic: { key: "a", model: "am", enabled: true, effort: "max" },
    openai: { key: "o", model: "om", enabled: true },
  } };
  await analyseImage("d", s, [], fake);
  assert.deepEqual(calls, { gemini: null, anthropic: "max", openai: "medium" });
});
