import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseName, isHit, scoreClues, scoreRound } from "../lib/score.js";

const result = {
  guess: { country: "Chile", region: null, lat: null, lng: null },
  confidence: 0.6, alternatives: [], summary: "",
  clues: [
    { id: 1, category: "road_markings", observation: "Yellow line", inference: "Americas, likely Chile", weight: 0.5,
      box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: 2, category: "signage_script", observation: "Spanish sign", inference: "Spanish speaking; Peru or Chile", weight: 0.3,
      box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: 3, category: "soil_climate", observation: "Red soil", inference: "Suggests Australia outback", weight: 0.2,
      box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  ],
};

test("normaliseName trims, lowercases and collapses spaces", () => {
  assert.equal(normaliseName("  United   States "), "united states");
});

test("hit ignores case and whitespace", () => {
  assert.equal(isHit(result, { country: "  chile ", region: null, lat: null, lng: null }), true);
  assert.equal(isHit(result, { country: "Peru", region: null, lat: null, lng: null }), false);
});

test("on a hit every clue is supporting", () => {
  const v = scoreClues(result, { country: "Chile", region: null, lat: null, lng: null });
  assert.deepEqual(v.map((x) => x.verdict), ["supporting", "supporting", "supporting"]);
});

test("on a miss a clue is supporting only if it names the actual country or region", () => {
  const v = scoreClues(result, { country: "Peru", region: "Arequipa", lat: null, lng: null });
  assert.deepEqual(v, [
    { id: 1, verdict: "misleading" },
    { id: 2, verdict: "supporting" },
    { id: 3, verdict: "misleading" },
  ]);
});

test("region match counts as supporting", () => {
  const v = scoreClues(result, { country: "Australia", region: "Outback", lat: null, lng: null });
  assert.equal(v[2].verdict, "supporting");
});

test("scoreRound bundles hit and verdicts", () => {
  const s = scoreRound(result, { country: "Chile", region: null, lat: null, lng: null });
  assert.equal(s.hit, true);
  assert.equal(s.verdicts.length, 3);
});
