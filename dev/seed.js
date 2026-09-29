// Seeds fixture data for the preview, then boots the real panel.
import { clearRounds, importRounds } from "../lib/notebook-db.js";
import { newRound, applyActual } from "../lib/notebook-logic.js";
import { saveSettings, DEFAULT_SETTINGS } from "../lib/settings.js";

const q = new URLSearchParams(location.search);
const state = q.get("state") || "scored";   // empty | fresh | scored | error
const view = q.get("view") || "round";

// A fake Street View frame: sky, distant hills, a road with a yellow centre line,
// a pole, a bollard and a sign. Enough for the boxes to point at something.
function fakeShot(w = 1600, h = 900) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#5f8fc8"); sky.addColorStop(1, "#cfe0ee");
  g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.55);
  g.fillStyle = "#8a7b5e"; g.beginPath(); g.moveTo(0, h * 0.55);
  for (let x = 0; x <= w; x += 80) g.lineTo(x, h * 0.45 + Math.sin(x / 190) * 40 + (x / w) * 60);
  g.lineTo(w, h * 0.55); g.closePath(); g.fill();
  g.fillStyle = "#b9a37a"; g.fillRect(0, h * 0.55, w, h * 0.45);
  g.fillStyle = "#4a4a4a"; g.beginPath(); g.moveTo(w * 0.42, h * 0.55); g.lineTo(w * 0.58, h * 0.55);
  g.lineTo(w * 0.95, h); g.lineTo(w * 0.05, h); g.closePath(); g.fill();
  g.strokeStyle = "#e8c437"; g.lineWidth = 6; g.setLineDash([40, 30]);
  g.beginPath(); g.moveTo(w * 0.5, h * 0.56); g.lineTo(w * 0.5, h); g.stroke();
  g.setLineDash([]); g.strokeStyle = "#f4f4f4"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(w * 0.43, h * 0.56); g.lineTo(w * 0.08, h); g.stroke();
  g.beginPath(); g.moveTo(w * 0.57, h * 0.56); g.lineTo(w * 0.92, h); g.stroke();
  g.fillStyle = "#6b5a3e"; g.fillRect(w * 0.78, h * 0.28, 10, h * 0.34);
  g.fillStyle = "#eeeeee"; g.fillRect(w * 0.7, h * 0.6, 12, 80); g.fillStyle = "#e03b3b"; g.fillRect(w * 0.7, h * 0.62, 12, 14);
  g.fillStyle = "#1e6dd8"; g.fillRect(w * 0.2, h * 0.36, 130, 60); g.fillStyle = "#fff"; g.font = "bold 34px sans-serif"; g.fillText("Ruta 5", w * 0.21, h * 0.36 + 44);
  return c.toDataURL("image/jpeg", 0.85);
}

const result = (country, region, locality, lat, lng, conf = 0.72) => ({
  guess: { country, region, locality, lat, lng },
  confidence: conf,
  alternatives: [
    { country: "Peru", why_not: "Peruvian signs use a different blue and the plates are white on yellow" },
    { country: "Argentina", why_not: "Argentina rarely has this much bare desert beside a national route" },
  ],
  clues: [
    { id: 1, category: "road_markings", observation: "Dashed yellow centre line with solid white edge lines", inference: "Standard across the Americas; rules out most of Europe and Africa", weight: 0.28, box: { x: 0.36, y: 0.58, w: 0.3, h: 0.4 } },
    { id: 2, category: "signage_script", observation: "Blue rectangular route sign reading “Ruta 5” in white", inference: "Chilean route signage style; Ruta 5 is the Pan-American in Chile", weight: 0.24, box: { x: 0.19, y: 0.34, w: 0.1, h: 0.1 } },
    { id: 3, category: "bollards_poles", observation: "White post with a red reflector band near the top", inference: "Chilean hito style; Argentina uses a different band pattern", weight: 0.16, box: { x: 0.68, y: 0.58, w: 0.05, h: 0.14 } },
    { id: 4, category: "soil_climate", observation: "Bare tan desert, no vegetation, distant brown hills", inference: "Atacama or the arid Norte Grande", weight: 0.14, box: { x: 0, y: 0.42, w: 1, h: 0.2 } },
    { id: 5, category: "sun_shadow", observation: "Short shadow falling south of the post; compass shows camera facing north", inference: "Sun in the north means southern hemisphere, high sun means low latitude", weight: 0.1, box: { x: 0.66, y: 0.7, w: 0.09, h: 0.06 } },
    { id: 6, category: "bollards_poles", observation: "Single wooden utility pole, no cross-arm", inference: "Common in rural Chile and Argentina", weight: 0.08, box: { x: 0.77, y: 0.27, w: 0.03, h: 0.36 } },
  ],
  summary: "Yellow centre line and white edges put this in the Americas; the blue Ruta 5 sign and the red-banded white post are Chilean. Bare desert and a high northern sun put it in the Norte Grande, so a pin near Calama on Ruta 5.",
});

