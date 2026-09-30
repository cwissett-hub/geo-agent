import { scoreRound, scorePassed } from "./score.js";
import { validateResult } from "./validate.js";

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

// "Chile, Atacama, Calama" — country, then region, then nearest large town,
// each only when known.
const place = (country, region, locality) => [country, region, locality].filter(Boolean).join(", ");

export function feedbackLines(rounds, limit = 12) {
  const lines = [];
  const sorted = [...rounds].filter((r) => r.actual && r.scores).sort((a, b) => b.ts - a.ts);
  for (const round of sorted) {
    for (const r of round.results) {
      const s = r.result && round.scores[r.provider];
      if (!s || scorePassed(s)) continue;
      const g = r.result.guess;
      const a = round.actual;
      // Right country, wrong part of it: still a miss, and say so.
      const how = s.hit
        ? `right country, wrong region${Number.isFinite(s.distanceKm) ? `, ${Math.round(s.distanceKm)} km off` : ""}; `
        : "";
      lines.push(`Guessed ${place(g.country, g.region, g.locality)} (top clue: ${topClue(r.result).observation}); ${how}actual ${place(a.country, a.region, a.locality)}`);
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
      const p = (byProvider[r.provider] ||= { hits: 0, passes: 0, passRate: 0, rounds: 0, rate: 0, regionHits: 0, localityHits: 0, meanDistanceKm: null, _distances: [] });
      p.rounds++;
      if (s.hit) p.hits++;
      if (scorePassed(s)) p.passes++;
      if (s.regionHit) p.regionHits++;
      if (s.localityHit) p.localityHits++;
      if (Number.isFinite(s.distanceKm)) p._distances.push(s.distanceKm);
      for (const v of s.verdicts) {
        const clue = r.result.clues.find((c) => c.id === v.id);
        if (!clue) continue;
        const c = (byCategory[clue.category] ||= { supporting: 0, misleading: 0, rate: 0 });
        c[v.verdict]++;
      }
    }
  }
  for (const p of Object.values(byProvider)) {
    p.rate = p.rounds ? p.hits / p.rounds : 0;
    p.passRate = p.rounds ? p.passes / p.rounds : 0;
    p.meanDistanceKm = p._distances.length ? p._distances.reduce((x, y) => x + y, 0) / p._distances.length : null;
    delete p._distances;
  }
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
  return rounds.map(cleanRound);
}

// Imported rounds go straight into IndexedDB and are later rendered as
// innerHTML elsewhere, so every result nested inside a round is treated as
// untrusted here: it must carry a provider/model pair, and any non-null
// result is run through the same validateResult() a live provider response
// would get. A result that fails validation does not sink the whole file —
// it becomes an "unparseable" error entry, same as a bad live API reply.
function cleanRound(r) {
  const results = r.results.map(cleanResultEntry);
  const actual = r.actual && typeof r.actual === "object" && typeof r.actual.country === "string" ? r.actual : null;
  let round = { id: r.id, ts: r.ts, imageDataUrl: r.imageDataUrl, results, actual, scores: null };
  if (actual) round = applyActual(round, actual);
  return round;
}

function cleanResultEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.provider !== "string" || typeof entry.model !== "string") {
    throw new Error("import: one or more entries is not a round record");
  }
  const { provider, model } = entry;
  if (entry.result == null) {
    return { provider, model, result: null, error: cleanImportedError(entry.error) };
  }
  try {
    return { provider, model, result: validateResult(entry.result), error: null };
  } catch (e) {
    return { provider, model, result: null, error: { code: "unparseable", message: e.message, raw: null } };
  }
}

function cleanImportedError(error) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    return { code: typeof error.code === "string" ? error.code : "unknown", message: error.message, raw: error.raw ?? null };
  }
  return null;
}
