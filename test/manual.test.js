import { test } from "node:test";
import assert from "node:assert/strict";
import { manualPrompt, parsePastedReply, manualResultEntry, providerLabel } from "../lib/manual.js";
import { SYSTEM_PROMPT, RESULT_SCHEMA } from "../lib/prompt.js";

const goodResult = {
  guess: { country: "Chile", region: "Atacama", locality: null, lat: -23.6, lng: -70.4 }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("manualPrompt contains system prompt, user text, feedback and schema", () => {
  const p = manualPrompt(["Guessed Chile; actual Peru"]);
  assert.ok(p.startsWith(SYSTEM_PROMPT));
  assert.ok(p.includes("- Guessed Chile; actual Peru"));
  assert.ok(p.includes("Reply with ONLY a JSON object"));
  assert.ok(p.includes(JSON.stringify(RESULT_SCHEMA)));
});

test("parsePastedReply accepts plain and fenced JSON", () => {
  assert.equal(parsePastedReply(JSON.stringify(goodResult)).guess.country, "Chile");
  assert.equal(parsePastedReply("```json\n" + JSON.stringify(goodResult) + "\n```").guess.country, "Chile");
});

test("parsePastedReply rejects junk with an unparseable ProviderError", () => {
  assert.throws(() => parsePastedReply("hello"), (e) => e.code === "unparseable");
  assert.throws(() => parsePastedReply('{"guess":{}}'), (e) => e.code === "unparseable");
});

test("manualResultEntry has the results-array shape", () => {
  assert.deepEqual(manualResultEntry(goodResult), { provider: "manual", model: "pasted", result: goodResult, error: null });
});

test("providerLabel falls back for manual", () => {
  assert.equal(providerLabel("openai"), "GPT (OpenAI)");
  assert.equal(providerLabel("manual"), "Manual paste");
});
