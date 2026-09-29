const EARTH_RADIUS_KM = 6371;

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
  return {
    hit: isHit(result, actual),
    regionHit: isRegionHit(result, actual),
    distanceKm: distanceKm(result.guess, actual),
    verdicts: scoreClues(result, actual),
  };
}
