import { applyActual } from "../lib/notebook-logic.js";
import { putRound } from "../lib/notebook-db.js";
import { parseActualInput } from "../lib/geo.js";
import { COVERAGE_COUNTRIES } from "../lib/countries.js";
import { manualPrompt, parsePastedReply, manualResultEntry, providerLabel } from "../lib/manual.js";
import { CATEGORIES } from "../lib/prompt.js";

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

export function renderRound(root, round, { onCapture, onRetry, onUpdate }) {
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
    h.textContent = `${providerLabel(r.provider)} · ${r.model}`;
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

  // Manual mode: usable whenever there is a screenshot, including when every
  // API result errored (no key, or a failed call — the main use case).
  if (round.imageDataUrl) {
    // rerender persists the updated round and re-renders. sidepanel.js supplies
    // onUpdate (updates currentRound, writes session lastRound, and putRound
    // when the round is already saved); the local fallback just re-renders.
    const rerender = onUpdate
      ? onUpdate
      : (updated) => renderRound(root, updated, { onCapture, onRetry, onUpdate });
    mainCol.append(manualCard(round, rerender));
  }

  mainCol.append(actualForm(round, async (updated) => {
    await putRound(updated);
    renderRound(root, updated, { onCapture, onRetry, onUpdate });
    if (root._onSaved) root._onSaved(updated);
  }));
}

function manualCard(round, rerender) {
  const card = document.createElement("div");
  card.className = "card manual";
  card.innerHTML = `
    <h3>Manual mode</h3>
    <p class="muted">No API key, or the call failed? Copy the image and the prompt, paste both into any chat model, then paste its reply below. "Copy image" also carries the prompt text; some chats take both in one paste, most need "Copy prompt" as a second paste.</p>
    <div class="row">
      <button class="secondary" data-act="copy-image">Copy image</button>
      <button class="secondary" data-act="copy-prompt">Copy prompt</button>
    </div>
    <label for="manual-reply">Paste the reply here</label>
    <textarea id="manual-reply" rows="5" placeholder='{"guess": {...}, "clues": [...], ...}'></textarea>
    <p class="error" id="manual-err" hidden></p>`;
  const flash = (btn, text) => { const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 1200); };

  const promptText = async () => {
    const { lastFeedback } = await chrome.storage.session.get("lastFeedback");
    return manualPrompt(lastFeedback || []);
  };
  // One clipboard item with two representations: the PNG and the prompt as
  // text/plain. A chat box that reads both gets everything in one paste; one
  // that only takes the image still works, with Copy prompt as the second step.
  card.querySelector('[data-act="copy-image"]').onclick = async (e) => {
    try {
      const blob = await dataUrlToPngBlob(round.imageDataUrl);
      const text = new Blob([await promptText()], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob, "text/plain": text })]);
      flash(e.target, "Copied");
    } catch (err) {
      flash(e.target, `Failed: ${err.message}`);
    }
  };
  card.querySelector('[data-act="copy-prompt"]').onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(await promptText());
      flash(e.target, "Copied");
    } catch (err) {
      flash(e.target, `Failed: ${err.message}`);
    }
  };
  const use = actionButton("Use reply", () => {
    const err = card.querySelector("#manual-err");
    try {
      const result = parsePastedReply(card.querySelector("#manual-reply").value);
      const results = round.results.filter((r) => r.provider !== "manual").concat(manualResultEntry(result));
      let updated = { ...round, results };
      if (round.actual) updated = applyActual(updated, round.actual);
      rerender(updated);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });
  use.style.marginTop = "8px";
  card.append(use);
  return card;
}

async function dataUrlToPngBlob(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("could not decode image")); img.src = dataUrl; });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
}

// category is stored in IndexedDB and can arrive from an imported file or a
// manually-pasted reply; only trust it enough to pick a CSS custom-property
// name or render it as text if it is one of the known categories.
function safeCategory(category) {
  return CATEGORIES.includes(category) ? category : "other";
}

