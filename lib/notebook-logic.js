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

const place = (country, region) => (region ? `${country}, ${region}` : country);

export function feedbackLines(rounds, limit = 12) {
  const lines = [];
  const sorted = [...rounds].filter((r) => r.actual && r.scores).sort((a, b) => b.ts - a.ts);
  for (const round of sorted) {
    for (const r of round.results) {
      const s = r.result && round.scores[r.provider];
      if (!s || s.hit) continue;
      lines.push(`Guessed ${place(r.result.guess.country, r.result.guess.region)} (top clue: ${topClue(r.result).observation}); actual ${place(round.actual.country, round.actual.region)}`);
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
      const p = (byProvider[r.provider] ||= { hits: 0, rounds: 0, rate: 0, regionHits: 0, meanDistanceKm: null, _distances: [] });
      p.rounds++;
      if (s.hit) p.hits++;
      if (s.regionHit) p.regionHits++;
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
  return rounds;
}
