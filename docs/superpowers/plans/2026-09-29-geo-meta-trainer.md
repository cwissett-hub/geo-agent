# Geo Meta Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-contained Chrome extension that screenshots a GeoGuessr round on demand, asks a vision model (Claude, OpenAI or Gemini) where it is, shows each clue boxed on the screenshot with its weight, and records rounds plus the true answer in a personal notebook.

**Architecture:** One Manifest V3 extension, plain ES-module JavaScript, no build step. The service worker (`background.js`) captures the tab and calls the active provider adapter; the side panel renders results and owns the notebook. Everything under `lib/` is pure and shared between the extension and Node tests: provider adapters are split into `buildRequest` / `parseResponse` functions, and every provider returns the same `RoundResult` contract validated by `lib/validate.js`.

**Tech Stack:** Chrome MV3 (service worker, side panel, commands, storage, tabs.captureVisibleTab), vanilla JS ES modules, IndexedDB, Node 24 `node --test` for unit tests. Raw `fetch` to Anthropic, OpenAI and Gemini HTTP APIs.

**Spec:** `docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md`

## Global Constraints

- Plain JavaScript ES modules only. No bundler, no TypeScript, no npm runtime dependencies. `npm test` must work with zero installs.
- Manifest V3. Side panel UI. Default capture shortcut `Alt+G`.
- The extension never pans, zooms, moves or injects into the Street View viewer, and never reads GeoGuessr page internals. Capture is `chrome.tabs.captureVisibleTab` only.
- API keys live in `chrome.storage.local` and are sent only to their own vendor's endpoint.
- Anthropic default model `claude-opus-5`; requests carry `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`; JSON via `output_config.format` `json_schema`; `stop_reason` checked before reading content. Default `max_tokens` 16000.
- OpenAI default model `gpt-5`; JSON via `response_format: {type: "json_schema", json_schema: {strict: true}}`.
- Gemini default model `gemini-2.5-flash`; JSON via `generationConfig.responseMimeType: "application/json"` + `responseSchema`.
- Clue categories are exactly: `road_markings`, `signage_script`, `driving_side`, `vegetation_landscape`, `architecture`, `vehicles_plates`, `bollards_poles`, `camera_car_meta`, `soil_climate`, `other`.
- Box coordinates are fractions in 0..1. Weights are normalised to sum to 1 before display.
- Nothing is written to the notebook until a result validates.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Push to `origin main` (public GitHub) at the end of each task. Never commit keys.
- Screenshots are downscaled to at most 1600 px on the long edge and encoded as JPEG (quality 0.85) before being sent to any provider or stored. The stored image is the same one the model saw, so fractional boxes always line up.

## UI Design Requirements (Tasks 10, 11, 12)

The user plays on 1440p or 4K monitors and will drag the side panel wide, or open the panel page in a full tab. The UI must be genuinely good, not a default form.

- **REQUIRED SUB-SKILL for Tasks 10-12:** invoke `frontend-design:frontend-design` before writing any HTML/CSS in the task, and follow its direction for typography, spacing and colour. The CSS in this plan is a functional baseline that satisfies the tests and the layout contract below; the implementer replaces its look under the skill's guidance while keeping every class name and DOM hook the JS depends on.
- **REQUIRED SUB-SKILL for the weight bars (Task 11) and the stats card (Task 12):** invoke `dataviz` before writing them. Bars are a single categorical series coloured by clue category; the stats card is two small tables with a per-row reliability meter. Follow the skill's palette and accessibility rules; the category colour variables `--c-<category>` in the CSS are the single source of truth for category colour everywhere (boxes, clue numbers, bars, stats).
- **Layout contract, narrow (panel under 720 px wide):** single column; screenshot full width; clue list beneath; actual-location card last.
- **Layout contract, wide (720 px and above):** two-column grid. Left column: the screenshot, sticky so it stays in view while scrolling clues, capped at 60 % of the width. Right column: guess header, clue list, summary, alternatives, actual-location card. With "ask all", each provider gets its own right-hand card stacked vertically, and the boxes drawn on the shared screenshot switch to whichever provider card the pointer is over.
- **Open in a tab:** a header button opens `sidepanel.html` in a new browser tab (`chrome.tabs.create({url: chrome.runtime.getURL("sidepanel.html")})`). The same page must work identically there; the tab is the intended review surface on a big monitor. Notebook rows in a wide view show larger thumbnails (160 px) and a second line of clue-category chips.
- **Text density:** base font 14 px in the panel, 15 px when the viewport is over 1000 px wide. Line length for summaries capped at about 70 characters.
- **Hover and focus:** every clickable clue row and box has a visible hover state and a keyboard focus ring; clue rows are `tabindex="0"` and toggle with Enter or Space.
- **Motion:** box highlight and row highlight transition in 120 ms; no other animation.

## Review Focus

1. **A clue box partly off-image** (x + w > 1, or negative x): the validator clamps it into 0..1 rather than rejecting the whole round. Test in Task 2.
2. **All clue weights zero or missing**: normalising must not divide by zero; fall back to equal weights. Test in Task 2.
3. **Actual country typed with different case or surrounding spaces** ("  chile "): scoring must still count a hit. Test in Task 3.
4. **A provider returns HTTP 200 whose body is not JSON, or JSON that fails the schema**: the adapter throws a `ProviderError` with code `unparseable` carrying the raw text, and the round is not saved. Test in Tasks 4, 5, 6.
5. **Notebook import of a file that is not an array of rounds**: `parseImport` rejects with a clear error and leaves the existing notebook untouched. Test in Task 7.

---

### Task 1: Project scaffold, prompt module and result schema

**Files:**
- Create: `package.json`
- Create: `lib/prompt.js`
- Test: `test/prompt.test.js`

**Interfaces:**
- Produces:
  - `export const CATEGORIES` — array of the 10 category strings in spec order.
  - `export const RESULT_SCHEMA` — JSON Schema object for `RoundResult`. Every property is `required`, optional values are nullable (`type: ["string","null"]` etc.), every object has `additionalProperties: false`. Used verbatim by Anthropic and OpenAI; Gemini converts it in Task 6.
  - `export const SYSTEM_PROMPT` — string.
  - `export function buildUserText(feedbackLines)` — `feedbackLines: string[]` → string. Appends a "Recent misses" block only when lines are non-empty.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "geo-meta-trainer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/prompt.test.js`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../lib/prompt.js`.

- [ ] **Step 4: Write lib/prompt.js**

```js
export const CATEGORIES = [
  "road_markings", "signage_script", "driving_side", "vegetation_landscape",
  "architecture", "vehicles_plates", "bollards_poles", "camera_car_meta",
  "soil_climate", "other",
];

const box = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: {
    x: { type: "number" }, y: { type: "number" },
    w: { type: "number" }, h: { type: "number" },
  },
};

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["guess", "confidence", "alternatives", "clues", "summary"],
  properties: {
    guess: {
      type: "object",
      additionalProperties: false,
      required: ["country", "region", "lat", "lng"],
      properties: {
        country: { type: "string" },
        region: { type: ["string", "null"] },
        lat: { type: ["number", "null"] },
        lng: { type: ["number", "null"] },
      },
    },
    confidence: { type: "number" },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["country", "why_not"],
        properties: { country: { type: "string" }, why_not: { type: "string" } },
      },
    },
    clues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "observation", "inference", "weight", "box"],
        properties: {
          id: { type: "integer" },
          category: { type: "string", enum: CATEGORIES },
          observation: { type: "string" },
          inference: { type: "string" },
          weight: { type: "number" },
          box,
        },
      },
    },
    summary: { type: "string" },
  },
};

export const SYSTEM_PROMPT = `You are a GeoGuessr coach. You will be shown a single Street View screenshot.
Work out where in the world it is, then explain your reasoning as a list of concrete visual clues so the player can learn the "metas" you used.

Rules:
- Return only the JSON object described by the schema.
- guess.country is required. Add region, lat and lng when you have a real basis for them, otherwise null.
- confidence is 0 to 1 for the country guess.
- Give 3 to 8 clues. Each clue is one specific thing you can see in the image, not a general impression.
- Each clue has:
  - category: one of ${CATEGORIES.join(", ")}.
  - observation: what is visible (e.g. "yellow centre line with white edge lines").
  - inference: what it tells you about location and what it rules in or out.
  - weight: how much this clue drove the final guess, 0 to 1. Weights across all clues should sum to about 1.
  - box: where the clue is in the image as fractions of width and height (x, y is the top-left corner; w, h the size). Be as tight as you reasonably can.
- alternatives: up to 3 other countries you considered and one sentence on why you rejected each.
- summary: two or three sentences tying the clues together.
Be honest about uncertainty. A low-confidence guess with clear reasoning is more useful than false certainty.`;

export function buildUserText(feedbackLines) {
  let text = "Where is this GeoGuessr round? Analyse the screenshot and answer in the required JSON format.";
  if (feedbackLines && feedbackLines.length) {
    text += "\n\nRecent misses by this coach on earlier rounds, for calibration:\n";
    text += feedbackLines.map((l) => `- ${l}`).join("\n");
  }
  return text;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: 6 passing.

- [ ] **Step 6: Commit and push**

```bash
git add package.json lib/prompt.js test/prompt.test.js
git commit -m "Add prompt module, result schema and test scaffold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Result validator and weight normaliser

**Files:**
- Create: `lib/validate.js`
- Test: `test/validate.test.js`

**Interfaces:**
- Consumes: `CATEGORIES` from `lib/prompt.js`.
- Produces:
  - `export function validateResult(obj)` — returns a cleaned `RoundResult` or throws `Error` whose message starts with `"invalid result: "`. Cleaning: clamps boxes into 0..1, clamps confidence to 0..1, normalises weights to sum 1, forces unknown categories to `"other"`, fills missing `alternatives` with `[]`, fills missing `region/lat/lng` with `null`, renumbers `id` 1..n if missing or duplicated.
  - `export function normaliseWeights(weights)` — `number[]` → `number[]` summing to 1; equal split if the sum is 0 or all values are non-finite.
  - `export function clampBox(box)` — returns `{x,y,w,h}` within 0..1 with `w,h > 0`.

- [ ] **Step 1: Write the failing test**

`test/validate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult, normaliseWeights, clampBox } from "../lib/validate.js";

const good = () => ({
  guess: { country: "Chile", region: "Atacama", lat: -23.6, lng: -70.4 },
  confidence: 0.7,
  alternatives: [{ country: "Peru", why_not: "Signs differ" }],
  clues: [
    { id: 1, category: "road_markings", observation: "Yellow centre line", inference: "Americas", weight: 0.6,
      box: { x: 0.1, y: 0.5, w: 0.4, h: 0.2 } },
    { id: 2, category: "soil_climate", observation: "Arid", inference: "Desert", weight: 0.4,
      box: { x: 0.5, y: 0.1, w: 0.3, h: 0.3 } },
  ],
  summary: "Desert road with Americas markings.",
});

test("valid result passes through with weights unchanged", () => {
  const r = validateResult(good());
  assert.equal(r.guess.country, "Chile");
  assert.deepEqual(r.clues.map((c) => c.weight), [0.6, 0.4]);
});

test("rejects missing guess country", () => {
  const g = good(); g.guess.country = "";
  assert.throws(() => validateResult(g), /invalid result: guess\.country/);
});

test("rejects empty clue list", () => {
  const g = good(); g.clues = [];
  assert.throws(() => validateResult(g), /invalid result: clues/);
});

test("rejects non-object input", () => {
  assert.throws(() => validateResult("nope"), /invalid result/);
  assert.throws(() => validateResult(null), /invalid result/);
});

test("normalises weights to sum 1", () => {
  const g = good(); g.clues[0].weight = 3; g.clues[1].weight = 1;
  const r = validateResult(g);
  assert.deepEqual(r.clues.map((c) => c.weight), [0.75, 0.25]);
});

test("all-zero weights become equal split", () => {
  assert.deepEqual(normaliseWeights([0, 0, 0]), [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(normaliseWeights([NaN, undefined]), [0.5, 0.5]);
});

test("box partly off image is clamped into 0..1", () => {
  assert.deepEqual(clampBox({ x: 0.8, y: -0.1, w: 0.5, h: 0.3 }),
    { x: 0.8, y: 0, w: 0.2, h: 0.2 });
});

test("box with zero size gets a minimum size", () => {
  const b = clampBox({ x: 0.5, y: 0.5, w: 0, h: 0 });
  assert.ok(b.w > 0 && b.h > 0);
});

test("unknown category becomes other", () => {
  const g = good(); g.clues[0].category = "vibes";
  assert.equal(validateResult(g).clues[0].category, "other");
});

test("missing optional fields are filled", () => {
  const g = good();
  delete g.alternatives; delete g.guess.region; delete g.guess.lat; delete g.guess.lng;
  const r = validateResult(g);
  assert.deepEqual(r.alternatives, []);
  assert.equal(r.guess.region, null);
  assert.equal(r.guess.lat, null);
});

test("confidence is clamped to 0..1", () => {
  const g = good(); g.confidence = 1.7;
  assert.equal(validateResult(g).confidence, 1);
});

test("duplicate clue ids are renumbered", () => {
  const g = good(); g.clues[1].id = 1;
  assert.deepEqual(validateResult(g).clues.map((c) => c.id), [1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../lib/validate.js`.

