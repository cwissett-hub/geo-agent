export function parseActualInput(countryText, regionText, coordsText, townText) {
  const country = String(countryText ?? "").trim();
  if (!country) throw new Error("actual: country is required");
  const region = String(regionText ?? "").trim() || null;
  const locality = String(townText ?? "").trim() || null;
  let lat = null, lng = null;
  const coords = String(coordsText ?? "").trim();
  if (coords) {
    const m = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/.exec(coords);
    if (!m) throw new Error("actual: coordinates must be lat, lng");
    lat = Number(m[1]); lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("actual: coordinates out of range");
  }
  return { country, region, locality, lat, lng };
}

const MIN_HALF_LAT = 4;
const MIN_HALF_LNG = 6;

/**
 * Bounding box for the map under a guess: centred on the guess with room to
 * see the surrounding region, widened to include the actual location when it
 * has coordinates (so both fit in view).
 */
export function mapBbox(guess, actual = null) {
  const pts = [guess];
  if (actual && Number.isFinite(actual.lat) && Number.isFinite(actual.lng)) pts.push(actual);
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const halfLat = Math.max(MIN_HALF_LAT, (Math.max(...lats) - Math.min(...lats)) / 2 * 1.3);
  const halfLng = Math.max(MIN_HALF_LNG, (Math.max(...lngs) - Math.min(...lngs)) / 2 * 1.3);
  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
  return {
    minLng: clamp(cLng - halfLng, 180), minLat: clamp(cLat - halfLat, 85),
    maxLng: clamp(cLng + halfLng, 180), maxLat: clamp(cLat + halfLat, 85),
  };
}

/** OpenStreetMap embed URL with a marker on the guess. */
export function osmEmbedUrl(guess, actual = null) {
  const b = mapBbox(guess, actual);
  const f = (n) => n.toFixed(4);
  const bbox = [b.minLng, b.minLat, b.maxLng, b.maxLat].map(f).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${f(guess.lat)},${f(guess.lng)}`;
}
