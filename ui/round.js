import { applyActual } from "../lib/notebook-logic.js";
import { putRound } from "../lib/notebook-db.js";
import { parseActualInput } from "../lib/geo.js";
import { PROVIDERS } from "../lib/providers/index.js";
import { COVERAGE_COUNTRIES } from "../lib/countries.js";

const ERROR_TEXT = {
  no_key: "No API key for this provider. Add one in Settings.",
  key_rejected: "The API key was rejected. Check it in Settings.",
  rate_limited: "Rate limited. Wait a moment and retry.",
  server: "The provider returned an error.",
  network: "Could not reach the provider.",
  unparseable: "The model's answer could not be read as a result.",
  refusal: "The model declined to answer.",
  capture: "Could not capture the tab.",
  unknown: "Something went wrong.",
};

export function renderRoundError(root, error, { onRetry }) {
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "error";
  box.textContent = `${ERROR_TEXT[error.code] || ERROR_TEXT.unknown} ${error.message || ""}`.trim();
  root.append(box);
  if (error.raw) {
    const pre = document.createElement("pre");
    pre.className = "muted";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = String(error.raw).slice(0, 2000);
    root.append(pre);
  }
  if (onRetry) root.append(actionButton("Retry", onRetry));
}

export function renderRound(root, round, { onCapture, onRetry }) {
  root.innerHTML = "";
  const top = document.createElement("div");
  top.className = "row";
  top.style.marginBottom = "12px";
  top.append(actionButton("Capture & analyse (Alt+G)", onCapture));
  root.append(top);

  if (!round) {
    root.append(p("muted", "Press Alt+G on a GeoGuessr round, or use the button above."));
    return;
  }
  if (round.pending) {
    root.append(p("muted", "Analysing…"));
    return;
  }

  // Wide (>=720px): two columns — sticky screenshot left (capped 60%), results
  // right. Narrow: this grid collapses to a single column (see CSS).
  const grid = document.createElement("div");
  grid.className = "round-grid";
  const shotCol = document.createElement("div");
  shotCol.className = "shot-col";
  const mainCol = document.createElement("div");
  mainCol.className = "main-col";
  grid.append(shotCol, mainCol);
  root.append(grid);

  const shot = document.createElement("div");
  shot.className = "shot";
  const img = document.createElement("img");
  img.src = round.imageDataUrl;
  img.alt = "Captured GeoGuessr round";
  shot.append(img);
  shotCol.append(shot);

  const columns = document.createElement("div");
  columns.className = "columns";
  mainCol.append(columns);

  // First provider that produced a result owns the boxes shown by default.
  const firstOk = round.results.find((r) => !r.error && r.result);
  const boxesByProvider = {};

  const showOnly = (provider) => {
    for (const [prov, els] of Object.entries(boxesByProvider)) {
      for (const b of els) b.style.display = prov === provider ? "" : "none";
    }
  };
  const multi = round.results.filter((r) => !r.error && r.result).length > 1;

  for (const r of round.results) {
    const col = document.createElement("div");
    col.className = "card";
    const h = document.createElement("h3");
    h.style.margin = "0 0 6px";
    h.textContent = `${PROVIDERS[r.provider].label} · ${r.model}`;
    col.append(h);
    if (r.error) {
      const holder = document.createElement("div");
      renderRoundError(holder, r.error, { onRetry });
      col.append(holder);
    } else {
      const visible = firstOk && r.provider === firstOk.provider;
      boxesByProvider[r.provider] = drawBoxes(shot, r.result, visible);
      col.append(...resultBody(r, round, boxesByProvider[r.provider]));
      // With more than one provider, the boxes on the shared screenshot follow
      // whichever provider card the pointer is over.
      if (multi) col.onmouseenter = () => showOnly(r.provider);
    }
    columns.append(col);
  }
  // Leaving the results area restores the default provider's boxes.
  if (multi && firstOk) columns.onmouseleave = () => showOnly(firstOk.provider);

  mainCol.append(actualForm(round, async (updated) => {
    await putRound(updated);
    renderRound(root, updated, { onCapture, onRetry });
    if (root._onSaved) root._onSaved(updated);
  }));
}

function drawBoxes(shot, result, visible) {
  const els = [];
  for (const c of result.clues) {
    const b = document.createElement("div");
    b.className = "box";
    b.style.setProperty("--box-color", `var(--c-${c.category})`);
    b.style.left = `${c.box.x * 100}%`;
    b.style.top = `${c.box.y * 100}%`;
    b.style.width = `${c.box.w * 100}%`;
    b.style.height = `${c.box.h * 100}%`;
    b.style.display = visible ? "" : "none";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = String(c.id);
    b.append(tag);
    shot.append(b);
    els.push(b);
  }
  return els;
}

