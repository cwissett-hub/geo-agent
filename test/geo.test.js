import { test } from "node:test";
import assert from "node:assert/strict";
import { parseActualInput } from "../lib/geo.js";

test("country only", () => {
  assert.deepEqual(parseActualInput(" Chile ", "", ""), { country: "Chile", region: null, locality: null, lat: null, lng: null });
});

test("country, region and coordinates", () => {
  assert.deepEqual(parseActualInput("Chile", "Atacama", "-23.6, -70.4"),
    { country: "Chile", region: "Atacama", locality: null, lat: -23.6, lng: -70.4 });
});

test("nearest large town is trimmed and optional", () => {
  assert.equal(parseActualInput("Chile", "", "", " Calama ").locality, "Calama");
  assert.equal(parseActualInput("Chile", "", "", "   ").locality, null);
});

test("coordinates accept space separator", () => {
  assert.deepEqual(parseActualInput("X", "", "10 20").lat, 10);
});

test("missing country is an error", () => {
  assert.throws(() => parseActualInput("", "", ""), /actual: country is required/);
});

test("malformed coordinates are an error", () => {
  assert.throws(() => parseActualInput("X", "", "north-ish"), /actual: coordinates/);
  assert.throws(() => parseActualInput("X", "", "95, 0"), /actual: coordinates/);
});
