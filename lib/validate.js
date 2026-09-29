import { CATEGORIES } from "./prompt.js";

const MIN_SIZE = 0.02;

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

export function clampBox(box) {
  const b = box && typeof box === "object" ? box : {};
  const origX = Number.isFinite(b.x) ? b.x : 0;
  const origY = Number.isFinite(b.y) ? b.y : 0;
  const origW = Number.isFinite(b.w) ? b.w : MIN_SIZE;
  const origH = Number.isFinite(b.h) ? b.h : MIN_SIZE;

  // Clamp the top-left corner
  const x = clamp01(origX);
  const y = clamp01(origY);

  // Calculate and clamp the bottom-right corner
  const right = clamp01(origX + origW);
  const bottom = clamp01(origY + origH);

  // Calculate new dimensions
  let w = Math.max(MIN_SIZE, right - x);
  let h = Math.max(MIN_SIZE, bottom - y);

  // If minimum size pushed us past the edge, pull the origin back
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
      locality: typeof g.locality === "string" && g.locality.trim() ? g.locality.trim() : null,
      lat: Number.isFinite(g.lat) ? g.lat : null,
      lng: Number.isFinite(g.lng) ? g.lng : null,
    },
    confidence: clamp01(Number.isFinite(obj.confidence) ? obj.confidence : 0.5),
    alternatives,
    clues,
    summary: obj.summary,
  };
}
