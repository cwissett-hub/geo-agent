import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseName, isHit, scoreClues, scoreRound, distanceKm, isRegionHit, isLocalityHit } from "../lib/score.js";

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
  assert.equal(s.regionHit, false);
  assert.equal(s.distanceKm, null);
  assert.equal(s.verdicts.length, 3);
});

test("word boundary: Nigeria clue does not match Niger", () => {
  const clue = { id: 1, category: "test", observation: "", inference: "Looks like Nigeria",
    weight: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } };
  const v = scoreClues({ guess: { country: "Test", region: null, lat: null, lng: null },
    confidence: 1, alternatives: [], summary: "", clues: [clue] },
    { country: "Niger", region: null, lat: null, lng: null });
  assert.equal(v[0].verdict, "misleading");
});

test("word boundary: Niger clue matches Niger with punctuation", () => {
  const clue = { id: 1, category: "test", observation: "", inference: "Typical of Niger.",
    weight: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } };
  const v = scoreClues({ guess: { country: "Test", region: null, lat: null, lng: null },
    confidence: 1, alternatives: [], summary: "", clues: [clue] },
    { country: "Niger", region: null, lat: null, lng: null });
  assert.equal(v[0].verdict, "supporting");
});

test("word boundary: South Africa clue matches multi-word country", () => {
  const clue = { id: 1, category: "test", observation: "", inference: "South Africa style bollards",
    weight: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } };
  const v = scoreClues({ guess: { country: "Test", region: null, lat: null, lng: null },
    confidence: 1, alternatives: [], summary: "", clues: [clue] },
    { country: "South Africa", region: null, lat: null, lng: null });
  assert.equal(v[0].verdict, "supporting");
});

test("word boundary: Guinea-Bissau clue does not match Guinea", () => {
  const clue = { id: 1, category: "test", observation: "", inference: "Guinea-Bissau road",
    weight: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } };
  const v = scoreClues({ guess: { country: "Test", region: null, lat: null, lng: null },
    confidence: 1, alternatives: [], summary: "", clues: [clue] },
    { country: "Guinea", region: null, lat: null, lng: null });
  assert.equal(v[0].verdict, "misleading");
});

test("distanceKm London to Paris is about 343 km", () => {
  const d = distanceKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
  assert.ok(Math.abs(d - 343.5) < 2, String(d));
});

test("distanceKm is zero for the same point and null when a coordinate is missing", () => {
  assert.equal(distanceKm({ lat: 10, lng: 20 }, { lat: 10, lng: 20 }), 0);
  assert.equal(distanceKm({ lat: 10, lng: 20 }, { lat: null, lng: 20 }), null);
  assert.equal(distanceKm({ lat: NaN, lng: 20 }, { lat: 1, lng: 2 }), null);
});

test("isRegionHit compares regions loosely", () => {
  const r = { ...result, guess: { ...result.guess, region: "Atacama Region" } };
  assert.equal(isRegionHit(r, { country: "Chile", region: "atacama", lat: null, lng: null }), true);
  assert.equal(isRegionHit(r, { country: "Chile", region: "Antofagasta", lat: null, lng: null }), false);
  assert.equal(isRegionHit(r, { country: "Chile", region: null, lat: null, lng: null }), false);
});

test("scoreRound reports region hit and distance", () => {
  const r = { ...result, guess: { country: "Chile", region: "Atacama", locality: null, lat: -23.6, lng: -70.4 } };
  const s = scoreRound(r, { country: "Chile", region: "Atacama", lat: -23.65, lng: -70.4 });
  assert.equal(s.hit, true);
  assert.equal(s.regionHit, true);
  assert.ok(s.distanceKm > 5 && s.distanceKm < 6, String(s.distanceKm));
  const t = scoreRound(r, { country: "Chile", region: null, lat: null, lng: null });
  assert.equal(t.regionHit, false);
  assert.equal(t.distanceKm, null);
});

test("isLocalityHit compares nearest large towns loosely", () => {
  const r = { ...result, guess: { ...result.guess, locality: "Calama" } };
  assert.equal(isLocalityHit(r, { country: "Chile", region: null, locality: "calama", lat: null, lng: null }), true);
  assert.equal(isLocalityHit(r, { country: "Chile", region: null, locality: "Calama, Chile", lat: null, lng: null }), true);
  assert.equal(isLocalityHit(r, { country: "Chile", region: null, locality: "Antofagasta", lat: null, lng: null }), false);
  assert.equal(isLocalityHit(r, { country: "Chile", region: null, locality: null, lat: null, lng: null }), false);
  assert.equal(isLocalityHit({ ...result, guess: { ...result.guess, locality: null } },
    { country: "Chile", region: null, locality: "Calama", lat: null, lng: null }), false);
});

test("scoreRound reports the town hit and a clue naming the town is supporting", () => {
  const r = { ...result, guess: { ...result.guess, locality: "Calama" },
    clues: [{ id: 1, category: "signage_script", observation: "Sign says Calama", inference: "Near Calama", weight: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }] };
  const s = scoreRound(r, { country: "Peru", region: null, locality: "Calama", lat: null, lng: null });
  assert.equal(s.hit, false);
  assert.equal(s.localityHit, true);
  assert.deepEqual(s.verdicts, [{ id: 1, verdict: "supporting" }]);
});

import { isPass, scorePassed, PASS_KM } from "../lib/score.js";

const at = (country, region, locality, lat, lng) => ({ ...result, guess: { country, region, locality, lat, lng } });

test("pass: wrong country always fails", () => {
  assert.equal(isPass(at("Peru", null, null, null, null), { country: "Chile", region: null, locality: null, lat: null, lng: null }), false);
});

test("pass: right country with nothing finer to check passes", () => {
  assert.equal(isPass(at("Chile", null, null, null, null), { country: "Chile", region: null, locality: null, lat: null, lng: null }), true);
});

test("pass: right country, thousands of km out, fails", () => {
  const g = at("Australia", "New South Wales", "Sydney", -33.87, 151.21);
  assert.equal(isPass(g, { country: "Australia", region: "Western Australia", locality: "Perth", lat: -31.95, lng: 115.86 }), false);
});

test("pass: right country and within PASS_KM passes even with a different region name", () => {
  const g = at("Russia", "Moscow Oblast", null, 55.75, 37.62);
  const a = { country: "Russia", region: "Tver Oblast", locality: null, lat: 56.86, lng: 35.9 };
  assert.ok(distanceKm(g.guess, a) < PASS_KM);
  assert.equal(isPass(g, a), true);
});

test("pass: right country and region name matches, no coordinates, passes", () => {
  const g = at("Russia", "Primorsky Krai", null, null, null);
  assert.equal(isPass(g, { country: "Russia", region: "Primorsky Krai", locality: null, lat: null, lng: null }), true);
  assert.equal(isPass(g, { country: "Russia", region: "Altai Krai", locality: null, lat: null, lng: null }), false);
});

test("scoreRound carries pass; scorePassed falls back to hit for old scores", () => {
  const s = scoreRound(at("Chile", null, null, null, null), { country: "Chile", region: null, locality: null, lat: null, lng: null });
  assert.equal(s.pass, true);
  assert.equal(scorePassed({ hit: true }), true);
  assert.equal(scorePassed({ hit: true, pass: false }), false);
  assert.equal(scorePassed(null), false);
});