- [ ] **Step 3: Write lib/validate.js**

```js
import { CATEGORIES } from "./prompt.js";

const MIN_SIZE = 0.02;

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

export function clampBox(box) {
  const b = box && typeof box === "object" ? box : {};
  const x = clamp01(Number.isFinite(b.x) ? b.x : 0);
  const y = clamp01(Number.isFinite(b.y) ? b.y : 0);
  let w = Number.isFinite(b.w) ? b.w : MIN_SIZE;
  let h = Number.isFinite(b.h) ? b.h : MIN_SIZE;
  w = Math.max(MIN_SIZE, Math.min(w, 1 - x));
  h = Math.max(MIN_SIZE, Math.min(h, 1 - y));
  // if the minimum size pushed us past the edge, pull the origin back
  return {
    x: Math.min(x, 1 - w),
    y: Math.min(y, 1 - h),
    w: round(w), h: round(h),
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function normaliseWeights(weights) {
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 1 / weights.length);
  return clean.map((w) => w / sum);
}

function fail(what) {
  throw new Error(`invalid result: ${what}`);
}

export function validateResult(obj) {
  if (!obj || typeof obj !== "object") fail("not an object");
  const g = obj.guess;
  if (!g || typeof g !== "object") fail("guess missing");
  if (typeof g.country !== "string" || !g.country.trim()) fail("guess.country missing");
  if (!Array.isArray(obj.clues) || obj.clues.length === 0) fail("clues empty");
  if (typeof obj.summary !== "string") fail("summary missing");

  const weights = normaliseWeights(obj.clues.map((c) => Number(c && c.weight)));
  const seen = new Set();
  const clues = obj.clues.map((c, i) => {
    if (!c || typeof c !== "object") fail(`clues[${i}] not an object`);
    let id = Number.isInteger(c.id) ? c.id : i + 1;
    if (seen.has(id)) id = i + 1;
    seen.add(id);
    return {
      id,
      category: CATEGORIES.includes(c.category) ? c.category : "other",
      observation: String(c.observation ?? ""),
      inference: String(c.inference ?? ""),
      weight: weights[i],
      box: clampBox(c.box),
    };
  });
  // renumber if renumbering above produced a duplicate anyway
  const ids = clues.map((c) => c.id);
  if (new Set(ids).size !== ids.length) clues.forEach((c, i) => { c.id = i + 1; });

  const alternatives = Array.isArray(obj.alternatives)
    ? obj.alternatives
        .filter((a) => a && typeof a.country === "string")
        .map((a) => ({ country: a.country, why_not: String(a.why_not ?? "") }))
    : [];

  return {
    guess: {
      country: g.country.trim(),
      region: typeof g.region === "string" && g.region.trim() ? g.region.trim() : null,
      lat: Number.isFinite(g.lat) ? g.lat : null,
      lng: Number.isFinite(g.lng) ? g.lng : null,
    },
    confidence: clamp01(Number.isFinite(obj.confidence) ? obj.confidence : 0.5),
    alternatives,
    clues,
    summary: obj.summary,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing (18 tests so far). If the "duplicate clue ids" test fails because ids come out `[1, 2]` already via the `seen` check, that is the intended behaviour; the test expects `[1, 2]`.

- [ ] **Step 5: Commit and push**

```bash
git add lib/validate.js test/validate.test.js
git commit -m "Add result validator and weight normaliser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Clue scoring

**Files:**
- Create: `lib/score.js`
- Test: `test/score.test.js`

**Interfaces:**
- Consumes: a validated `RoundResult` (Task 2) and an `Actual` object `{country: string, region: string|null, lat: number|null, lng: number|null}`.
- Produces:
  - `export function normaliseName(s)` — lower-case, trimmed, collapsed whitespace.
  - `export function isHit(result, actual)` — boolean, country match by `normaliseName`.
  - `export function scoreClues(result, actual)` — returns `Array<{id: number, verdict: "supporting"|"misleading"}>` in clue order.
  - `export function scoreRound(result, actual)` — returns `{hit: boolean, verdicts: Array<{id, verdict}>}`.

- [ ] **Step 1: Write the failing test**

`test/score.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../lib/score.js`.

- [ ] **Step 3: Write lib/score.js**

```js
export function normaliseName(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isHit(result, actual) {
  return normaliseName(result.guess.country) === normaliseName(actual.country);
}

function mentions(text, name) {
  const n = normaliseName(name);
  return n.length > 0 && normaliseName(text).includes(n);
}

export function scoreClues(result, actual) {
  const hit = isHit(result, actual);
  return result.clues.map((c) => {
    const text = `${c.observation} ${c.inference}`;
    const supporting = hit
      || mentions(text, actual.country)
      || (actual.region && mentions(text, actual.region));
    return { id: c.id, verdict: supporting ? "supporting" : "misleading" };
  });
}

export function scoreRound(result, actual) {
  return { hit: isHit(result, actual), verdicts: scoreClues(result, actual) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit and push**

```bash
git add lib/score.js test/score.test.js
git commit -m "Add clue scoring

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Provider plumbing and the Anthropic adapter

**Files:**
- Create: `lib/providers/common.js`
- Create: `lib/providers/anthropic.js`
- Test: `test/providers.common.test.js`
- Test: `test/providers.anthropic.test.js`

**Interfaces:**
- Consumes: `SYSTEM_PROMPT`, `RESULT_SCHEMA`, `buildUserText` from `lib/prompt.js`; `validateResult` from `lib/validate.js`.
- Produces (common):
  - `export class ProviderError extends Error` with fields `code` (one of `"no_key"|"key_rejected"|"rate_limited"|"server"|"network"|"unparseable"|"refusal"`), `status` (number|null), `raw` (string|null).
  - `export function splitDataUrl(dataUrl)` → `{mediaType: string, base64: string}`; throws `ProviderError("unparseable")` if not a data URL.
  - `export function mapHttpError(status, bodyText)` → `ProviderError` for non-2xx.
  - `export function parseJsonText(text)` → object; throws `ProviderError("unparseable", raw=text)` on bad JSON. Strips a leading ```` ```json ```` fence if present.
- Produces (anthropic): an adapter object with a fixed shape every adapter shares:
  ```js
  export const anthropic = {
    id: "anthropic",
    label: "Claude (Anthropic)",
    defaultModel: "claude-opus-5",
    keyHint: "sk-ant-...",
    buildRequest({ key, model, imageDataUrl, feedbackLines, effort }) → { url, init }  // init is a fetch init: {method, headers, body}
    parseResponse(json) → RoundResult   // json = parsed HTTP body; throws ProviderError
  };
  ```
  Later adapters (Tasks 5, 6) use exactly the same shape.

- [ ] **Step 1: Write the failing tests for common.js**

`test/providers.common.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError, splitDataUrl, mapHttpError, parseJsonText } from "../lib/providers/common.js";

test("splitDataUrl separates media type and payload", () => {
  assert.deepEqual(splitDataUrl("data:image/png;base64,AAAA"), { mediaType: "image/png", base64: "AAAA" });
});

test("splitDataUrl rejects non data urls", () => {
  assert.throws(() => splitDataUrl("https://x/y.png"), (e) => e instanceof ProviderError && e.code === "unparseable");
});

test("mapHttpError maps status codes", () => {
  assert.equal(mapHttpError(401, "").code, "key_rejected");
  assert.equal(mapHttpError(403, "").code, "key_rejected");
  assert.equal(mapHttpError(429, "").code, "rate_limited");
  assert.equal(mapHttpError(500, "boom").code, "server");
  assert.equal(mapHttpError(400, "bad").code, "server");
  assert.equal(mapHttpError(500, "boom").raw, "boom");
});

test("parseJsonText parses plain and fenced json", () => {
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonText('```json\n{"a":1}\n```'), { a: 1 });
});

test("parseJsonText throws unparseable with raw text", () => {
  assert.throws(() => parseJsonText("not json"), (e) => e.code === "unparseable" && e.raw === "not json");
});
```

- [ ] **Step 2: Write the failing tests for anthropic.js**

`test/providers.anthropic.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropic } from "../lib/providers/anthropic.js";
import { RESULT_SCHEMA } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("buildRequest targets the messages endpoint with browser header", () => {
  const { url, init } = anthropic.buildRequest({ key: "k", model: "claude-opus-5", imageDataUrl: img, feedbackLines: [], effort: "high" });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-api-key"], "k");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("buildRequest body has image, text, schema and effort", () => {
  const { init } = anthropic.buildRequest({ key: "k", model: "claude-opus-5", imageDataUrl: img, feedbackLines: ["x"], effort: "low" });
  const body = JSON.parse(init.body);
  assert.equal(body.model, "claude-opus-5");
  assert.equal(body.max_tokens, 16000);
  assert.equal(typeof body.system, "string");
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: RESULT_SCHEMA });
  assert.equal(body.output_config.effort, "low");
  const [image, text] = body.messages[0].content;
  assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
  assert.equal(text.type, "text");
  assert.ok(text.text.includes("- x"));
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads the text block", () => {
  const r = anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(goodResult) }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse skips thinking blocks", () => {
  const r = anthropic.parseResponse({ stop_reason: "end_turn", content: [
    { type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(goodResult) }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces refusal", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
    (e) => e.code === "refusal" && /cyber/.test(e.message));
});

test("parseResponse throws unparseable on bad json", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "oops" }] }),
    (e) => e.code === "unparseable" && e.raw === "oops");
});

test("parseResponse throws unparseable on schema failure", () => {
  assert.throws(() => anthropic.parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: '{"guess":{}}' }] }),
    (e) => e.code === "unparseable");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../lib/providers/common.js` and `../lib/providers/anthropic.js`.

- [ ] **Step 4: Write lib/providers/common.js**

```js
import { validateResult } from "../validate.js";

export class ProviderError extends Error {
  constructor(code, message, { status = null, raw = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl ?? ""));
  if (!m) throw new ProviderError("unparseable", "screenshot is not a base64 data URL");
  return { mediaType: m[1], base64: m[2] };
}

export function mapHttpError(status, bodyText) {
  const raw = bodyText ?? null;
  if (status === 401 || status === 403) return new ProviderError("key_rejected", "API key rejected", { status, raw });
  if (status === 429) return new ProviderError("rate_limited", "Rate limited, try again shortly", { status, raw });
  return new ProviderError("server", `Provider returned HTTP ${status}`, { status, raw });
}

export function parseJsonText(text) {
  let t = String(text ?? "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {
    throw new ProviderError("unparseable", "Model did not return valid JSON", { raw: text });
  }
}

/** Parse model text into a validated RoundResult, wrapping validation errors. */
export function textToResult(text) {
  const obj = parseJsonText(text);
  try {
    return validateResult(obj);
  } catch (e) {
    throw new ProviderError("unparseable", e.message, { raw: text });
  }
}
```

- [ ] **Step 5: Write lib/providers/anthropic.js**

```js
import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "../prompt.js";
import { ProviderError, splitDataUrl, textToResult } from "./common.js";

export const anthropic = {
  id: "anthropic",
  label: "Claude (Anthropic)",
  defaultModel: "claude-opus-5",
  keyHint: "sk-ant-...",

  buildRequest({ key, model, imageDataUrl, feedbackLines, effort }) {
    const { mediaType, base64 } = splitDataUrl(imageDataUrl);
    const body = {
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: effort || "high",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: buildUserText(feedbackLines) },
        ],
      }],
    };
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    if (json.stop_reason === "refusal") {
      const cat = json.stop_details && json.stop_details.category;
      throw new ProviderError("refusal", `Claude declined this request${cat ? ` (${cat})` : ""}`);
    }
    const block = (json.content || []).find((b) => b.type === "text");
    if (!block) throw new ProviderError("unparseable", "No text in response", { raw: JSON.stringify(json) });
    return textToResult(block.text);
  },
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 7: Commit and push**

