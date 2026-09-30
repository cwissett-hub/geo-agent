import { test } from "node:test";
import assert from "node:assert/strict";
import { manualPrompt, parsePastedReply, manualResultEntry, providerLabel } from "../lib/manual.js";
import { SYSTEM_PROMPT, RESULT_SCHEMA, JSON_REPLY_RULES, EXAMPLE_REPLY } from "../lib/prompt.js";
import { validateResult } from "../lib/validate.js";

const goodResult = {
  guess: { country: "Chile", region: "Atacama", locality: null, lat: -23.6, lng: -70.4 }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("manualPrompt has system prompt, feedback, and ends with the JSON rules", () => {
  const p = manualPrompt(["Guessed Chile; actual Peru"]);
  assert.ok(p.startsWith(SYSTEM_PROMPT));
  assert.ok(p.includes("- Guessed Chile; actual Peru"));
  assert.ok(p.endsWith(JSON_REPLY_RULES));
  assert.ok(p.includes("```json"));
  assert.ok(/legal JSON/.test(p));
  // the raw schema is deliberately left out; models echo it back
  assert.ok(!p.includes(JSON.stringify(RESULT_SCHEMA)));
});

test("manualPrompt uses the configured country list", () => {
  const p = manualPrompt([], ["Chile", "Peru"]);
  assert.ok(p.includes("exactly as written: Chile, Peru."));
  assert.ok(!p.includes("Botswana"));
});

test("the example reply in the prompt is itself a valid result", () => {
  assert.equal(validateResult(EXAMPLE_REPLY).guess.country, "Chile");
  assert.equal(parsePastedReply(JSON_REPLY_RULES).guess.locality, "Calama");
});

test("parsePastedReply digs the JSON out of chatty replies", () => {
  const j = JSON.stringify(goodResult, null, 2);
  assert.equal(parsePastedReply("Sure! Here is my analysis:\n```json\n" + j + "\n```\nHope that helps.").guess.country, "Chile");
  assert.equal(parsePastedReply("Here you go: " + j + " Good luck!").guess.country, "Chile");
  assert.equal(parsePastedReply("```\n" + j + "\n```").guess.country, "Chile");
});

test("parsePastedReply repairs trailing commas and curly quotes", () => {
  const trailing = JSON.stringify(goodResult).replace(/}$/, ",}").replace('"h":0.5}', '"h":0.5,}');
  assert.equal(parsePastedReply(trailing).guess.country, "Chile");
  const curly = JSON.stringify(goodResult).replace(/"/g, (_, i) => (i % 2 ? "\u201C" : "\u201D"));
  assert.equal(parsePastedReply(curly).guess.country, "Chile");
});

test("parsePastedReply error says why the JSON failed", () => {
  assert.throws(() => parsePastedReply('{"guess": {"country": "Chile"'), (e) => e.code === "unparseable" && /valid JSON \(/.test(e.message));
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
