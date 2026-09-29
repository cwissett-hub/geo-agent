import { test } from "node:test";
import assert from "node:assert/strict";
import { gemini, toGeminiSchema } from "../lib/providers/gemini.js";
import { RESULT_SCHEMA, CATEGORIES } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("toGeminiSchema converts nullable unions and strips additionalProperties", () => {
  const s = toGeminiSchema(RESULT_SCHEMA);
  assert.equal(s.additionalProperties, undefined);
  assert.deepEqual(s.properties.guess.properties.region, { type: "string", nullable: true });
  assert.deepEqual(s.properties.guess.properties.lat, { type: "number", nullable: true });
  assert.deepEqual(s.properties.clues.items.properties.category.enum, CATEGORIES);
  assert.equal(s.properties.clues.items.additionalProperties, undefined);
  assert.deepEqual(s.required, RESULT_SCHEMA.required);
});

test("toGeminiSchema does not mutate its input", () => {
  toGeminiSchema(RESULT_SCHEMA);
  assert.equal(RESULT_SCHEMA.additionalProperties, false);
});

test("buildRequest targets generateContent with key in query", () => {
  const { url, init } = gemini.buildRequest({ key: "k", model: "gemini-2.5-flash", imageDataUrl: img, feedbackLines: [] });
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=k");
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text.length > 0, true);
  assert.deepEqual(body.contents[0].parts[0], { inline_data: { mime_type: "image/png", data: "QUJD" } });
  assert.equal(typeof body.contents[0].parts[1].text, "string");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, toGeminiSchema(RESULT_SCHEMA));
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads first candidate text", () => {
  const r = gemini.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodResult) }] } }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces safety block as refusal", () => {
  assert.throws(() => gemini.parseResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
    (e) => e.code === "refusal");
});

test("parseResponse throws unparseable when no candidates", () => {
  assert.throws(() => gemini.parseResponse({ candidates: [] }), (e) => e.code === "unparseable");
});