```bash
git add lib/providers/common.js lib/providers/anthropic.js test/providers.common.test.js test/providers.anthropic.test.js
git commit -m "Add provider plumbing and Anthropic adapter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: OpenAI adapter

**Files:**
- Create: `lib/providers/openai.js`
- Test: `test/providers.openai.test.js`

**Interfaces:**
- Consumes: `SYSTEM_PROMPT`, `RESULT_SCHEMA`, `buildUserText`; `ProviderError`, `textToResult` from `common.js`.
- Produces: `export const openai` with the adapter shape from Task 4 (`id: "openai"`, `label: "GPT (OpenAI)"`, `defaultModel: "gpt-5"`, `keyHint: "sk-..."`).

- [ ] **Step 1: Write the failing test**

`test/providers.openai.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../lib/providers/openai.js";
import { RESULT_SCHEMA } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("buildRequest targets chat completions with bearer key", () => {
  const { url, init } = openai.buildRequest({ key: "k", model: "gpt-5", imageDataUrl: img, feedbackLines: [] });
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(init.headers.authorization, "Bearer k");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "gpt-5");
  assert.equal(body.messages[0].role, "system");
  const user = body.messages[1];
  assert.equal(user.role, "user");
  assert.deepEqual(user.content[0], { type: "image_url", image_url: { url: img } });
  assert.equal(user.content[1].type, "text");
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: { name: "round_result", strict: true, schema: RESULT_SCHEMA },
  });
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads choices[0].message.content", () => {
  const r = openai.parseResponse({ choices: [{ message: { content: JSON.stringify(goodResult) } }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces refusal field", () => {
  assert.throws(() => openai.parseResponse({ choices: [{ message: { refusal: "no", content: null } }] }),
    (e) => e.code === "refusal");
});

test("parseResponse throws unparseable when no choices", () => {
  assert.throws(() => openai.parseResponse({ choices: [] }), (e) => e.code === "unparseable");
});

test("parseResponse throws unparseable on bad json", () => {
  assert.throws(() => openai.parseResponse({ choices: [{ message: { content: "nah" } }] }),
    (e) => e.code === "unparseable" && e.raw === "nah");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find `../lib/providers/openai.js`.

- [ ] **Step 3: Write lib/providers/openai.js**

```js
import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "../prompt.js";
import { ProviderError, textToResult } from "./common.js";

export const openai = {
  id: "openai",
  label: "GPT (OpenAI)",
  defaultModel: "gpt-5",
  keyHint: "sk-...",

  buildRequest({ key, model, imageDataUrl, feedbackLines }) {
    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: buildUserText(feedbackLines) },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "round_result", strict: true, schema: RESULT_SCHEMA },
      },
    };
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    const choice = json.choices && json.choices[0];
    if (!choice || !choice.message) {
      throw new ProviderError("unparseable", "No choices in response", { raw: JSON.stringify(json) });
    }
    if (choice.message.refusal) {
      throw new ProviderError("refusal", `Model declined: ${choice.message.refusal}`);
    }
    return textToResult(choice.message.content);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit and push**

```bash
git add lib/providers/openai.js test/providers.openai.test.js
git commit -m "Add OpenAI adapter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Gemini adapter and provider registry

**Files:**
- Create: `lib/providers/gemini.js`
- Create: `lib/providers/index.js`
- Test: `test/providers.gemini.test.js`
- Test: `test/providers.index.test.js`

**Interfaces:**
- Consumes: adapters from Tasks 4 and 5; `ProviderError`, `mapHttpError`, `splitDataUrl`, `textToResult` from `common.js`.
- Produces (gemini):
  - `export function toGeminiSchema(schema)` — deep-converts a JSON Schema: `type: ["string","null"]` → `{type: "string", nullable: true}`; removes `additionalProperties`; keeps `enum`, `required`, `properties`, `items`.
  - `export const gemini` adapter (`id: "gemini"`, `label: "Gemini (Google)"`, `defaultModel: "gemini-2.5-flash"`, `keyHint: "AIza..."`).
- Produces (index):
  - `export const PROVIDERS` — `{anthropic, openai, gemini}` keyed by id.
  - `export const PROVIDER_ORDER` — `["anthropic", "openai", "gemini"]` (display order; Claude is the default provider).
  - `export async function callProvider(adapter, opts, fetchImpl = fetch)` — `opts` is the `buildRequest` argument. Throws `ProviderError("no_key")` if `opts.key` is empty. Performs the fetch, maps non-2xx via `mapHttpError`, network failures to `ProviderError("network")`, then returns `adapter.parseResponse(await res.json())`. If the body is not JSON, throws `unparseable` with raw text.

- [ ] **Step 1: Write the failing test for gemini.js**

`test/providers.gemini.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gemini, toGeminiSchema } from "../lib/providers/gemini.js";
import { RESULT_SCHEMA, CATEGORIES } from "../lib/prompt.js";

const img = "data:image/png;base64,QUJD";

test("toGeminiSchema converts nullable unions and strips additionalProperties", () => {
  const s = toGeminiSchema(RESULT_SCHEMA);
  assert.equal(s.additionalProperties, undefined);
  assert.deepEqual(s.properties.guess.properties.region, { type: "string", nullable: true });
  assert.deepEqual(s.properties.guess.properties.lat, { type: "number", nullable: true });
  assert.deepEqual(s.properties.clues.items.properties.category.enum, CATEGORIES);
  assert.equal(s.properties.clues.items.additionalProperties, undefined);
  assert.deepEqual(s.required, RESULT_SCHEMA.required);
});

test("toGeminiSchema does not mutate its input", () => {
  toGeminiSchema(RESULT_SCHEMA);
  assert.equal(RESULT_SCHEMA.additionalProperties, false);
});

test("buildRequest targets generateContent with key in query", () => {
  const { url, init } = gemini.buildRequest({ key: "k", model: "gemini-2.5-flash", imageDataUrl: img, feedbackLines: [] });
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=k");
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text.length > 0, true);
  assert.deepEqual(body.contents[0].parts[0], { inline_data: { mime_type: "image/png", data: "QUJD" } });
  assert.equal(typeof body.contents[0].parts[1].text, "string");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, toGeminiSchema(RESULT_SCHEMA));
});

const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("parseResponse reads first candidate text", () => {
  const r = gemini.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodResult) }] } }] });
  assert.equal(r.guess.country, "Chile");
});

test("parseResponse surfaces safety block as refusal", () => {
  assert.throws(() => gemini.parseResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
    (e) => e.code === "refusal");
});

test("parseResponse throws unparseable when no candidates", () => {
  assert.throws(() => gemini.parseResponse({ candidates: [] }), (e) => e.code === "unparseable");
});
```

- [ ] **Step 2: Write the failing test for index.js**

`test/providers.index.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, PROVIDER_ORDER, callProvider } from "../lib/providers/index.js";

const img = "data:image/png;base64,QUJD";
const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

test("registry has all three providers in display order", () => {
  assert.deepEqual(PROVIDER_ORDER, ["anthropic", "openai", "gemini"]);
  for (const id of PROVIDER_ORDER) assert.equal(PROVIDERS[id].id, id);
});

test("callProvider throws no_key without a key", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, {})),
    (e) => e.code === "no_key");
});

test("callProvider returns a parsed result on 200", async () => {
  const body = { choices: [{ message: { content: JSON.stringify(goodResult) } }] };
  const r = await callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, body));
  assert.equal(r.guess.country, "Chile");
});

test("callProvider maps 429 to rate_limited", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(429, "slow down")),
    (e) => e.code === "rate_limited" && e.raw === "slow down");
});

test("callProvider maps thrown fetch to network", async () => {
  const boom = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, boom),
    (e) => e.code === "network");
});

test("callProvider maps non-JSON 200 body to unparseable", async () => {
  await assert.rejects(
    callProvider(PROVIDERS.openai, { key: "k", model: "m", imageDataUrl: img, feedbackLines: [] }, fakeFetch(200, "<html>")),
    (e) => e.code === "unparseable" && e.raw === "<html>");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../lib/providers/gemini.js` and `../lib/providers/index.js`.

- [ ] **Step 4: Write lib/providers/gemini.js**

```js
import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "../prompt.js";
import { ProviderError, splitDataUrl, textToResult } from "./common.js";

export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties") continue;
    if (k === "type" && Array.isArray(v)) {
      const nonNull = v.filter((t) => t !== "null");
      out.type = nonNull[0];
      if (nonNull.length !== v.length) out.nullable = true;
      continue;
    }
    if (k === "properties") {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      continue;
    }
    if (k === "items") { out.items = toGeminiSchema(v); continue; }
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

const GEMINI_SCHEMA = toGeminiSchema(RESULT_SCHEMA);

export const gemini = {
  id: "gemini",
  label: "Gemini (Google)",
  defaultModel: "gemini-2.5-flash",
  keyHint: "AIza...",

  buildRequest({ key, model, imageDataUrl, feedbackLines }) {
    const { mediaType, base64 } = splitDataUrl(imageDataUrl);
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: buildUserText(feedbackLines) },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    };
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    const block = json.promptFeedback && json.promptFeedback.blockReason;
    if (block) throw new ProviderError("refusal", `Gemini blocked the request (${block})`);
    const cand = json.candidates && json.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || "").join("");
    if (!text) throw new ProviderError("unparseable", "No candidate text in response", { raw: JSON.stringify(json) });
    return textToResult(text);
  },
};
```

- [ ] **Step 5: Write lib/providers/index.js**

```js
import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { gemini } from "./gemini.js";
import { ProviderError, mapHttpError } from "./common.js";

export const PROVIDERS = { anthropic, openai, gemini };
export const PROVIDER_ORDER = ["anthropic", "openai", "gemini"];

export async function callProvider(adapter, opts, fetchImpl = fetch) {
  if (!opts.key || !String(opts.key).trim()) {
    throw new ProviderError("no_key", `No API key set for ${adapter.label}`);
  }
  const { url, init } = adapter.buildRequest(opts);
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new ProviderError("network", `Could not reach ${adapter.label}: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError("unparseable", "Provider returned a non-JSON body", { raw: text });
  }
  return adapter.parseResponse(json);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 7: Commit and push**

```bash
git add lib/providers/gemini.js lib/providers/index.js test/providers.gemini.test.js test/providers.index.test.js
git commit -m "Add Gemini adapter and provider registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: Notebook pure logic (stats, feedback lines, import/export)

**Files:**
- Create: `lib/notebook-logic.js`
- Test: `test/notebook-logic.test.js`

**Interfaces:**
- Consumes: `scoreRound` from `lib/score.js`.
- Defines the **Round record** shape stored in IndexedDB and used by every later task:
  ```js
  {
    id: string,            // crypto.randomUUID()
    ts: number,            // Date.now()
    imageDataUrl: string,  // the screenshot
    results: [             // one per provider asked
      { provider: "gemini", model: "gemini-2.5-flash", result: RoundResult|null, error: {code, message, raw}|null }
    ],
    actual: null | { country: string, region: string|null, lat: number|null, lng: number|null },
    scores: null | { [provider]: { hit: boolean, verdicts: [{id, verdict}] } }
  }
  ```
- Produces:
  - `export function newRound(imageDataUrl, results)` → Round with `actual: null, scores: null`.
  - `export function applyActual(round, actual)` → new Round with `actual` set and `scores` computed for every result that has a `result`.
  - `export function feedbackLines(rounds, limit = 12)` → `string[]` from the newest rounds that have `actual` and at least one miss, one line per missed provider result: `"Guessed Chile (top clue: yellow centre line); actual Peru"`. Newest first, capped at `limit`.
  - `export function stats(rounds)` → `{ total: number, byCategory: { [cat]: {supporting, misleading, rate} }, byProvider: { [provider]: {hits, rounds, rate} } }`. Only rounds with `actual` count.
  - `export function serialiseRounds(rounds)` → JSON string `{version: 1, exported: iso, rounds}`.
  - `export function parseImport(text)` → `Round[]`; throws `Error("import: ...")` if not the expected shape. Accepts both the wrapped `{version, rounds}` form and a bare array.

- [ ] **Step 1: Write the failing test**

`test/notebook-logic.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { newRound, applyActual, feedbackLines, stats, serialiseRounds, parseImport } from "../lib/notebook-logic.js";

const res = (country, clueText = "yellow centre line") => ({
  guess: { country, region: null, lat: null, lng: null }, confidence: 0.5, alternatives: [], summary: "",
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
  assert.deepEqual(s.byProvider.gemini, { hits: 1, rounds: 2, rate: 0.5 });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find `../lib/notebook-logic.js`.

- [ ] **Step 3: Write lib/notebook-logic.js**

```js
import { scoreRound } from "./score.js";

export function newRound(imageDataUrl, results) {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    imageDataUrl,
    results,
    actual: null,
    scores: null,
  };
}

export function applyActual(round, actual) {
  const scores = {};
  for (const r of round.results) {
    if (r.result) scores[r.provider] = scoreRound(r.result, actual);
  }
  return { ...round, actual, scores };
}

function topClue(result) {
  return result.clues.reduce((best, c) => (c.weight > best.weight ? c : best), result.clues[0]);
}

export function feedbackLines(rounds, limit = 12) {
  const lines = [];
  const sorted = [...rounds].filter((r) => r.actual && r.scores).sort((a, b) => b.ts - a.ts);
  for (const round of sorted) {
    for (const r of round.results) {
      const s = r.result && round.scores[r.provider];
      if (!s || s.hit) continue;
      lines.push(`Guessed ${r.result.guess.country} (top clue: ${topClue(r.result).observation}); actual ${round.actual.country}`);
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}

export function stats(rounds) {
  const byCategory = {};
  const byProvider = {};
  let total = 0;
  for (const round of rounds) {
    if (!round.actual || !round.scores) continue;
    total++;
    for (const r of round.results) {
      const s = r.result && round.scores[r.provider];
      if (!s) continue;
      const p = (byProvider[r.provider] ||= { hits: 0, rounds: 0, rate: 0 });
      p.rounds++;
      if (s.hit) p.hits++;
      for (const v of s.verdicts) {
        const clue = r.result.clues.find((c) => c.id === v.id);
        if (!clue) continue;
        const c = (byCategory[clue.category] ||= { supporting: 0, misleading: 0, rate: 0 });
        c[v.verdict]++;
      }
    }
  }
  for (const p of Object.values(byProvider)) p.rate = p.rounds ? p.hits / p.rounds : 0;
  for (const c of Object.values(byCategory)) {
    const n = c.supporting + c.misleading;
    c.rate = n ? c.supporting / n : 0;
  }
  return { total, byCategory, byProvider };
}

export function serialiseRounds(rounds) {
  return JSON.stringify({ version: 1, exported: new Date().toISOString(), rounds }, null, 2);
}

function isRound(r) {
  return r && typeof r === "object" && typeof r.id === "string" && typeof r.ts === "number"
    && typeof r.imageDataUrl === "string" && Array.isArray(r.results);
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("import: file is not valid JSON");
  }
  const rounds = Array.isArray(data) ? data : data && Array.isArray(data.rounds) ? data.rounds : null;
  if (!rounds) throw new Error("import: expected an array of rounds or {rounds: [...]}");
  if (!rounds.every(isRound)) throw new Error("import: one or more entries is not a round record");
  return rounds;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit and push**

```bash
git add lib/notebook-logic.js test/notebook-logic.test.js
git commit -m "Add notebook stats, feedback lines and import/export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 8: IndexedDB notebook store and settings store

**Files:**
- Create: `lib/notebook-db.js`
- Create: `lib/settings.js`

No Node unit tests here (IndexedDB and `chrome.storage` are browser-only; per the spec, UI-side storage is checked by hand). Both modules are thin wrappers with no logic beyond what Task 7 already tests.

**Interfaces:**
- Produces (notebook-db):
  - `export async function putRound(round)`
  - `export async function getRound(id)` → Round|undefined
  - `export async function allRounds()` → Round[] sorted newest first
  - `export async function deleteRound(id)`
  - `export async function clearRounds()`
  - `export async function importRounds(rounds)` — puts each (overwrites same id)
- Produces (settings):
  - `export const DEFAULT_SETTINGS`
  - `export async function loadSettings()` → settings merged over defaults
  - `export async function saveSettings(settings)`
  - Settings shape:
    ```js
    {
      active: "openai",
      askAll: false,
      effort: "high",           // Anthropic only: low|medium|high|xhigh|max
      providers: {
        gemini:    { key: "", model: "gemini-2.5-flash", enabled: false },
        anthropic: { key: "", model: "claude-opus-5", enabled: false },
        openai:    { key: "", model: "gpt-5", enabled: true },
      },
    }
    ```

- [ ] **Step 1: Write lib/notebook-db.js**

```js
const DB_NAME = "geo-meta-trainer";
const STORE = "rounds";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    fn(store, (v) => { out = v; });
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

export function putRound(round) {
  return tx("readwrite", (s) => s.put(round));
}

export function getRound(id) {
  return tx("readonly", (s, set) => { const r = s.get(id); r.onsuccess = () => set(r.result); });
}

export function allRounds() {
  return tx("readonly", (s, set) => {
    const r = s.getAll();
    r.onsuccess = () => set([...r.result].sort((a, b) => b.ts - a.ts));
  });
}

export function deleteRound(id) {
  return tx("readwrite", (s) => s.delete(id));
}

export function clearRounds() {
  return tx("readwrite", (s) => s.clear());
}

export function importRounds(rounds) {
  return tx("readwrite", (s) => { for (const r of rounds) s.put(r); });
}
```

- [ ] **Step 2: Write lib/settings.js**

```js
import { PROVIDERS, PROVIDER_ORDER } from "./providers/index.js";

export const DEFAULT_SETTINGS = {
  active: "openai",
  askAll: false,
  effort: "high",
  providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
    key: "",
    model: PROVIDERS[id].defaultModel,
    enabled: id === "openai",
  }])),
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
      ...DEFAULT_SETTINGS.providers[id],
      ...(s.providers && s.providers[id]),
    }])),
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
```

- [ ] **Step 3: Run the existing tests to make sure nothing imports a browser API at module load**

Run: `npm test`
Expected: all passing (these two files are not imported by tests).

- [ ] **Step 4: Commit and push**

```bash
git add lib/notebook-db.js lib/settings.js
git commit -m "Add IndexedDB notebook store and settings store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: Manifest and service worker (capture + analyse)

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `icons/icon128.png` (any 128x128 PNG; generate a plain coloured square with the command below)
- Create: `lib/analyse.js`
- Create: `lib/image.js`
- Test: `test/analyse.test.js`
- Test: `test/image.test.js`

**Interfaces:**
- Produces (`lib/image.js`):
  - `export const MAX_EDGE = 1600`
  - `export function fitWithin(width, height, maxEdge = MAX_EDGE)` → `{width, height, scale}` integers, preserving aspect ratio; returns the input unchanged with `scale: 1` when already within the limit. Pure, tested.
  - `export async function downscaleDataUrl(dataUrl, maxEdge = MAX_EDGE)` → JPEG data URL (quality 0.85). Browser-only: uses `fetch(dataUrl).then(r => r.blob())`, `createImageBitmap`, `OffscreenCanvas`, `convertToBlob`, `FileReader`. Not unit-tested; exercised by the hand check.
- Consumes: `PROVIDERS`, `callProvider` (Task 6); `feedbackLines`, `newRound` (Task 7); `allRounds`, `putRound` (Task 8 — background does not touch IndexedDB directly; the panel saves rounds. Background only reads feedback lines from rounds passed in by the panel, see below); `loadSettings` (Task 8).
- Produces (`lib/analyse.js`, pure so it is testable):
  - `export function providersToAsk(settings)` → `string[]` of provider ids: if `askAll`, every provider with `enabled` and a non-empty key; otherwise `[settings.active]`.
  - `export async function analyseImage(imageDataUrl, settings, feedback, callImpl = callProvider)` → `Round` (from `newRound`) whose `results` contain one entry per provider asked, each either `{result, error: null}` or `{result: null, error: {code, message, raw}}`. Never throws; per-provider failures are captured.
- Produces (background messaging):
  - Panel → background: `{type: "capture", feedback: string[]}` → replies `{ok: true, round}` or `{ok: false, error: {code, message}}`.
  - Command `capture` (Alt+G): background captures, analyses with `feedback` read from `chrome.storage.session.lastFeedback` (the panel writes this whenever the notebook changes), stores the round in `chrome.storage.session.lastRound`, opens the side panel, and broadcasts `{type: "round", round}`.
  - Panel on load reads `chrome.storage.session.lastRound`.

- [ ] **Step 1: Write the failing test for analyse.js**

`test/analyse.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { providersToAsk, analyseImage } from "../lib/analyse.js";
import { ProviderError } from "../lib/providers/common.js";

const settings = {
  active: "anthropic", askAll: false, effort: "high",
  providers: {
    gemini: { key: "g", model: "gm", enabled: true },
    anthropic: { key: "a", model: "am", enabled: true },
    openai: { key: "", model: "om", enabled: true },
  },
};
const goodResult = {
  guess: { country: "Chile", region: null, lat: null, lng: null }, confidence: 0.6, alternatives: [],
  clues: [{ id: 1, category: "other", observation: "o", inference: "i", weight: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  summary: "s",
};

test("providersToAsk returns active only when askAll is off", () => {
  assert.deepEqual(providersToAsk(settings), ["anthropic"]);
});

test("providersToAsk returns enabled providers with keys when askAll is on", () => {
  assert.deepEqual(providersToAsk({ ...settings, askAll: true }), ["gemini", "anthropic"]);
});

test("analyseImage collects one result per provider and captures errors", async () => {
  const calls = [];
  const fake = async (adapter, opts) => {
    calls.push([adapter.id, opts.model, opts.effort, opts.feedbackLines]);
    if (adapter.id === "anthropic") throw new ProviderError("rate_limited", "slow", { raw: "r" });
    return goodResult;
  };
  const round = await analyseImage("data:image/png;base64,AA", { ...settings, askAll: true }, ["fb"], fake);
  assert.equal(round.results.length, 2);
  assert.equal(round.results[0].provider, "gemini");
  assert.equal(round.results[0].result.guess.country, "Chile");
  assert.equal(round.results[1].provider, "anthropic");
  assert.deepEqual(round.results[1].error, { code: "rate_limited", message: "slow", raw: "r" });
  assert.deepEqual(calls[0], ["gemini", "gm", "high", ["fb"]]);
  assert.equal(round.imageDataUrl, "data:image/png;base64,AA");
});

test("analyseImage wraps unexpected errors as code unknown", async () => {
  const fake = async () => { throw new Error("weird"); };
  const round = await analyseImage("d", settings, [], fake);
  assert.deepEqual(round.results[0].error, { code: "unknown", message: "weird", raw: null });
});
```

- [ ] **Step 1b: Write the failing test for image.js**

`test/image.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin, MAX_EDGE } from "../lib/image.js";

test("MAX_EDGE is 1600", () => {
  assert.equal(MAX_EDGE, 1600);
});

test("image within the limit is unchanged", () => {
  assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800, scale: 1 });
});

test("4K landscape capture is scaled to 1600 wide", () => {
  assert.deepEqual(fitWithin(3840, 2160), { width: 1600, height: 900, scale: 1600 / 3840 });
});

test("portrait capture is scaled on its long edge", () => {
  const r = fitWithin(1000, 3200);
  assert.equal(r.height, 1600);
  assert.equal(r.width, 500);
});

test("custom max edge is honoured and dimensions are integers", () => {
  const r = fitWithin(2560, 1440, 1000);
  assert.equal(r.width, 1000);
  assert.equal(r.height, 563);
  assert.ok(Number.isInteger(r.height));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../lib/analyse.js` and `../lib/image.js`.

- [ ] **Step 2b: Write lib/image.js**

```js
export const MAX_EDGE = 1600;

export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height, scale: 1 };
  const scale = maxEdge / long;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

/** Browser only. Shrinks a PNG/JPEG data URL to maxEdge on its long side and re-encodes as JPEG. */
export async function downscaleDataUrl(dataUrl, maxEdge = MAX_EDGE) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(out);
  });
}
```

- [ ] **Step 3: Write lib/analyse.js**

```js
import { PROVIDERS, callProvider } from "./providers/index.js";
import { newRound } from "./notebook-logic.js";

export function providersToAsk(settings) {
  if (!settings.askAll) return [settings.active];
  return Object.entries(settings.providers)
    .filter(([, p]) => p.enabled && p.key && p.key.trim())
    .map(([id]) => id);
}

export async function analyseImage(imageDataUrl, settings, feedback, callImpl = callProvider) {
  const ids = providersToAsk(settings);
  const results = await Promise.all(ids.map(async (id) => {
    const adapter = PROVIDERS[id];
    const p = settings.providers[id];
    try {
      const result = await callImpl(adapter, {
        key: p.key, model: p.model, imageDataUrl, feedbackLines: feedback, effort: settings.effort,
      });
      return { provider: id, model: p.model, result, error: null };
    } catch (e) {
      return {
        provider: id, model: p.model, result: null,
        error: { code: e.code || "unknown", message: e.message, raw: e.raw ?? null },
      };
    }
  }));
  return newRound(imageDataUrl, results);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Geo Meta Trainer",
  "version": "0.1.0",
  "description": "Screenshot a GeoGuessr round, get a vision-model guess with boxed clues and weights, and build a personal meta notebook.",
  "permissions": ["activeTab", "sidePanel", "storage", "tabs"],
  "host_permissions": [
    "https://www.geoguessr.com/*",
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Geo Meta Trainer" },
  "icons": { "128": "icons/icon128.png" },
  "commands": {
    "capture": {
      "suggested_key": { "default": "Alt+G" },
      "description": "Capture the current round and analyse it"
    }
  }
}
```

- [ ] **Step 6: Generate the icon**

Run (PowerShell):

```powershell
New-Item -ItemType Directory -Force icons | Out-Null
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 128,128
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 30, 120, 90))
$g.Dispose()
$bmp.Save("icons/icon128.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
```

- [ ] **Step 7: Write background.js**

```js
import { loadSettings } from "./lib/settings.js";
import { analyseImage } from "./lib/analyse.js";
import { downscaleDataUrl } from "./lib/image.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function captureAndAnalyse(feedback) {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return { ok: false, error: { code: "capture", message: "Open a normal web page (the GeoGuessr round) in the active tab first." } };
  }
  let imageDataUrl;
  try {
    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    imageDataUrl = await downscaleDataUrl(raw);
  } catch (e) {
    return { ok: false, error: { code: "capture", message: `Could not capture the tab: ${e.message}` } };
  }
  const settings = await loadSettings();
  const round = await analyseImage(imageDataUrl, settings, feedback || []);
  await chrome.storage.session.set({ lastRound: round });
  return { ok: true, round };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "capture") {
    captureAndAnalyse(msg.feedback).then(sendResponse);
    return true; // async reply
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture") return;
  const tab = await activeTab();
  if (tab) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  const { lastFeedback } = await chrome.storage.session.get("lastFeedback");
  await chrome.storage.session.set({ lastRound: { pending: true } });
  chrome.runtime.sendMessage({ type: "pending" }).catch(() => {});
  const reply = await captureAndAnalyse(lastFeedback || []);
  chrome.runtime.sendMessage({ type: "round", reply }).catch(() => {});
});
```

- [ ] **Step 8: Create a placeholder sidepanel.html so the extension loads**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Geo Meta Trainer</title></head>
<body><p>Loading…</p></body></html>
```