function resultBody(r, round, boxEls) {
  const res = r.result;
  const out = [];

  const guess = document.createElement("div");
  const place = [res.guess.country, res.guess.region].filter(Boolean).join(", ");
  guess.innerHTML = `<strong>${escapeHtml(place)}</strong> <span class="muted">${Math.round(res.confidence * 100)}% confident</span>`;
  out.push(guess);

  if (res.guess.locality) out.push(p("muted", res.guess.locality));

  if (Number.isFinite(res.guess.lat) && Number.isFinite(res.guess.lng)) {
    const coords = document.createElement("p");
    coords.className = "muted";
    const span = document.createElement("span");
    span.className = "coord";
    span.textContent = `${res.guess.lat.toFixed(3)}, ${res.guess.lng.toFixed(3)}`;
    const link = document.createElement("a");
    link.href = `https://www.google.com/maps?q=${res.guess.lat},${res.guess.lng}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "maps-link";
    link.textContent = "Open in Google Maps";
    coords.append(span, document.createTextNode(" "), link);
    out.push(coords);
  }

  const score = round.scores && round.scores[r.provider];
  if (score) {
    out.push(p(score.hit ? "hit" : "miss", score.hit ? "Correct country" : `Wrong: it was ${round.actual.country}`));
    if (Number.isFinite(score.distanceKm)) {
      const km = score.distanceKm < 10 ? score.distanceKm.toFixed(1) : String(Math.round(score.distanceKm));
      out.push(p("muted", `${km} km away`));
    }
    if (round.actual.region) {
      out.push(p(score.regionHit ? "hit" : "miss", score.regionHit ? "Region: correct" : "Region: wrong"));
    }
  }

  const list = document.createElement("div");
  res.clues.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "clue";
    row.tabIndex = 0;
    row.style.setProperty("--box-color", `var(--c-${c.category})`);
    const verdict = score && score.verdicts.find((v) => v.id === c.id);
    row.innerHTML = `
      <div class="num">${c.id}</div>
      <div>
        <div class="cat">${c.category.replace(/_/g, " ")}${verdict ? ` · <span class="verdict-${verdict.verdict}">${verdict.verdict}</span>` : ""}</div>
        <div>${escapeHtml(c.observation)}</div>
        <div class="muted">${escapeHtml(c.inference)}</div>
        <div class="bar" style="width:${Math.max(2, c.weight * 100)}%"></div>
      </div>
      <div class="pct">${Math.round(c.weight * 100)}%</div>`;
    const activate = (on) => {
      row.classList.toggle("active", on);
      boxEls[i].classList.toggle("active", on);
      boxEls.forEach((b) => { b.style.display = ""; });
    };
    row.onmouseenter = () => activate(true);
    row.onmouseleave = () => activate(false);
    row.onclick = () => activate(!row.classList.contains("active"));
    row.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(!row.classList.contains("active"));
      }
    };
    boxEls[i].onclick = () => row.scrollIntoView({ behavior: "smooth", block: "center" });
    list.append(row);
  });
  out.push(list);

  out.push(p("summary", res.summary));
  if (res.alternatives.length) {
    const alt = document.createElement("div");
    alt.className = "muted";
    alt.innerHTML = "<strong>Also considered:</strong> " + res.alternatives
      .map((a) => `${escapeHtml(a.country)} (${escapeHtml(a.why_not)})`).join("; ");
    out.push(alt);
  }
  return out;
}

function actualForm(round, onSave) {
  const card = document.createElement("div");
  card.className = "card";
  if (round.actual) {
    const a = round.actual;
    card.innerHTML = `<strong>Actual:</strong> ${escapeHtml([a.country, a.region].filter(Boolean).join(", "))}`
      + (a.lat != null ? ` <span class="muted coord">(${a.lat}, ${a.lng})</span>` : "")
      + ' <span class="muted">· saved to notebook</span>';
    return card;
  }
  card.innerHTML = `
    <h3 style="margin:0 0 6px">What was it actually?</h3>
    <label for="act-country">Country</label><input id="act-country" list="country-list" placeholder="e.g. Peru">
    <label for="act-region">Region (optional)</label><input id="act-region" placeholder="e.g. Arequipa">
    <label for="act-coords">Coordinates (optional)</label><input id="act-coords" placeholder="lat, lng">
    <p class="error" id="act-err" hidden></p>`;

  // Country suggestions from the coverage list; free text is still allowed.
  const datalist = document.createElement("datalist");
  datalist.id = "country-list";
  for (const name of COVERAGE_COUNTRIES) {
    const opt = document.createElement("option");
    opt.value = name;
    datalist.append(opt);
  }
  card.append(datalist);

  const save = actionButton("Save round", async () => {
    const err = card.querySelector("#act-err");
    try {
      const actual = parseActualInput(
        card.querySelector("#act-country").value,
        card.querySelector("#act-region").value,
        card.querySelector("#act-coords").value,
      );
      await onSave(applyActual(round, actual));
    } catch (e) {
      err.textContent = e.message.replace(/^actual: /, "");
      err.hidden = false;
    }
  });
  save.style.marginTop = "10px";
  card.append(save);
  return card;
}

function actionButton(text, onclick) {
  return Object.assign(document.createElement("button"), { className: "primary", textContent: text, onclick });
}
function p(cls, text) {
  const el = document.createElement("p");
  el.className = cls;
  el.textContent = text;
  return el;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
