import { test } from "node:test";
import assert from "node:assert/strict";
import { newRound, applyActual, feedbackLines, stats } from "../lib/notebook-logic.js";

const res = (country) => ({
  guess: { country, region: null, locality: null, lat: null, lng: null },
  confidence: 0.6,
  alternatives: [],
  summary: "",
  clues: [
    { id: 1, category: "road_markings", observation: "yellow centre line", inference: "Americas, likely Chile", weight: 0.5,
      box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  ],
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

test("stats aggregates by category and provider", () => {
  const r1 = applyActual(newRound("d1", [{ provider: "gemini", model: "m", result: res("Chile"), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });
  const r2 = applyActual(newRound("d2", [{ provider: "gemini", model: "m", result: res("Peru"), error: null }]),
    { country: "Chile", region: null, lat: null, lng: null });
  const s = stats([r1, r2]);
  assert.deepEqual(s.byProvider.gemini, { hits: 1, rounds: 2, rate: 0.5, regionHits: 0, meanDistanceKm: null });
});