- [ ] **Step 9: Load unpacked and check by hand**

1. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", pick the project folder.
2. Confirm no errors appear on the extension card. Click "service worker" to open its console.
3. Open any https page, press Alt+G. Expected: the side panel opens showing "Loading…", and the service worker console shows no uncaught errors. (The analysis will fail with `no_key`, which is fine for now; check `chrome.storage.session` via the console: `chrome.storage.session.get("lastRound").then(console.log)` shows a round whose result entry has `error.code === "no_key"`.)
3b. In the same console, confirm the downscale happened: `chrome.storage.session.get("lastRound").then(r => { const i = new Image(); i.onload = () => console.log(i.width, i.height); i.src = r.lastRound.imageDataUrl; })`. Expected: the long edge is at most 1600 and the data URL starts with `data:image/jpeg`.
4. If Alt+G does nothing, check `chrome://extensions/shortcuts` for a conflict and rebind.

- [ ] **Step 10: Commit and push**

```bash
git add manifest.json background.js icons/icon128.png lib/analyse.js lib/image.js test/analyse.test.js test/image.test.js sidepanel.html
git commit -m "Add manifest, service worker capture/analyse, image downscale and analyse module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: Side panel shell and Settings view

**Files:**
- Create: `sidepanel.html` (replace placeholder)
- Create: `sidepanel.css`
- Create: `sidepanel.js`
- Create: `ui/settings.js`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings`, `DEFAULT_SETTINGS` (Task 8); `PROVIDERS`, `PROVIDER_ORDER` (Task 6); `allRounds`, `clearRounds`, `importRounds` (Task 8); `serialiseRounds`, `parseImport`, `feedbackLines` (Task 7).
- Produces:
  - `sidepanel.js` exports nothing; it owns tab switching between `#view-round`, `#view-notebook`, `#view-settings` and calls `renderSettings(root)`, `renderRound(root, ...)`, `renderNotebook(root, ...)` from the `ui/` modules. It also defines and exports (for the other ui modules) `export async function refreshFeedback()` which computes `feedbackLines(await allRounds())` and writes it to `chrome.storage.session.lastFeedback`.
  - `ui/settings.js`: `export async function renderSettings(root)`.

