import { test } from "node:test";
import assert from "node:assert/strict";
import { newRound, applyActual, feedbackLines, stats, serialiseRounds, parseImport } from "../lib/notebook-logic.js";

const res = (country, clueText = "yellow centre line") => ({
  guess: { country, region: null, locality: null, lat: null, lng: null }, confidence: 0.5, alternatives: [], summary: "",
  clues: [
    { id: 1, category: "road_markings", observation: clueText, inference: "Americas", weight: 0.7, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: 2, category: "soil_climate", observation: "arid", inference: "desert", weight: 0.3, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  ],
});

test("newRound has an id, timestamp and no actual", () => {
  const r = newRound("data:image/png;base64,AA", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]);
  assert.equal(typeof r.id, "string");
  assert.ok(r.ts > 0);
  assert.equal(r.actual, null);
  assert.equal(r.scores, null);
});

test("applyActual scores every successful result and skips errored ones", () => {
  const r = newRound("d", [
    { provider: "gemini", model: "m", result: res("Chile"), error: null },
    { provider: "openai", model: "m", result: null, error: { code: "no_key", message: "", raw: null } },
  ]);
  const a = applyActual(r, { country: "Chile", region: null, lat: null, lng: null });
  assert.equal(a.scores.gemini.hit, true);
  assert.equal(a.scores.openai, undefined);
  assert.equal(r.scores, null, "does not mutate input");
});

test("feedbackLines lists misses newest first with top clue", () => {
  const miss1 = applyActual({ ...newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]), ts: 1 },
    { country: "Peru", region: null, lat: null, lng: null });
  const hit = applyActual({ ...newRound("d", [{ provider: "gemini", model: "m", result: res("Kenya"), error: null }]), ts: 2 },
    { country: "Kenya", region: null, lat: null, lng: null });
  const miss2 = applyActual({ ...newRound("d", [{ provider: "gemini", model: "m", result: res("Norway", "snow poles"), error: null }]), ts: 3 },
    { country: "Sweden", region: null, lat: null, lng: null });
  const lines = feedbackLines([miss1, hit, miss2]);
  assert.deepEqual(lines, [
    "Guessed Norway (top clue: snow poles); actual Sweden",
    "Guessed Chile (top clue: yellow centre line); actual Peru",
  ]);
});

test("feedbackLines respects the limit and ignores unscored rounds", () => {
  const rounds = [];
  for (let i = 0; i < 20; i++) {
    rounds.push(applyActual({ ...newRound("d", [{ provider: "gemini", model: "m", result: res("A"), error: null }]), ts: i },
      { country: "B", region: null, lat: null, lng: null }));
  }
  rounds.push(newRound("d", [{ provider: "gemini", model: "m", result: res("A"), error: null }]));
  assert.equal(feedbackLines(rounds).length, 12);
  assert.equal(feedbackLines(rounds, 3).length, 3);
});

test("stats aggregates by category and provider", () => {
  const hit = applyActual(newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });
  const miss = applyActual(newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]),
    { country: "Peru", region: null, lat: null, lng: null });
  const unscored = newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]);
  const s = stats([hit, miss, unscored]);
  assert.equal(s.total, 2);
  assert.deepEqual(s.byProvider.gemini, { hits: 1, passes: 1, passRate: 0.5, rounds: 2, rate: 0.5, regionHits: 0, localityHits: 0, meanDistanceKm: null });
  assert.deepEqual(s.byCategory.road_markings, { supporting: 1, misleading: 1, rate: 0.5 });
  assert.deepEqual(s.byCategory.soil_climate, { supporting: 1, misleading: 1, rate: 0.5 });
});

test("serialise and parseImport round trip", () => {
  const r = newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]);
  const text = serialiseRounds([r]);
  const back = parseImport(text);
  assert.deepEqual(back, [r]);
  assert.deepEqual(parseImport(JSON.stringify([r])), [r]);
});

test("parseImport rejects wrong shapes", () => {
  assert.throws(() => parseImport("{}"), /import:/);
  assert.throws(() => parseImport("[1,2]"), /import:/);
  assert.throws(() => parseImport("not json"), /import:/);
  assert.throws(() => parseImport(JSON.stringify([{ id: "x" }])), /import:/);
});

test("parseImport sanitises an untrusted clue category to 'other'", () => {
  const malicious = res("Chile");
  malicious.clues[0].category = 'x"><img src=x onerror=alert(1)>';
  const r = newRound("d", [{ provider: "gemini", model: "m", result: malicious, error: null }]);
  const [back] = parseImport(JSON.stringify([r]));
  assert.equal(back.results[0].result.clues[0].category, "other");
});

