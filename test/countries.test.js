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

import { normaliseCountries, activeCountries } from "../lib/countries.js";

test("normaliseCountries trims, dedupes case-insensitively and sorts", () => {
  assert.deepEqual(normaliseCountries([" Peru", "chile", "Peru", "", null, "Chile"]), ["chile", "Peru"]);
  assert.deepEqual(normaliseCountries(undefined), []);
});

test("activeCountries uses the user's list, else the full coverage list", () => {
  assert.deepEqual(activeCountries({ countries: ["Russia", "Australia"] }), ["Australia", "Russia"]);
  assert.equal(activeCountries({ countries: null }), COVERAGE_COUNTRIES);
  assert.equal(activeCountries({ countries: [] }), COVERAGE_COUNTRIES);
  assert.equal(activeCountries(undefined), COVERAGE_COUNTRIES);
});