function drawBoxes(shot, result, visible) {
  const els = [];
  for (const c of result.clues) {
    const b = document.createElement("div");
    b.className = "box";
    b.style.setProperty("--box-color", `var(--c-${safeCategory(c.category)})`);
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

  // The guess is the hero of the card: big GeoGuessr-style place name, region
  // beneath, confidence as a quiet pill.
  const guess = document.createElement("div");
  guess.className = "guess-head";
  guess.innerHTML = `
    <div class="guess-country">${escapeHtml(res.guess.country)}</div>
    <div class="guess-meta">${res.guess.region ? `<span>${escapeHtml(res.guess.region)}</span>` : ""}<span class="pill">${Math.round(res.confidence * 100)}% confident</span></div>`;
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
    // Round result strip: distance as the big number (GeoGuessr scores by
    // distance), then one chip per thing we could check.
    const strip = document.createElement("div");
    strip.className = "result-strip";
    if (Number.isFinite(score.distanceKm)) {
      const km = score.distanceKm < 10 ? score.distanceKm.toFixed(1) : String(Math.round(score.distanceKm));
      const d = document.createElement("div");
      d.className = "distance";
      d.innerHTML = `<span class="km">${km}</span><span class="unit">km away</span>`;
      strip.append(d);
    }
    const chips = document.createElement("div");
    chips.className = "chips";
    const chip = (ok, okText, badText) => {
      const s = document.createElement("span");
      s.className = `chip ${ok ? "chip-hit" : "chip-miss"}`;
      s.textContent = ok ? okText : badText;
      return s;
    };
    chips.append(chip(score.hit, "Country", `Country: ${round.actual.country}`));
    if (round.actual.locality) chips.append(chip(score.localityHit, "Town", `Town: ${round.actual.locality}`));
    if (round.actual.region) chips.append(chip(score.regionHit, "Region", `Region: ${round.actual.region}`));
    strip.append(chips);
    out.push(strip);
  }

  const list = document.createElement("div");
  res.clues.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "clue";
    row.tabIndex = 0;
    const category = safeCategory(c.category);
    row.style.setProperty("--box-color", `var(--c-${category})`);
    const verdict = score && score.verdicts.find((v) => v.id === c.id);
    row.innerHTML = `
      <div class="num">${c.id}</div>
      <div>
        <div class="cat">${escapeHtml(category.replace(/_/g, " "))}${verdict ? ` <span class="verdict verdict-${verdict.verdict}">${verdict.verdict}</span>` : ""}</div>
        <div>${escapeHtml(c.observation)}</div>
        <div class="muted">${escapeHtml(c.inference)}</div>
        <div class="bar" style="width:${Math.max(2, c.weight * 100)}%"></div>
      </div>
      <div class="pct">${Math.round(c.weight * 100)}%</div>`;
    // Hover gives a transient highlight; a click pins one clue (row and box
    // together) and dims the other boxes so it stands out on the image.
    // Clicking the pinned clue again, on either side, unpins it.
    const box = boxEls[i];
    const shotEl = box.parentElement;
    const hover = (on) => {
      row.classList.toggle("active", on);
      box.classList.toggle("active", on);
      boxEls.forEach((b) => { b.style.display = ""; });
    };
    const setPinned = (on) => {
      list.querySelectorAll(".clue.pinned").forEach((el) => el.classList.remove("pinned"));
      boxEls.forEach((b) => b.classList.remove("pinned"));
      shotEl.classList.toggle("has-pinned", on);
      if (on) { row.classList.add("pinned"); box.classList.add("pinned"); }
    };
    const toggle = () => setPinned(!row.classList.contains("pinned"));
    row.onmouseenter = () => hover(true);
    row.onmouseleave = () => hover(false);
    row.onclick = toggle;
    row.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    };
    box.onmouseenter = () => hover(true);
    box.onmouseleave = () => hover(false);
    box.onclick = (e) => {
      e.stopPropagation();
      toggle();
      if (row.classList.contains("pinned")) row.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    list.append(row);
  });
  out.push(list);

  out.push(p("summary", res.summary));
  if (res.alternatives.length) {
    // Rejected alternatives as chips; the reason shows on hover and as a
    // second line, so nothing is hidden from keyboard or touch users.
    const alt = document.createElement("div");
    alt.className = "alternatives";
    alt.innerHTML = `<div class="muted alt-label">Also considered</div>` + res.alternatives
      .map((a) => `<div class="alt"><span class="chip chip-alt" title="${escapeHtml(a.why_not)}">${escapeHtml(a.country)}</span><span class="muted alt-why">${escapeHtml(a.why_not)}</span></div>`).join("");
    out.push(alt);
  }
  return out;
}

function actualForm(round, onSave) {
  const card = document.createElement("div");
  card.className = "card";
  if (round.actual) {
    const a = round.actual;
    card.innerHTML = `<strong>Actual:</strong> ${escapeHtml([a.country, a.region, a.locality].filter(Boolean).join(", "))}`
      + (a.lat != null ? ` <span class="muted coord">(${a.lat}, ${a.lng})</span>` : "")
      + ' <span class="muted">· saved to notebook</span>';
    return card;
  }
  card.innerHTML = `
    <h3 style="margin:0 0 6px">What was it actually?</h3>
    <label for="act-country">Country</label><input id="act-country" list="country-list" placeholder="e.g. Peru">
    <label for="act-town">Nearest large town (optional)</label><input id="act-town" placeholder="e.g. Arequipa">
    <label for="act-region">Region (optional)</label><input id="act-region" placeholder="e.g. Arequipa Region">
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
        card.querySelector("#act-town").value,
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
