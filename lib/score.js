export function normaliseName(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isHit(result, actual) {
  return normaliseName(result.guess.country) === normaliseName(actual.country);
}

function mentions(text, name) {
  const n = normaliseName(name);
  if (n.length === 0) return false;

  // Match normalized name only at word boundaries using Unicode letter/digit/hyphen/underscore classes
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'u');
  return pattern.test(normaliseName(text));
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
