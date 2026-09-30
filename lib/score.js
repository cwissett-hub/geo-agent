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

// Nearest large town. Same loose matching as regions: "Calama" matches
// "Calama, Chile" and "San Pedro de Atacama" matches "san pedro de atacama".
export function isLocalityHit(result, actual) {
  if (!actual.locality || !normaliseName(actual.locality)) return false;
  const g = result.guess.locality || "";
  if (!normaliseName(g)) return false;
  return normaliseName(g) === normaliseName(actual.locality)
    || mentions(g, actual.locality)
    || mentions(actual.locality, g);
}

export function scoreClues(result, actual) {
  const hit = isHit(result, actual);
  return result.clues.map((c) => {
    const text = `${c.observation} ${c.inference}`;
    const supporting = hit
      || mentions(text, actual.country)
      || (actual.region && mentions(text, actual.region))
      || (actual.locality && mentions(text, actual.locality));
    return { id: c.id, verdict: supporting ? "supporting" : "misleading" };
  });
}

// In a big country (Russia, Australia, the US) the right country can still be
// thousands of km out, so a round only passes when the location inside the
// country is right too: region or town matches, or the pin is within
// PASS_KM. When the actual has nothing finer than the country, the country
// decides.
export const PASS_KM = 500;

export function isPass(result, actual, precomputed = {}) {
  const hit = precomputed.hit ?? isHit(result, actual);
  if (!hit) return false;
  const d = precomputed.distanceKm !== undefined ? precomputed.distanceKm : distanceKm(result.guess, actual);
  const checkable = Boolean(normaliseName(actual.region) || normaliseName(actual.locality) || Number.isFinite(d));
  if (!checkable) return true;
  return (precomputed.regionHit ?? isRegionHit(result, actual))
    || (precomputed.localityHit ?? isLocalityHit(result, actual))
    || (Number.isFinite(d) && d <= PASS_KM);
}

/** Pass for a stored score; rounds saved before pass existed fall back to hit. */
export function scorePassed(s) {
  return Boolean(s && (s.pass ?? s.hit));
}

export function scoreRound(result, actual) {
  const hit = isHit(result, actual);
  const regionHit = isRegionHit(result, actual);
  const localityHit = isLocalityHit(result, actual);
  const distance = distanceKm(result.guess, actual);
  return {
    hit,
    pass: isPass(result, actual, { hit, regionHit, localityHit, distanceKm: distance }),
    regionHit,
    localityHit,
    distanceKm: distance,
    verdicts: scoreClues(result, actual),
  };
}