- [ ] **Step 1: Write sidepanel.html**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Geo Meta Trainer</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <nav class="tabs">
    <button data-view="round" class="active">Round</button>
    <button data-view="notebook">Notebook</button>
    <button data-view="settings">Settings</button>
    <button id="open-tab" class="icon" title="Open in a full tab (better on a big monitor)">⤢</button>
  </nav>
  <main>
    <section id="view-round" class="view active"></section>
    <section id="view-notebook" class="view"></section>
    <section id="view-settings" class="view"></section>
  </main>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write sidepanel.css**

```css
:root {
  --bg: #14161a; --panel: #1e2126; --text: #e8e9eb; --muted: #9aa0a8; --accent: #4fc3a1;
  --c-road_markings: #f5c542; --c-signage_script: #4fa3f7; --c-driving_side: #f77f4f;
  --c-vegetation_landscape: #6fcf6f; --c-architecture: #c58cf5; --c-vehicles_plates: #f56fa1;
  --c-bollards_poles: #5fe0e0; --c-camera_car_meta: #ffffff; --c-soil_climate: #c9a06a; --c-other: #9aa0a8;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--text); }
.tabs { display: flex; border-bottom: 1px solid #2a2e35; }
.tabs button { flex: 1; padding: 10px; background: none; border: 0; color: var(--muted); cursor: pointer; }
.tabs button.active { color: var(--text); border-bottom: 2px solid var(--accent); }
.tabs button.icon { flex: 0 0 40px; font-size: 16px; }
.view { display: none; padding: 12px; }
.view.active { display: block; }
button.primary { background: var(--accent); color: #062; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
button.secondary { background: var(--panel); color: var(--text); border: 1px solid #2a2e35; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
input, select { background: var(--panel); color: var(--text); border: 1px solid #2a2e35; border-radius: 4px; padding: 6px; width: 100%; }
label { display: block; margin: 8px 0 4px; color: var(--muted); font-size: 12px; }
.card { background: var(--panel); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.muted { color: var(--muted); }
.error { background: #3a1e1e; color: #ffb4b4; padding: 10px; border-radius: 6px; }
.row { display: flex; gap: 8px; align-items: center; }

/* round view */
.shot { position: relative; width: 100%; }
.shot img { display: block; width: 100%; border-radius: 6px; }
.box { position: absolute; border: 2px solid var(--box-color); border-radius: 3px; box-shadow: 0 0 0 1px #0008; }
.box.active { box-shadow: 0 0 0 3px var(--box-color), 0 0 12px var(--box-color); }
.box .tag { position: absolute; top: -18px; left: -2px; background: var(--box-color); color: #000; font-size: 11px; font-weight: 700; padding: 0 5px; border-radius: 3px; }
.clue { display: grid; grid-template-columns: 22px 1fr 48px; gap: 8px; align-items: start; padding: 6px; border-radius: 6px; cursor: pointer; }
.clue.active, .clue:hover { background: #262a31; }
.clue .num { width: 20px; height: 20px; border-radius: 50%; background: var(--box-color); color: #000; font-weight: 700; text-align: center; font-size: 12px; }
.clue .bar { height: 6px; background: var(--box-color); border-radius: 3px; margin-top: 4px; }
.clue .pct { text-align: right; color: var(--muted); font-size: 12px; }
.clue .cat { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.verdict-supporting { color: var(--accent); }
.verdict-misleading { color: #ff8a8a; }
.columns { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }

/* notebook */
.round-row { display: grid; grid-template-columns: 64px 1fr auto; gap: 8px; align-items: center; padding: 8px; border-radius: 6px; cursor: pointer; }
.round-row:hover { background: #262a31; }
.round-row img { width: 64px; height: 40px; object-fit: cover; border-radius: 4px; }
.hit { color: var(--accent); font-weight: 600; }
.miss { color: #ff8a8a; font-weight: 600; }
table.stats { width: 100%; border-collapse: collapse; }
table.stats td, table.stats th { padding: 4px 6px; text-align: left; border-bottom: 1px solid #2a2e35; }
```

- [ ] **Step 3: Write ui/settings.js**

