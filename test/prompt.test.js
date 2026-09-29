import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, RESULT_SCHEMA, SYSTEM_PROMPT, buildUserText } from "../lib/prompt.js";

test("categories are the fixed list in spec order", () => {
  assert.deepEqual(CATEGORIES, [
    "road_markings", "signage_script", "driving_side", "vegetation_landscape",
    "architecture", "vehicles_plates", "bollards_poles", "camera_car_meta",
    "soil_climate", "other",
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

test("schema marks optional guess fields nullable", () => {
  const g = RESULT_SCHEMA.properties.guess.properties;
  assert.deepEqual(g.region.type, ["string", "null"]);
  assert.deepEqual(g.lat.type, ["number", "null"]);
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
