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

import { mapBbox, osmEmbedUrl } from "../lib/geo.js";

test("mapBbox centres a regional view on the guess", () => {
  const b = mapBbox({ lat: -22.46, lng: -68.93 });
  assert.ok(Math.abs((b.minLat + b.maxLat) / 2 + 22.46) < 1e-9);
  assert.ok(b.maxLat - b.minLat >= 8 && b.maxLng - b.minLng >= 12);
});

test("mapBbox widens to include the actual location", () => {
  const b = mapBbox({ lat: 55.75, lng: 37.62 }, { lat: 43.12, lng: 131.89 });
  assert.ok(b.minLng < 37.62 && b.maxLng > 131.89);
  assert.ok(b.minLat < 43.12 && b.maxLat > 55.75);
});

test("mapBbox clamps near the poles and the antimeridian", () => {
  const b = mapBbox({ lat: 84, lng: 178 });
  assert.ok(b.maxLat <= 85 && b.maxLng <= 180);
});

test("osmEmbedUrl is an OpenStreetMap embed with a marker on the guess", () => {
  const u = new URL(osmEmbedUrl({ lat: -22.46, lng: -68.93 }));
  assert.equal(u.origin + u.pathname, "https://www.openstreetmap.org/export/embed.html");
  assert.equal(u.searchParams.get("marker"), "-22.4600,-68.9300");
  assert.equal(u.searchParams.get("bbox").split(",").length, 4);
});
