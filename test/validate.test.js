import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult, normaliseWeights, clampBox } from "../lib/validate.js";

const good = () => ({
  guess: { country: "Chile", region: "Atacama", lat: -23.6, lng: -70.4 },
  confidence: 0.7,
  alternatives: [{ country: "Peru", why_not: "Signs differ" }],
  clues: [
    { id: 1, category: "road_markings", observation: "Yellow centre line", inference: "Americas", weight: 0.6,
      box: { x: 0.1, y: 0.5, w: 0.4, h: 0.2 } },
    { id: 2, category: "soil_climate", observation: "Arid", inference: "Desert", weight: 0.4,
      box: { x: 0.5, y: 0.1, w: 0.3, h: 0.3 } },
  ],
  summary: "Desert road with Americas markings.",
});

test("valid result passes through with weights unchanged", () => {
  const r = validateResult(good());
  assert.equal(r.guess.country, "Chile");
  assert.deepEqual(r.clues.map((c) => c.weight), [0.6, 0.4]);
});

test("rejects missing guess country", () => {
  const g = good(); g.guess.country = "";
  assert.throws(() => validateResult(g), /invalid result: guess\.country/);
});

test("rejects empty clue list", () => {
  const g = good(); g.clues = [];
  assert.throws(() => validateResult(g), /invalid result: clues/);
});

test("rejects non-object input", () => {
  assert.throws(() => validateResult("nope"), /invalid result/);
  assert.throws(() => validateResult(null), /invalid result/);
});

test("normalises weights to sum 1", () => {
  const g = good(); g.clues[0].weight = 3; g.clues[1].weight = 1;
  const r = validateResult(g);
  assert.deepEqual(r.clues.map((c) => c.weight), [0.75, 0.25]);
});

test("all-zero weights become equal split", () => {
  assert.deepEqual(normaliseWeights([0, 0, 0]), [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(normaliseWeights([NaN, undefined]), [0.5, 0.5]);
});

test("box partly off image is clamped into 0..1", () => {
  assert.deepEqual(clampBox({ x: 0.8, y: -0.1, w: 0.5, h: 0.3 }),
    { x: 0.8, y: 0, w: 0.2, h: 0.2 });
});

test("box with zero size gets a minimum size", () => {
  const b = clampBox({ x: 0.5, y: 0.5, w: 0, h: 0 });
  assert.ok(b.w > 0 && b.h > 0);
});

test("unknown category becomes other", () => {
  const g = good(); g.clues[0].category = "vibes";
  assert.equal(validateResult(g).clues[0].category, "other");
});

test("missing optional fields are filled", () => {
  const g = good();
  delete g.alternatives; delete g.guess.region; delete g.guess.lat; delete g.guess.lng;
  const r = validateResult(g);
  assert.deepEqual(r.alternatives, []);
  assert.equal(r.guess.region, null);
  assert.equal(r.guess.lat, null);
});

test("confidence is clamped to 0..1", () => {
  const g = good(); g.confidence = 1.7;
  assert.equal(validateResult(g).confidence, 1);
});

test("duplicate clue ids are renumbered", () => {
  const g = good(); g.clues[1].id = 1;
  assert.deepEqual(validateResult(g).clues.map((c) => c.id), [1, 2]);
});

test("locality is passed through or null", () => {
  const g = good(); g.guess.locality = " Calama ";
  assert.equal(validateResult(g).guess.locality, "Calama");
  delete g.guess.locality;
  assert.equal(validateResult(g).guess.locality, null);
});
