import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropic } from "../lib/providers/anthropic.js";
import { RESULT_SCHEMA } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("buildRequest targets the messages endpoint with browser header", () => {
  const { url, init } = anthropic.buildRequest({ key: "k", model: "claude-opus-5", imageDataUrl: img, feedbackLines: [], effort: "high" });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-api-key"], "k");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("buildRequest body has image, text, schema and effort", () => {
  const { init } = anthropic.buildRequest({ key: "k", model: "claude-opus-5", imageDataUrl: img, feedbackLines: ["x"], effort: "low" });
  const body = JSON.parse(init.body);
  assert.equal(body.model, "claude-opus-5");
  assert.equal(body.max_tokens, 16000);
  assert.equal(typeof body.system, "string");
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: RESULT_SCHEMA });
  assert.equal(body.output_config.effort, "low");
  const [image, text] = body.messages[0].content;
  assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
  assert.equal(text.type, "text");
  assert.ok(text.text.includes("- x"));
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads the text block", () => {
  const r = anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(goodResult) }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse skips thinking blocks", () => {
  const r = anthropic.parseResponse({ stop_reason: "end_turn", content: [
    { type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(goodResult) }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces refusal", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
    (e) => e.code === "refusal" && /cyber/.test(e.message));
});

test("parseResponse throws unparseable on bad json", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "oops" }] }),
    (e) => e.code === "unparseable" && e.raw === "oops");
});

test("parseResponse throws unparseable on schema failure", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: '{"guess":{}}' }] }),
    (e) => e.code === "unparseable");
});
