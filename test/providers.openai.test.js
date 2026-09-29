import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../lib/providers/openai.js";
import { RESULT_SCHEMA } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("buildRequest targets chat completions with bearer key", () => {
  const { url, init } = openai.buildRequest({ key: "k", model: "gpt-5", imageDataUrl: img, feedbackLines: [] });
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(init.headers.authorization, "Bearer k");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "gpt-5");
  assert.equal(body.messages[0].role, "system");
  const user = body.messages[1];
  assert.equal(user.role, "user");
  assert.deepEqual(user.content[0], { type: "image_url", image_url: { url: img } });
  assert.equal(user.content[1].type, "text");
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: { name: "round_result", strict: true, schema: RESULT_SCHEMA },
  });
  assert.equal(body.max_completion_tokens, 16000);
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads choices[0].message.content", () => {
  const r = openai.parseResponse({ choices: [{ message: { content: JSON.stringify(goodResult) } }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces refusal field", () => {
  assert.throws(() => openai.parseResponse({ choices: [{ message: { refusal: "no", content: null } }] }),
    (e) => e.code === "refusal");
});

test("parseResponse throws unparseable when no choices", () => {
  assert.throws(() => openai.parseResponse({ choices: [] }), (e) => e.code === "unparseable");
});

test("parseResponse throws unparseable on bad json", () => {
  assert.throws(() => openai.parseResponse({ choices: [{ message: { content: "nah" } }] }),
    (e) => e.code === "unparseable" && e.raw === "nah");
});
