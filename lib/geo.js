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
