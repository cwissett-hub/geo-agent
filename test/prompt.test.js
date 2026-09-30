import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, RESULT_SCHEMA, SYSTEM_PROMPT, buildUserText, buildSchema, buildSystemPrompt } from "../lib/prompt.js";
import { COVERAGE_COUNTRIES } from "../lib/countries.js";

test("categories are the fixed list in spec order", () => {
  assert.deepEqual(CATEGORIES, [
    "road_markings", "signage_script", "driving_side", "vegetation_landscape",
    "architecture", "vehicles_plates", "bollards_poles", "camera_car_meta",
    "soil_climate", "sun_shadow", "other",
  ]);
});

test("schema requires every top-level property and forbids extras", () => {
  assert.equal(RESULT_SCHEMA.type, "object");
  assert.equal(RESULT_SCHEMA.additionalProperties, false);
  assert.deepEqual(RESULT_SCHEMA.required.sort(),
    ["alternatives", "clues", "confidence", "guess", "summary"]);
  const clue = RESULT_SCHEMA.properties.clues.items;
  assert.deepEqual(clue.properties.category.enum, CATEGORIES);
  assert.deepEqual(clue.required.sort(),
    ["box", "category", "id", "inference", "observation", "weight"]);
});

test("schema requires region and coordinates, allows null locality", () => {
  const g = RESULT_SCHEMA.properties.guess;
  assert.deepEqual(g.required.sort(), ["country", "lat", "lng", "locality", "region"]);
  assert.deepEqual(g.properties.region, { type: "string" });
  assert.deepEqual(g.properties.lat, { type: "number" });
  assert.deepEqual(g.properties.lng, { type: "number" });
  assert.deepEqual(g.properties.locality.type, ["string", "null"]);
});

test("schema restricts guess and alternative countries to the coverage list", () => {
  assert.deepEqual(RESULT_SCHEMA.properties.guess.properties.country.enum, COVERAGE_COUNTRIES);
  assert.deepEqual(RESULT_SCHEMA.properties.alternatives.items.properties.country.enum, COVERAGE_COUNTRIES);
});

test("system prompt lists the coverage countries by default", () => {
  assert.ok(SYSTEM_PROMPT.includes("Botswana"));
  assert.ok(SYSTEM_PROMPT.includes(`exactly as written: ${COVERAGE_COUNTRIES.join(", ")}.`));
});

test("schema and prompt follow a configured country list", () => {
  const list = ["Australia", "Russia"];
  const s = buildSchema(list);
  assert.deepEqual(s.properties.guess.properties.country.enum, list);
  assert.deepEqual(s.properties.alternatives.items.properties.country.enum, list);
  const p = buildSystemPrompt(list);
  assert.ok(p.includes("exactly as written: Australia, Russia."));
  assert.ok(!p.includes("Botswana"));
});

test("system prompt covers guard rails, corner markings and the car view", () => {
  for (const w of ["guard rails", "corner and junction markings", "Car view", "CAR FRONT", "CAR BACK", "WHOLE stacked image", "at most 20 words"]) {
    assert.ok(SYSTEM_PROMPT.includes(w), w);
  }
});

test("system prompt demands sub-country precision", () => {
  assert.ok(SYSTEM_PROMPT.includes("region"));
  assert.ok(SYSTEM_PROMPT.includes("locality"));
  assert.ok(/lat.*lng/s.test(SYSTEM_PROMPT));
});

test("system prompt names every category", () => {
  for (const c of CATEGORIES) assert.ok(SYSTEM_PROMPT.includes(c), c);
});

test("buildUserText omits feedback block when there are no lines", () => {
  const t = buildUserText([]);
  assert.ok(!t.includes("Recent misses"));
});

test("buildUserText includes each feedback line", () => {
  const t = buildUserText(["Guessed Chile; actual Peru", "Guessed Kenya; actual Uganda"]);
  assert.ok(t.includes("Recent misses"));
  assert.ok(t.includes("- Guessed Chile; actual Peru"));
  assert.ok(t.includes("- Guessed Kenya; actual Uganda"));
});

test("system prompt forbids lookups and lists human-detectable metas", () => {
  assert.ok(SYSTEM_PROMPT.includes("NO LOOKUPS"));
  for (const word of ["bollards", "road lines", "sign types", "number plates", "utility poles", "trees"]) {
    assert.ok(SYSTEM_PROMPT.includes(word), word);
  }
  assert.ok(SYSTEM_PROMPT.includes("nearest LARGE town"));
});