async function seed() {
  await clearRounds();
  await saveSettings({ ...DEFAULT_SETTINGS, manual: false, providers: { ...DEFAULT_SETTINGS.providers, openai: { ...DEFAULT_SETTINGS.providers.openai, key: "sk-preview" } } });
  const shot = fakeShot();
  const rounds = [];
  const mk = (ts, res, actual, provider = "openai") => {
    let r = { ...newRound(shot, [{ provider, model: provider === "manual" ? "pasted" : "gpt-5", result: res, error: null }]), ts };
    if (actual) r = applyActual(r, actual);
    return r;
  };
  const now = Date.now();
  rounds.push(mk(now - 1 * 3.6e6, result("Chile", "Antofagasta", "Calama", -22.46, -68.92), { country: "Chile", region: "Antofagasta", locality: "Calama", lat: -22.9, lng: -68.2 }));
  rounds.push(mk(now - 5 * 3.6e6, result("Chile", "Atacama", "Copiapó", -27.37, -70.33, 0.55), { country: "Argentina", region: "Salta", locality: "Cafayate", lat: -26.07, lng: -65.98 }, "manual"));
  rounds.push(mk(now - 26 * 3.6e6, result("Peru", "Arequipa", "Arequipa", -16.4, -71.54, 0.61), { country: "Peru", region: "Moquegua", locality: "Moquegua", lat: -17.19, lng: -70.93 }));
  rounds.push(mk(now - 50 * 3.6e6, result("Bolivia", "Potosí", "Uyuni", -20.46, -66.83, 0.4), { country: "Bolivia", region: "Potosí", locality: "Uyuni", lat: -20.46, lng: -66.83 }, "manual"));
  await importRounds(rounds);

  // What the Round view shows on load
  if (state === "scored") await chrome.storage.session.set({ lastRound: rounds[0] });
  if (state === "fresh") await chrome.storage.session.set({ lastRound: mk(now, result("Chile", "Antofagasta", "Calama", -22.46, -68.92), null) });
  if (state === "error") await chrome.storage.session.set({ lastRound: { ...newRound(shot, [{ provider: "openai", model: "gpt-5", result: null, error: { code: "no_key", message: "No API key set for GPT (OpenAI)", raw: null } }]) } });
  window.__previewCaptureReply = () => ({ ok: true, round: mk(Date.now(), result("Chile", "Antofagasta", "Calama", -22.46, -68.92), null) });
}

await seed();
await import("../sidepanel.js").then((m) => { if (view !== "round") m.showView(view); });

// ?pin=N clicks clue N so the pinned highlight can be screenshotted.
const pin = q.get("pin");
if (pin) setTimeout(() => { const rows = document.querySelectorAll(".clue"); rows[Number(pin) - 1]?.click(); }, 300);