```js
import { loadSettings, saveSettings } from "../lib/settings.js";
import { PROVIDERS, PROVIDER_ORDER } from "../lib/providers/index.js";
import { allRounds, clearRounds, importRounds } from "../lib/notebook-db.js";
import { serialiseRounds, parseImport } from "../lib/notebook-logic.js";
import { refreshFeedback } from "../sidepanel.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export async function renderSettings(root) {
  const s = await loadSettings();
  root.innerHTML = "";

  const general = card("General");
  general.append(
    field("Active provider", select("active", PROVIDER_ORDER.map((id) => [id, PROVIDERS[id].label]), s.active)),
    checkbox("askAll", "Ask every enabled provider with a key (side by side)", s.askAll),
    field("Claude effort", select("effort", EFFORTS.map((e) => [e, e]), s.effort)),
  );
  root.append(general);

  for (const id of PROVIDER_ORDER) {
    const p = s.providers[id];
    const c = card(PROVIDERS[id].label);
    c.append(
      checkbox(`enabled-${id}`, "Enabled", p.enabled),
      field("API key", input(`key-${id}`, p.key, PROVIDERS[id].keyHint, "password")),
      field("Model", input(`model-${id}`, p.model, PROVIDERS[id].defaultModel)),
    );
    root.append(c);
  }

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save settings";
  save.onclick = async () => {
    const next = {
      active: root.querySelector("#active").value,
      askAll: root.querySelector("#askAll").checked,
      effort: root.querySelector("#effort").value,
      providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
        enabled: root.querySelector(`#enabled-${id}`).checked,
        key: root.querySelector(`#key-${id}`).value.trim(),
        model: root.querySelector(`#model-${id}`).value.trim() || PROVIDERS[id].defaultModel,
      }])),
    };
    await saveSettings(next);
    save.textContent = "Saved";
    setTimeout(() => { save.textContent = "Save settings"; }, 1200);
  };
  root.append(save);

  const nb = card("Notebook");
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Shortcut: Alt+G captures and analyses the current tab. Change it at chrome://extensions/shortcuts.";
  const exportBtn = button("secondary", "Export JSON", async () => {
    const text = serialiseRounds(await allRounds());
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `geo-meta-notebook-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  });
  const importInput = Object.assign(document.createElement("input"), { type: "file", accept: "application/json", hidden: true });
  importInput.onchange = async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const rounds = parseImport(await file.text());
      await importRounds(rounds);
      await refreshFeedback();
      status.textContent = `Imported ${rounds.length} rounds.`;
    } catch (e) {
      status.textContent = e.message;
    }
    importInput.value = "";
  };
  const importBtn = button("secondary", "Import JSON", () => importInput.click());
  const clearBtn = button("secondary", "Clear notebook", async () => {
    if (!confirm("Delete every saved round? This cannot be undone.")) return;
    await clearRounds();
    await refreshFeedback();
    status.textContent = "Notebook cleared.";
  });
  const status = document.createElement("p");
  status.className = "muted";
  const row = document.createElement("div");
  row.className = "row";
  row.append(exportBtn, importBtn, clearBtn, importInput);
  nb.append(hint, row, status);
  root.append(nb);
}

function card(title) {
  const c = document.createElement("div");
  c.className = "card";
  const h = document.createElement("h3");
  h.textContent = title;
  h.style.margin = "0 0 8px";
  c.append(h);
  return c;
}
function field(labelText, control) {
  const wrap = document.createElement("div");
  const l = document.createElement("label");
  l.textContent = labelText;
  l.htmlFor = control.id;
  wrap.append(l, control);
  return wrap;
}
function input(id, value, placeholder = "", type = "text") {
  return Object.assign(document.createElement("input"), { id, value, placeholder, type, autocomplete: "off" });
}
function select(id, options, value) {
  const s = document.createElement("select");
  s.id = id;
  for (const [v, label] of options) s.append(new Option(label, v, false, v === value));
  return s;
}
function checkbox(id, labelText, checked) {
  const wrap = document.createElement("label");
  wrap.className = "row";
  wrap.style.color = "var(--text)";
  const cb = Object.assign(document.createElement("input"), { type: "checkbox", id, checked });
  cb.style.width = "auto";
  wrap.append(cb, document.createTextNode(labelText));
  return wrap;
}
function button(cls, text, onclick) {
  return Object.assign(document.createElement("button"), { className: cls, textContent: text, onclick });
}
```

- [ ] **Step 4: Write sidepanel.js (shell; round and notebook views are stubs until Tasks 11 and 12)**

```js
import { renderSettings } from "./ui/settings.js";
import { allRounds } from "./lib/notebook-db.js";
import { feedbackLines } from "./lib/notebook-logic.js";

const views = {
  round: document.getElementById("view-round"),
  notebook: document.getElementById("view-notebook"),
  settings: document.getElementById("view-settings"),
};

export async function refreshFeedback() {
  const lines = feedbackLines(await allRounds());
  await chrome.storage.session.set({ lastFeedback: lines });
  return lines;
}

export function showView(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.view === name);
  for (const [k, el] of Object.entries(views)) el.classList.toggle("active", k === name);
  if (name === "settings") renderSettings(views.settings);
  if (name === "notebook" && window.renderNotebookView) window.renderNotebookView(views.notebook);
}

for (const b of document.querySelectorAll(".tabs button[data-view]")) b.onclick = () => showView(b.dataset.view);
document.getElementById("open-tab").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });

views.round.innerHTML = '<p class="muted">Round view arrives in the next task.</p>';
await refreshFeedback();
showView("round");
```

- [ ] **Step 5: Check by hand**

Reload the extension at `chrome://extensions`, open the side panel via the toolbar icon. Expected:
1. Three tabs switch views.
2. Settings shows General plus three provider cards, OpenAI enabled by default with model `gpt-5`.
3. Enter an OpenAI key (from https://platform.openai.com), Save, reload the panel: the key persists (shown as dots).
4. Export downloads an empty notebook JSON `{version: 1, rounds: []}`.
5. Import that same file shows "Imported 0 rounds."

- [ ] **Step 6: Commit and push**

```bash
git add sidepanel.html sidepanel.css sidepanel.js ui/settings.js
git commit -m "Add side panel shell and settings view

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 11: Round view (overlay, weight bars, actual location)

**Files:**
- Create: `ui/round.js`
- Create: `lib/geo.js`
- Modify: `sidepanel.js` (wire round rendering and background messages)
- Test: `test/geo.test.js`

**Interfaces:**
- Consumes: Round record (Task 7), `applyActual` (Task 7), `putRound`, `getRound` (Task 8), `refreshFeedback` (Task 10), `CATEGORIES` (Task 1).
- Produces:
  - `lib/geo.js`: `export function parseActualInput(countryText, regionText, coordsText)` → `Actual` object. `coordsText` like `"-23.6, -70.4"` or empty; throws `Error("actual: country is required")` if country empty; throws `Error("actual: coordinates must be lat, lng")` on malformed coords.
  - `ui/round.js`: `export function renderRound(root, round, { onCapture, onRetry })` renders `null` (empty state), `{pending: true}`, or a Round; after the actual location is saved it calls `root._onSaved(updatedRound)` if the caller set it. `export function renderRoundError(root, error, { onRetry })` renders a failed reply.
  - Panel → background retry: the panel keeps the last screenshot in memory and calls `analyseImage` itself? No — retry re-sends `{type: "capture"}` only if there is no held screenshot; otherwise the panel sends `{type: "analyse", imageDataUrl, feedback}` and background replies the same shape as capture. Add that message handler to `background.js` (see Step 6).

- [ ] **Step 1: Write the failing test for geo.js**

`test/geo.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseActualInput } from "../lib/geo.js";

test("country only", () => {
  assert.deepEqual(parseActualInput(" Chile ", "", ""), { country: "Chile", region: null, lat: null, lng: null });
});

test("country, region and coordinates", () => {
  assert.deepEqual(parseActualInput("Chile", "Atacama", "-23.6, -70.4"),
    { country: "Chile", region: "Atacama", lat: -23.6, lng: -70.4 });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find `../lib/geo.js`.

- [ ] **Step 3: Write lib/geo.js**

```js
export function parseActualInput(countryText, regionText, coordsText) {
  const country = String(countryText ?? "").trim();
  if (!country) throw new Error("actual: country is required");
  const region = String(regionText ?? "").trim() || null;
  let lat = null, lng = null;
  const coords = String(coordsText ?? "").trim();
  if (coords) {
    const m = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/.exec(coords);
    if (!m) throw new Error("actual: coordinates must be lat, lng");
    lat = Number(m[1]); lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("actual: coordinates out of range");
  }
  return { country, region, lat, lng };
}
```

Note the second malformed-coords assertion expects `/actual: coordinates/`, which the out-of-range message also matches.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Write ui/round.js**

```js
import { applyActual } from "../lib/notebook-logic.js";
import { putRound } from "../lib/notebook-db.js";
import { parseActualInput } from "../lib/geo.js";
import { PROVIDERS } from "../lib/providers/index.js";

const ERROR_TEXT = {
  no_key: "No API key for this provider. Add one in Settings.",
  key_rejected: "The API key was rejected. Check it in Settings.",
  rate_limited: "Rate limited. Wait a moment and retry.",
  server: "The provider returned an error.",
  network: "Could not reach the provider.",
  unparseable: "The model's answer could not be read as a result.",
  refusal: "The model declined to answer.",
  capture: "Could not capture the tab.",
  unknown: "Something went wrong.",
};

export function renderRoundError(root, error, { onRetry }) {
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "error";
  box.textContent = `${ERROR_TEXT[error.code] || ERROR_TEXT.unknown} ${error.message || ""}`.trim();
  root.append(box);
  if (error.raw) {
    const pre = document.createElement("pre");
    pre.className = "muted";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = String(error.raw).slice(0, 2000);
    root.append(pre);
  }
  if (onRetry) root.append(actionButton("Retry", onRetry));
}

export function renderRound(root, round, { onCapture, onRetry }) {
  root.innerHTML = "";
  const top = document.createElement("div");
  top.className = "row";
  top.style.marginBottom = "12px";
  top.append(actionButton("Capture & analyse (Alt+G)", onCapture));
  root.append(top);

  if (!round) {
    root.append(p("muted", "Press Alt+G on a GeoGuessr round, or use the button above."));
    return;
  }
  if (round.pending) {
    root.append(p("muted", "Analysing…"));
    return;
  }

  const shot = document.createElement("div");
  shot.className = "shot";
  const img = document.createElement("img");
  img.src = round.imageDataUrl;
  shot.append(img);
  root.append(shot);

  const columns = document.createElement("div");
  columns.className = "columns";
  root.append(columns);

  const boxesByProvider = {};
  for (const r of round.results) {
    const col = document.createElement("div");
    col.className = "card";
    const h = document.createElement("h3");
    h.style.margin = "0 0 6px";
    h.textContent = `${PROVIDERS[r.provider].label} · ${r.model}`;
    col.append(h);
    if (r.error) {
      const holder = document.createElement("div");
      renderRoundError(holder, r.error, { onRetry });
      col.append(holder);
    } else {
      boxesByProvider[r.provider] = drawBoxes(shot, r.result, r.provider === round.results[0].provider);
      col.append(...resultBody(r, round, boxesByProvider[r.provider]));
    }
    columns.append(col);
  }

  root.append(actualForm(round, async (updated) => {
    await putRound(updated);
    renderRound(root, updated, { onCapture, onRetry });
    if (root._onSaved) root._onSaved(updated);
  }));
}

function drawBoxes(shot, result, visible) {
  const els = [];
  for (const c of result.clues) {
    const b = document.createElement("div");
    b.className = "box";
    b.style.setProperty("--box-color", `var(--c-${c.category})`);
    b.style.left = `${c.box.x * 100}%`;
    b.style.top = `${c.box.y * 100}%`;
    b.style.width = `${c.box.w * 100}%`;
    b.style.height = `${c.box.h * 100}%`;
    b.style.display = visible ? "" : "none";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = String(c.id);
    b.append(tag);
    shot.append(b);
    els.push(b);
  }
  return els;
}

function resultBody(r, round, boxEls) {
  const res = r.result;
  const out = [];
  const guess = document.createElement("div");
  const place = [res.guess.country, res.guess.region].filter(Boolean).join(", ");
  guess.innerHTML = `<strong>${escapeHtml(place)}</strong> <span class="muted">${Math.round(res.confidence * 100)}% confident</span>`;
  out.push(guess);
  if (res.guess.lat != null) out.push(p("muted", `${res.guess.lat.toFixed(3)}, ${res.guess.lng.toFixed(3)}`));

  const score = round.scores && round.scores[r.provider];
  if (score) {
    out.push(p(score.hit ? "hit" : "miss", score.hit ? "Correct country" : `Wrong: it was ${round.actual.country}`));
  }

  const list = document.createElement("div");
  res.clues.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "clue";
    row.style.setProperty("--box-color", `var(--c-${c.category})`);
    const verdict = score && score.verdicts.find((v) => v.id === c.id);
    row.innerHTML = `
      <div class="num">${c.id}</div>
      <div>
        <div class="cat">${c.category.replace(/_/g, " ")}${verdict ? ` · <span class="verdict-${verdict.verdict}">${verdict.verdict}</span>` : ""}</div>
        <div>${escapeHtml(c.observation)}</div>
        <div class="muted">${escapeHtml(c.inference)}</div>
        <div class="bar" style="width:${Math.max(2, c.weight * 100)}%"></div>
      </div>
      <div class="pct">${Math.round(c.weight * 100)}%</div>`;
    const activate = (on) => {
      row.classList.toggle("active", on);
      boxEls[i].classList.toggle("active", on);
      boxEls.forEach((b) => { b.style.display = ""; });
    };
    row.onmouseenter = () => activate(true);
    row.onmouseleave = () => activate(false);
    row.onclick = () => activate(!row.classList.contains("active"));
    boxEls[i].onclick = () => row.scrollIntoView({ behavior: "smooth", block: "center" });
    list.append(row);
  });
  out.push(list);

  out.push(p("", res.summary));
  if (res.alternatives.length) {
    const alt = document.createElement("div");
    alt.className = "muted";
    alt.innerHTML = "<strong>Also considered:</strong> " + res.alternatives
      .map((a) => `${escapeHtml(a.country)} (${escapeHtml(a.why_not)})`).join("; ");
    out.push(alt);
  }
  return out;
}

function actualForm(round, onSave) {
  const card = document.createElement("div");
  card.className = "card";
  if (round.actual) {
    const a = round.actual;
    card.innerHTML = `<strong>Actual:</strong> ${escapeHtml([a.country, a.region].filter(Boolean).join(", "))}`
      + (a.lat != null ? ` <span class="muted">(${a.lat}, ${a.lng})</span>` : "")
      + ' <span class="muted">· saved to notebook</span>';
    return card;
  }
  card.innerHTML = `
    <h3 style="margin:0 0 6px">What was it actually?</h3>
    <label for="act-country">Country</label><input id="act-country" placeholder="e.g. Peru">
    <label for="act-region">Region (optional)</label><input id="act-region" placeholder="e.g. Arequipa">
    <label for="act-coords">Coordinates (optional)</label><input id="act-coords" placeholder="lat, lng">
    <p class="error" id="act-err" hidden></p>`;
  const save = actionButton("Save round", async () => {
    const err = card.querySelector("#act-err");
    try {
      const actual = parseActualInput(
        card.querySelector("#act-country").value,
        card.querySelector("#act-region").value,
        card.querySelector("#act-coords").value,
      );
      await onSave(applyActual(round, actual));
    } catch (e) {
      err.textContent = e.message.replace(/^actual: /, "");
      err.hidden = false;
    }
  });
  save.style.marginTop = "10px";
  card.append(save);
  return card;
}

function actionButton(text, onclick) {
  return Object.assign(document.createElement("button"), { className: "primary", textContent: text, onclick });
}
function p(cls, text) {
  const el = document.createElement("p");
  el.className = cls;
  el.textContent = text;
  return el;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
```

- [ ] **Step 6: Add the `analyse` message to background.js**

Modify `background.js`: add a function and extend the message listener.

```js
async function analyseHeld(imageDataUrl, feedback) {
  const settings = await loadSettings();
  const round = await analyseImage(imageDataUrl, settings, feedback || []);
  await chrome.storage.session.set({ lastRound: round });
  return { ok: true, round };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "capture") {
    captureAndAnalyse(msg.feedback).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "analyse") {
    analyseHeld(msg.imageDataUrl, msg.feedback).then(sendResponse);
    return true;
  }
  return false;
});
```

(Replace the earlier `onMessage` listener with this one.)

- [ ] **Step 7: Wire the round view in sidepanel.js**

Replace the line `views.round.innerHTML = '...'` and add message handling. Full updated `sidepanel.js`:

```js
import { renderSettings } from "./ui/settings.js";
import { renderRound, renderRoundError } from "./ui/round.js";
import { allRounds } from "./lib/notebook-db.js";
import { feedbackLines } from "./lib/notebook-logic.js";

const views = {
  round: document.getElementById("view-round"),
  notebook: document.getElementById("view-notebook"),
  settings: document.getElementById("view-settings"),
};

let currentRound = null;   // Round | {pending: true} | null
let heldImage = null;      // last screenshot data URL, for retry

export async function refreshFeedback() {
  const lines = feedbackLines(await allRounds());
  await chrome.storage.session.set({ lastFeedback: lines });
  return lines;
}

export function showView(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.view === name);
  for (const [k, el] of Object.entries(views)) el.classList.toggle("active", k === name);
  if (name === "settings") renderSettings(views.settings);
  if (name === "notebook" && window.renderNotebookView) window.renderNotebookView(views.notebook);
}

function paintRound() {
  renderRound(views.round, currentRound, { onCapture: capture, onRetry: retry });
  views.round._onSaved = () => refreshFeedback();
}

function handleReply(reply) {
  if (reply.ok) {
    currentRound = reply.round;
    heldImage = reply.round.imageDataUrl;
    paintRound();
  } else {
    currentRound = null;
    renderRoundError(views.round, reply.error, { onRetry: heldImage ? retry : capture });
  }
}

async function capture() {
  currentRound = { pending: true };
  paintRound();
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "capture", feedback });
  handleReply(reply);
}

async function retry() {
  if (!heldImage) return capture();
  currentRound = { pending: true };
  paintRound();
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "analyse", imageDataUrl: heldImage, feedback });
  handleReply(reply);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "pending") { currentRound = { pending: true }; showView("round"); paintRound(); }
  if (msg.type === "round") { showView("round"); handleReply(msg.reply); }
});

for (const b of document.querySelectorAll(".tabs button[data-view]")) b.onclick = () => showView(b.dataset.view);
document.getElementById("open-tab").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });

const { lastRound } = await chrome.storage.session.get("lastRound");
if (lastRound && !lastRound.pending) { currentRound = lastRound; heldImage = lastRound.imageDataUrl; }
await refreshFeedback();
showView("round");
paintRound();
```

- [ ] **Step 8: Check by hand on a real round**

1. Reload the extension. Open https://www.geoguessr.com and start any game (a free daily challenge or classic round is fine).
2. With an OpenAI key saved, press Alt+G. Expected: panel opens, shows "Analysing…", then the screenshot with numbered coloured boxes, a GPT card with country, confidence, clue rows with bars, summary and alternatives.
3. Hover a clue row: its box glows. Click a box: the list scrolls to its row.
4. Type the real country (finish the round first to see it), Save round. Expected: the card shows Actual, each clue gets a supporting/misleading tag, the result card shows "Correct country" or "Wrong: it was …".
5. Remove the OpenAI key in Settings and press Alt+G again. Expected: an error card "No API key for this provider…" with Retry. Add the key back, click Retry: the same screenshot is re-analysed without a new capture (the page content behind can change; the panel image must not).
6. Toggle "Ask every enabled provider" with two keys configured: two columns appear; only the first provider's boxes are drawn until you hover a clue in the second column.

- [ ] **Step 9: Commit and push**

```bash
git add lib/geo.js test/geo.test.js ui/round.js sidepanel.js background.js
git commit -m "Add round view with clue overlay, weights and actual-location scoring

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 12: Notebook view

**Files:**
- Create: `ui/notebook.js`
- Modify: `sidepanel.js` (import and register the notebook renderer, remove the `window.renderNotebookView` hook)

**Interfaces:**
- Consumes: `allRounds`, `deleteRound` (Task 8); `stats` (Task 7); `renderRound` (Task 11); `PROVIDERS`, `PROVIDER_ORDER` (Task 6); `CATEGORIES` (Task 1).
- Produces: `export async function renderNotebook(root, { onOpen })` where `onOpen(round)` shows that round in the Round view.

- [ ] **Step 1: Write ui/notebook.js**

```js
import { allRounds, deleteRound } from "../lib/notebook-db.js";
import { stats } from "../lib/notebook-logic.js";
import { PROVIDERS, PROVIDER_ORDER } from "../lib/providers/index.js";
import { CATEGORIES } from "../lib/prompt.js";

const filters = { country: "", category: "", provider: "" };

export async function renderNotebook(root, { onOpen, onDeleted }) {
  const rounds = await allRounds();
  root.innerHTML = "";

  root.append(statsCard(stats(rounds)));

  const bar = document.createElement("div");
  bar.className = "row";
  bar.style.marginBottom = "8px";
  const country = Object.assign(document.createElement("input"), { placeholder: "Filter by country", value: filters.country });
  const category = document.createElement("select");
  category.append(new Option("All categories", ""));
  for (const c of CATEGORIES) category.append(new Option(c.replace(/_/g, " "), c, false, c === filters.category));
  const provider = document.createElement("select");
  provider.append(new Option("All providers", ""));
  for (const id of PROVIDER_ORDER) provider.append(new Option(PROVIDERS[id].label, id, false, id === filters.provider));
  const rerender = () => {
    filters.country = country.value; filters.category = category.value; filters.provider = provider.value;
    renderNotebook(root, { onOpen, onDeleted });
  };
  country.onchange = rerender; category.onchange = rerender; provider.onchange = rerender;
  bar.append(country, category, provider);
  root.append(bar);

  const shown = rounds.filter(matches);
  if (!shown.length) {
    root.append(Object.assign(document.createElement("p"), { className: "muted", textContent: rounds.length ? "No rounds match the filters." : "No rounds yet. Save one from the Round tab." }));
    return;
  }
  for (const round of shown) root.append(roundRow(round, { onOpen, onDeleted: () => renderNotebook(root, { onOpen, onDeleted }) }));
}

function matches(round) {
  const q = filters.country.trim().toLowerCase();
  if (q) {
    const names = [round.actual && round.actual.country, ...round.results.map((r) => r.result && r.result.guess.country)]
      .filter(Boolean).map((s) => s.toLowerCase());
    if (!names.some((n) => n.includes(q))) return false;
  }
  if (filters.provider && !round.results.some((r) => r.provider === filters.provider)) return false;
  if (filters.category && !round.results.some((r) => r.result && r.result.clues.some((c) => c.category === filters.category))) return false;
  return true;
}

function roundRow(round, { onOpen, onDeleted }) {
  const row = document.createElement("div");
  row.className = "round-row";
  const img = document.createElement("img");
  img.src = round.imageDataUrl;
  const text = document.createElement("div");
  const guesses = round.results.map((r) => r.result
    ? `${PROVIDERS[r.provider].label.split(" ")[0]}: ${r.result.guess.country}`
    : `${PROVIDERS[r.provider].label.split(" ")[0]}: error`).join(" · ");
  const when = new Date(round.ts).toLocaleString();
  let verdict = '<span class="muted">unscored</span>';
  if (round.scores) {
    const hits = Object.values(round.scores).filter((s) => s.hit).length;
    const n = Object.keys(round.scores).length;
    verdict = `<span class="${hits ? "hit" : "miss"}">${hits}/${n} hit</span> · actual ${escapeHtml(round.actual.country)}`;
  }
  text.innerHTML = `<div>${escapeHtml(guesses)}</div><div class="muted" style="font-size:12px">${when} · ${verdict}</div>`;
  const del = Object.assign(document.createElement("button"), { className: "secondary", textContent: "✕", title: "Delete round" });
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("Delete this round?")) return;
    await deleteRound(round.id);
    onDeleted();
  };
  row.append(img, text, del);
  row.onclick = () => onOpen(round);
  return row;
}

function statsCard(s) {
  const card = document.createElement("div");
  card.className = "card";
  if (!s.total) {
    card.innerHTML = '<span class="muted">Stats appear once you have saved rounds with the actual location.</span>';
    return card;
  }
  const pct = (r) => `${Math.round(r * 100)}%`;
  const catRows = Object.entries(s.byCategory).sort((a, b) => b[1].rate - a[1].rate)
    .map(([c, v]) => `<tr><td>${c.replace(/_/g, " ")}</td><td>${pct(v.rate)}</td><td class="muted">${v.supporting}/${v.supporting + v.misleading}</td></tr>`).join("");
  const provRows = Object.entries(s.byProvider)
    .map(([p, v]) => `<tr><td>${PROVIDERS[p].label}</td><td>${pct(v.rate)}</td><td class="muted">${v.hits}/${v.rounds}</td></tr>`).join("");
  card.innerHTML = `
    <h3 style="margin:0 0 6px">${s.total} scored round${s.total === 1 ? "" : "s"}</h3>
    <table class="stats"><tr><th>Clue category</th><th>Reliable</th><th></th></tr>${catRows}</table>
    <table class="stats" style="margin-top:8px"><tr><th>Provider</th><th>Country hit rate</th><th></th></tr>${provRows}</table>`;
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
```

- [ ] **Step 2: Register it in sidepanel.js**

Add the import and replace the notebook line in `showView`:

```js
import { renderNotebook } from "./ui/notebook.js";
// ...
  if (name === "notebook") {
    renderNotebook(views.notebook, {
      onOpen: (round) => { currentRound = round; heldImage = round.imageDataUrl; showView("round"); paintRound(); },
      onDeleted: () => refreshFeedback(),
    });
  }
```

Remove the `window.renderNotebookView` line.

- [ ] **Step 3: Check by hand**

1. Reload the extension. Save two or three rounds with actual locations, at least one miss.
2. Notebook tab: stats card lists categories with reliability percentages and the provider hit rate; rows show thumbnails, guesses, hit/miss and actual.
3. Filter by the missed country: only that round shows. Filter by a category: rounds containing that clue category show.
4. Click a row: the Round tab shows that round with its boxes and scores, and the actual card says "saved to notebook".
5. Delete a round with ✕: it disappears and stats update.
6. Do a new capture: the prompt now includes feedback. Verify in the service worker console by logging `lastFeedback`: `chrome.storage.session.get("lastFeedback").then(console.log)` shows the "Guessed … actual …" lines.

- [ ] **Step 4: Commit and push**

```bash
git add ui/notebook.js sidepanel.js
git commit -m "Add notebook view with filters and per-category stats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 13: README and final checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all passing, zero failures.

- [ ] **Step 2: Replace README.md**

```markdown
# Geo Meta Trainer

A self-contained Chrome extension for learning GeoGuessr metas.

Press **Alt+G** during a round. The extension screenshots what you see, asks a
vision model (Claude, OpenAI or Gemini) where it is, and shows:

- the guess and its confidence,
- every clue it used, drawn as a numbered box on the screenshot,
- how much weight each clue carried, as a bar,
- its reasoning and the alternatives it rejected.

After the round, type the real location. Each clue is scored as supporting or
misleading and the round is saved to a personal notebook. The Notebook tab
shows which clue categories are actually reliable and each model's hit rate.
Recent misses are fed back into the next prompt.

It is a training aid, not a live assistant. It only runs when you ask, never
moves, pans or zooms the viewer (safe in NMPZ), and never reads GeoGuessr's
page internals.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Open the side panel from the toolbar icon, go to **Settings**, paste an API key.
4. If Alt+G clashes with something, rebind it at `chrome://extensions/shortcuts`.

No build step. No server. Nothing is installed.

## API keys

You bring your own keys. None of the chat subscriptions (ChatGPT Plus, claude.ai) include API access.

| Provider | Where to get a key | Cost |
|---|---|---|
| Gemini | https://aistudio.google.com/apikey | Free tier with rate limits (personal Google accounts; often blocked on corporate accounts) |
| Claude | https://console.anthropic.com | Pay as you go, roughly 2-3p per snapshot on Opus 5 |
| OpenAI (default) | https://platform.openai.com | Pay as you go; make a project API key |

Keys are stored in Chrome's local extension storage on your machine and are
sent only to their own vendor. Never commit keys to this repository.

Turn on **Ask every enabled provider** in Settings to send one snapshot to all
configured models and compare their answers side by side.

## Development

```
npm test
```

Runs the unit tests with Node's built-in test runner. Everything in `lib/` is
pure and tested; the UI is checked by hand in Chrome.

Design: [docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md](docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md)
Plan: [docs/superpowers/plans/2026-09-29-geo-meta-trainer.md](docs/superpowers/plans/2026-09-29-geo-meta-trainer.md)
```

- [ ] **Step 3: Final hand check of the whole flow**

Reload the extension once more and run one complete round: Alt+G → result → save actual → notebook shows it → export JSON opens and contains the round. Confirm no errors in the service worker console or the side panel console (right-click panel → Inspect).

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "Write README with install and key instructions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

### Task 14: GeoGuessr coverage list and sub-country precision (execute after Task 5, before Task 11)

Added mid-run at the user's request. Two changes to the model contract:
1. The model must only guess countries that actually have Street View coverage used by GeoGuessr. Coverage changes over time, so the list is a hand-maintained constant in one file.
2. The guess must be as precise as possible: `region` (state, province or area), `locality` (nearest town, or null), and best-estimate `lat`/`lng` are always required. The validator (Task 2) stays lenient and still accepts nulls, so old fixtures keep working; the schema and prompt are what force precision.

**Files:**
- Create: `lib/countries.js`
- Modify: `lib/prompt.js` (SYSTEM_PROMPT gains the list and precision rules; RESULT_SCHEMA `guess.country` and `alternatives.items.properties.country` become enums of the list; `guess.region` becomes required string, `guess.lat`/`guess.lng` required numbers, new nullable `guess.locality`)
- Test: `test/countries.test.js`
- Modify: `test/prompt.test.js` (replace the "schema marks optional guess fields nullable" test; add three tests)

**Interfaces:**
- Produces:
  - `export const COVERAGE_COUNTRIES` — array of display names, sorted A→Z, unique.
  - `export function isCovered(name)` — case-insensitive, trimmed match against the list → boolean.
- Consumed by: `lib/prompt.js` (this task), Task 11 (datalist on the actual-country input).

- [ ] **Step 1: Write the failing tests**

`test/countries.test.js`:

```js
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
```

In `test/prompt.test.js`, replace the existing test `"schema marks optional guess fields nullable"` with:

```js
test("schema requires region and coordinates, allows null locality", () => {
  const g = RESULT_SCHEMA.properties.guess;
  assert.deepEqual(g.required.sort(), ["country", "lat", "lng", "locality", "region"]);
  assert.deepEqual(g.properties.region, { type: "string" });
  assert.deepEqual(g.properties.lat, { type: "number" });
  assert.deepEqual(g.properties.lng, { type: "number" });
  assert.deepEqual(g.properties.locality.type, ["string", "null"]);
});
```

Then add:

```js
import { COVERAGE_COUNTRIES } from "../lib/countries.js";

test("schema restricts guess and alternative countries to the coverage list", () => {
  assert.deepEqual(RESULT_SCHEMA.properties.guess.properties.country.enum, COVERAGE_COUNTRIES);
  assert.deepEqual(RESULT_SCHEMA.properties.alternatives.items.properties.country.enum, COVERAGE_COUNTRIES);
});

test("system prompt lists the coverage countries", () => {
  assert.ok(SYSTEM_PROMPT.includes("Botswana"));
  assert.ok(SYSTEM_PROMPT.includes("Only these countries"));
});

test("system prompt demands sub-country precision", () => {
  assert.ok(SYSTEM_PROMPT.includes("region"));
  assert.ok(SYSTEM_PROMPT.includes("locality"));
  assert.ok(/lat.*lng/s.test(SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../lib/countries.js`; the two new prompt tests fail.

- [ ] **Step 3: Write lib/countries.js**

```js
// Countries and territories with official Google Street View coverage that
// appear in GeoGuessr's world map. Hand-maintained: coverage changes, so edit
// this list when GeoGuessr adds or drops a country. Display names only.
export const COVERAGE_COUNTRIES = [
  "Albania", "American Samoa", "Andorra", "Argentina", "Australia", "Austria",
  "Bangladesh", "Belgium", "Bermuda", "Bhutan", "Bolivia", "Botswana", "Brazil", "Bulgaria",
  "Cambodia", "Canada", "Chile", "Christmas Island", "Colombia", "Costa Rica", "Croatia", "Curaçao", "Czechia",
  "Denmark", "Dominican Republic",
  "Ecuador", "Egypt", "Estonia", "Eswatini",
  "Faroe Islands", "Finland", "France",
  "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Guam", "Guatemala",
  "Hong Kong", "Hungary",
  "Iceland", "India", "Indonesia", "Ireland", "Isle of Man", "Israel", "Italy",
  "Japan", "Jersey", "Jordan",
  "Kazakhstan", "Kenya", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liechtenstein", "Lithuania", "Luxembourg",
  "Macau", "Madagascar", "Malaysia", "Malta", "Martinique", "Mexico", "Monaco", "Mongolia", "Montenegro",
  "Netherlands", "New Zealand", "Nigeria", "North Macedonia", "Northern Mariana Islands", "Norway",
  "Oman",
  "Palestine", "Panama", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico",
  "Qatar",
  "Réunion", "Romania", "Russia", "Rwanda",
  "San Marino", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland",
  "Taiwan", "Thailand", "Tunisia", "Turkey",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "US Virgin Islands",
  "Vietnam",
];

const lookup = new Set(COVERAGE_COUNTRIES.map((c) => c.trim().toLowerCase()));

export function isCovered(name) {
  return lookup.has(String(name ?? "").trim().toLowerCase());
}
```

If the sorted-and-unique test fails because of locale ordering (e.g. "Réunion", "US Virgin Islands"), reorder the array to satisfy `localeCompare(..., "en")` rather than weakening the test.

- [ ] **Step 4: Modify lib/prompt.js**

Add at the top:

```js
import { COVERAGE_COUNTRIES } from "./countries.js";
```

Change both `country: { type: "string" }` entries in `RESULT_SCHEMA` (inside `guess` and inside `alternatives.items`) to:

```js
country: { type: "string", enum: COVERAGE_COUNTRIES },
```

Replace the `guess` object in `RESULT_SCHEMA` with:

```js
guess: {
  type: "object",
  additionalProperties: false,
  required: ["country", "region", "locality", "lat", "lng"],
  properties: {
    country: { type: "string", enum: COVERAGE_COUNTRIES },
    region: { type: "string" },
    locality: { type: ["string", "null"] },
    lat: { type: "number" },
    lng: { type: "number" },
  },
},
```

In `SYSTEM_PROMPT`, replace the rule line
`- guess.country is required. Add region, lat and lng when you have a real basis for them, otherwise null.`
with:

```
- guess.country is required and must come from the coverage list below.
- guess.region is required: the state, province, oblast, prefecture or well-known area you think this is in. Never leave it generic like "unknown"; commit to your best guess.
- guess.locality: the nearest town or city if you can name one, otherwise null.
- guess.lat and guess.lng are required: your single best estimate of the coordinates, in decimal degrees. A best estimate beats no estimate; GeoGuessr scores by distance.
```

Append to `SYSTEM_PROMPT`, after the existing rules, a new paragraph:

```
Only these countries and territories have Street View coverage in GeoGuessr, so the answer must be one of them, exactly as written: ${COVERAGE_COUNTRIES.join(", ")}.
If the scenery seems to point elsewhere, choose the most similar covered country and say so in the summary.
```

(Insert both with template literals so the list is generated from the constant, not pasted.)

Also update `lib/validate.js` so the cleaned guess carries `locality`: in the returned `guess` object add
`locality: typeof g.locality === "string" && g.locality.trim() ? g.locality.trim() : null,`
and add to `test/validate.test.js`:

```js
test("locality is passed through or null", () => {
  const g = good(); g.guess.locality = " Calama ";
  assert.equal(validateResult(g).guess.locality, "Calama");
  delete g.guess.locality;
  assert.equal(validateResult(g).guess.locality, null);
});
```

Add `lib/validate.js` and `test/validate.test.js` to the commit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all passing, including the two new prompt tests and the existing "schema requires every top-level property" test.

- [ ] **Step 6: Commit and push**

```bash
git add lib/countries.js lib/prompt.js test/countries.test.js test/prompt.test.js
git commit -m "Restrict guesses to GeoGuessr coverage countries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

**Follow-on for Task 11 (already reflected in the design requirements):** the actual-country `<input>` gets `list="country-list"` and a `<datalist id="country-list">` populated from `COVERAGE_COUNTRIES`, so typed answers match the model's spelling and scoring compares like with like. Free text is still allowed.

---

### Task 15: Distance and region scoring (execute after Task 14, before Task 11)

Added mid-run at the user's request: GeoGuessr scores by distance, so a country hit is not enough. When the user enters coordinates, score the great-circle distance; when they enter a region, score a region hit. Surface both in the notebook stats.

**Files:**
- Modify: `lib/score.js`
- Modify: `lib/notebook-logic.js`
- Test: `test/score.test.js` (add tests)
- Test: `test/notebook-logic.test.js` (add tests, update one assertion)

**Interfaces:**
- Consumes: existing `normaliseName`, `isHit`, `scoreClues`, and the module-private word-boundary `mentions(text, name)` in `lib/score.js`; `scoreRound` callers in `lib/notebook-logic.js`.
- Produces:
  - `export function distanceKm(a, b)` — `a`, `b` are `{lat, lng}`; returns great-circle distance in km (haversine, Earth radius 6371 km), or `null` if any coordinate is not a finite number.
  - `export function isRegionHit(result, actual)` — true if `actual.region` is non-empty and either normalised region equals the other or one contains the other at a word boundary (reuse `mentions` both ways). False when `actual.region` is null.
  - `scoreRound(result, actual)` now returns `{hit, regionHit, distanceKm, verdicts}`.
  - `stats(rounds).byProvider[id]` gains `regionHits` (count) and `meanDistanceKm` (mean over results with a numeric distance, or `null` when none).
  - `feedbackLines` includes regions when present: `"Guessed Chile, Atacama (top clue: …); actual Peru, Arequipa"`. Region parts are omitted when null, so the existing fixtures produce the same lines as before.

- [ ] **Step 1: Add failing tests to test/score.test.js**

```js
import { distanceKm, isRegionHit } from "../lib/score.js";

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
```

(`result` is the fixture already defined at the top of the test file. Merge the import into the existing import line.)

- [ ] **Step 2: Add failing tests to test/notebook-logic.test.js**

```js
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
```

Also update the existing assertion in `stats aggregates by category and provider` from
`assert.deepEqual(s.byProvider.gemini, { hits: 1, rounds: 2, rate: 0.5 });` to
`assert.deepEqual(s.byProvider.gemini, { hits: 1, rounds: 2, rate: 0.5, regionHits: 0, meanDistanceKm: null });`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: the seven new tests fail (missing exports / missing fields) and the updated assertion fails; everything else still passes.

- [ ] **Step 4: Extend lib/score.js**

Add:

```js
const EARTH_RADIUS_KM = 6371;

export function distanceKm(a, b) {
  const vals = [a && a.lat, a && a.lng, b && b.lat, b && b.lng];
  if (!vals.every(Number.isFinite)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isRegionHit(result, actual) {
  if (!actual.region || !normaliseName(actual.region)) return false;
  const g = result.guess.region || "";
  return normaliseName(g) === normaliseName(actual.region)
    || mentions(g, actual.region)
    || mentions(actual.region, g);
}
```

and change `scoreRound` to:

```js
export function scoreRound(result, actual) {
  return {
    hit: isHit(result, actual),
    regionHit: isRegionHit(result, actual),
    distanceKm: distanceKm(result.guess, actual),
    verdicts: scoreClues(result, actual),
  };
}
```

- [ ] **Step 5: Extend lib/notebook-logic.js**

In `feedbackLines`, build the line as:

```js
const place = (country, region) => (region ? `${country}, ${region}` : country);
lines.push(`Guessed ${place(r.result.guess.country, r.result.guess.region)} (top clue: ${topClue(r.result).observation}); actual ${place(round.actual.country, round.actual.region)}`);
```

In `stats`, initialise each provider entry as
`{ hits: 0, rounds: 0, rate: 0, regionHits: 0, meanDistanceKm: null, _distances: [] }`,
and inside the per-result loop add:

```js
if (s.regionHit) p.regionHits++;
if (Number.isFinite(s.distanceKm)) p._distances.push(s.distanceKm);
```

After the loop, when computing rates:

```js
for (const p of Object.values(byProvider)) {
  p.rate = p.rounds ? p.hits / p.rounds : 0;
  p.meanDistanceKm = p._distances.length ? p._distances.reduce((x, y) => x + y, 0) / p._distances.length : null;
  delete p._distances;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 7: Commit and push**

```bash
git add lib/score.js lib/notebook-logic.js test/score.test.js test/notebook-logic.test.js
git commit -m "Score distance and region hits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

**Follow-on for Tasks 11 and 12 (binding):**
- Round view shows `country, region` as the headline, `locality` beneath when present, the coordinates, and an "Open in Google Maps" link to `https://www.google.com/maps?q=<lat>,<lng>` (opens in a new tab; no map is embedded).
- After the actual location is saved, the result card shows the distance in km (one decimal under 10 km, whole km otherwise) when available, and "Region: correct / wrong" when the user gave a region.
- Notebook stats provider table gains two columns: region hit rate and mean distance.
- The actual-location form keeps country, region and coordinates inputs; the country input has the `COVERAGE_COUNTRIES` datalist from Task 14.