test("parseImport converts an unparseable result to an error entry instead of rejecting the file", () => {
  const broken = res("Chile");
  delete broken.guess.country;
  const r = newRound("d", [
    { provider: "gemini", model: "m", result: broken, error: null },
    { provider: "openai", model: "m", result: res("Chile"), error: null },
  ]);
  const [back] = parseImport(JSON.stringify([r]));
  assert.equal(back.results[0].result, null);
  assert.equal(back.results[0].error.code, "unparseable");
  assert.ok(back.results[0].error.message);
  assert.equal(back.results[1].result.guess.country, "Chile");
});

test("stats report region hits and mean distance per provider", () => {
  const withCoords = (lat, lng) => ({
    ...res("Chile"), guess: { country: "Chile", region: "Atacama", locality: null, lat, lng },
  });
  const a = applyActual(newRound("d", [{ provider: "openai", model: "m", result: withCoords(-23.6, -70.4), error: null }]),
    { country: "Chile", region: "Atacama", lat: -23.6, lng: -70.4 });           // 0 km, region hit
  const b = applyActual(newRound("d", [{ provider: "openai", model: "m", result: withCoords(-23.6, -70.4), error: null }]),
    { country: "Chile", region: "Antofagasta", lat: -22.7, lng: -70.4 });       // ~100 km, region miss
  const c = applyActual(newRound("d", [{ provider: "openai", model: "m", result: withCoords(-23.6, -70.4), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });                  // no distance
  const s = stats([a, b, c]);
  assert.equal(s.byProvider.openai.rounds, 3);
  assert.equal(s.byProvider.openai.regionHits, 1);
  assert.ok(Math.abs(s.byProvider.openai.meanDistanceKm - 50) < 2, String(s.byProvider.openai.meanDistanceKm));
});

test("stats meanDistanceKm is null when no round has coordinates", () => {
  const r = applyActual(newRound("d", [{ provider: "openai", model: "m", result: res("Chile"), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });
  assert.equal(stats([r]).byProvider.openai.meanDistanceKm, null);
});

test("feedbackLines include regions when known", () => {
  const r = applyActual(newRound("d", [{ provider: "openai", model: "m",
    result: { ...res("Chile"), guess: { country: "Chile", region: "Atacama", locality: null, lat: null, lng: null } }, error: null }]),
    { country: "Peru", region: "Arequipa", lat: null, lng: null });
  assert.deepEqual(feedbackLines([r]), ["Guessed Chile, Atacama (top clue: yellow centre line); actual Peru, Arequipa"]);
});

test("feedbackLines and stats include the nearest large town", () => {
  const r = applyActual(newRound("d", [{ provider: "openai", model: "m",
    result: { ...res("Chile"), guess: { country: "Chile", region: "Atacama", locality: "Calama", lat: null, lng: null } }, error: null }]),
    { country: "Peru", region: "Arequipa", locality: "Arequipa", lat: null, lng: null });
  assert.deepEqual(feedbackLines([r]), ["Guessed Chile, Atacama, Calama (top clue: yellow centre line); actual Peru, Arequipa, Arequipa"]);
  const hit = applyActual(newRound("d", [{ provider: "openai", model: "m",
    result: { ...res("Chile"), guess: { country: "Chile", region: "Atacama", locality: "Calama", lat: null, lng: null } }, error: null }]),
    { country: "Chile", region: null, locality: "calama", lat: null, lng: null });
  assert.equal(stats([r, hit]).byProvider.openai.localityHits, 1);
});

test("right country but far away is fed back as a miss", () => {
  const far = res("Russia");
  far.guess = { country: "Russia", region: "Moscow Oblast", locality: "Moscow", lat: 55.75, lng: 37.62 };
  const round = applyActual({ ...newRound("d", [{ provider: "openai", model: "m", result: far, error: null }]), ts: 1 },
    { country: "Russia", region: "Primorsky Krai", locality: "Vladivostok", lat: 43.12, lng: 131.89 });
  assert.equal(round.scores.openai.hit, true);
  assert.equal(round.scores.openai.pass, false);
  const [line] = feedbackLines([round]);
  assert.match(line, /right country, wrong region, \d+ km off; actual Russia, Primorsky Krai, Vladivostok/);
  const s = stats([round]);
  assert.equal(s.byProvider.openai.hits, 1);
  assert.equal(s.byProvider.openai.passes, 0);
});

test("rounds scored before pass existed fall back to the country hit", () => {
  const round = applyActual(newRound("d", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });
  delete round.scores.gemini.pass;
  assert.deepEqual(feedbackLines([round]), []);
  assert.equal(stats([round]).byProvider.gemini.passes, 1);
});
