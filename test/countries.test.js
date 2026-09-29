import { test } from "node:test";
import assert from "node:assert/strict";
import { COVERAGE_COUNTRIES, isCovered } from "../lib/countries.js";

test("list is sorted and unique", () => {
  const sorted = [...COVERAGE_COUNTRIES].sort((a, b) => a.localeCompare(b, "en"));
  assert.deepEqual(COVERAGE_COUNTRIES, sorted);
  assert.equal(new Set(COVERAGE_COUNTRIES).size, COVERAGE_COUNTRIES.length);
});

test("list contains well-known covered countries and excludes uncovered ones", () => {
  for (const c of ["United States", "Japan", "Botswana", "Kyrgyzstan", "Faroe Islands"]) {
    assert.ok(COVERAGE_COUNTRIES.includes(c), c);
  }
  for (const c of ["China", "Cuba", "Iran", "Venezuela", "Paraguay"]) {
    assert.ok(!COVERAGE_COUNTRIES.includes(c), c);
  }
});

test("isCovered ignores case and whitespace", () => {
  assert.equal(isCovered("  south africa "), true);
  assert.equal(isCovered("Atlantis"), false);
});
