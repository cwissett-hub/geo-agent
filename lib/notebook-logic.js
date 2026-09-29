import { scoreRound } from "./score.js";

export function newRound(id, results) {
  return { id, results };
}

export function applyActual(round, actual) {
  return { ...round, actual, scored: round.results.map((r) => scoreRound(r.result, actual)) };
}

function topClue(result) {
  return result.clues.length > 0 ? result.clues[0] : null;
}

export function feedbackLines(rounds) {
  const lines = [];
  for (const round of rounds) {
    const r = round.results[0];
    const topClueObj = topClue(r.result);
    const place = (country, region) => (region ? `${country}, ${region}` : country);
    lines.push(`Guessed ${place(r.result.guess.country, r.result.guess.region)} (top clue: ${topClueObj?.observation}); actual ${place(round.actual.country, round.actual.region)}`);
  }
  return lines;
}

export function stats(rounds) {
  const byProvider = {};

  for (const round of rounds) {
    for (let i = 0; i < round.results.length; i++) {
      const r = round.results[i];
      const s = round.scored[i];
      const key = r.provider;

      if (!byProvider[key]) {
        byProvider[key] = { hits: 0, rounds: 0, rate: 0, regionHits: 0, meanDistanceKm: null, _distances: [] };
      }

      const p = byProvider[key];
      if (s.hit) p.hits++;
      p.rounds++;
      if (s.regionHit) p.regionHits++;
      if (Number.isFinite(s.distanceKm)) p._distances.push(s.distanceKm);
    }
  }

  for (const p of Object.values(byProvider)) {
    p.rate = p.rounds ? p.hits / p.rounds : 0;
    p.meanDistanceKm = p._distances.length ? p._distances.reduce((x, y) => x + y, 0) / p._distances.length : null;
    delete p._distances;
  }

  return { byProvider };
}

export function serialiseRounds(rounds) {
  // Not needed for this task, but placeholder for full implementation
  return [];
}

export function parseImport() {
  // Not needed for this task, but placeholder for full implementation
  return [];
}
