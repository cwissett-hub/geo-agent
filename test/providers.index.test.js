import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, PROVIDER_ORDER, callProvider } from "../lib/providers/index.js";

const img = "data:image/png;base64,QUJD";
const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

test("registry has all three providers in display order", () => {
  assert.deepEqual(PROVIDER_ORDER, ["anthropic", "openai", "gemini"]);
  for (const id of PROVIDER_ORDER) assert.equal(PROVIDERS[id].id, id);
});

test("callProvider throws no_key without a key", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, {})),
    (e) => e.code === "no_key");
});

test("callProvider returns a parsed result on 200", async () => {
  const body = { choices: [{ message: { content: JSON.stringify(goodResult) } }] };
  const r = await callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, body));
  assert.equal(r.guess.country, "Chile");
});

test("callProvider maps 429 to rate_limited", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(429, "slow down")),
    (e) => e.code === "rate_limited" && e.raw === "slow down");
});

test("callProvider maps thrown fetch to network", async () => {
  const boom = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, boom),
    (e) => e.code === "network");
});

test("callProvider maps non-JSON 200 body to unparseable", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, "<html>")),
    (e) => e.code === "unparseable" && e.raw === "<html>");
});
