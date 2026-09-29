import { allRounds, deleteRound } from "../lib/notebook-db.js";
import { stats } from "../lib/notebook-logic.js";
import { PROVIDER_ORDER } from "../lib/providers/index.js";
import { providerLabel } from "../lib/manual.js";
import { CATEGORIES } from "../lib/prompt.js";

// Filters persist across re-renders so re-rendering after a delete or a filter
// change keeps the controls where the user left them.
const filters = { country: "", category: "", provider: "" };

export async function renderNotebook(root, { onOpen, onDeleted }) {
  const rounds = await allRounds();
  root.innerHTML = "";

  root.append(statsCard(stats(rounds)));

  const bar = document.createElement("div");
  bar.className = "row";
  bar.style.marginBottom = "12px";
  const country = Object.assign(document.createElement("input"), {
    placeholder: "Filter by country",
    value: filters.country,
    "aria-label": "Filter rounds by country",
  });
  const category = document.createElement("select");
  category.setAttribute("aria-label", "Filter rounds by clue category");
  category.append(new Option("All categories", ""));
  for (const c of CATEGORIES) category.append(new Option(c.replace(/_/g, " "), c, false, c === filters.category));
  const provider = document.createElement("select");
  provider.setAttribute("aria-label", "Filter rounds by provider");
  provider.append(new Option("All providers", ""));
  for (const id of PROVIDER_ORDER) provider.append(new Option(providerLabel(id), id, false, id === filters.provider));

  bar.append(country, category, provider);
  root.append(bar);

  // The rounds list is the only part that changes on a filter edit; the stats
  // card and this filter bar stay mounted so the focused input never loses its
  // caret mid-type. IndexedDB is only re-read when the rounds themselves change
  // (a delete), via a full renderNotebook.
  const list = document.createElement("div");
  root.append(list);

  // A delete re-reads and re-renders everything, since stats and the round set
  // both change.
  const reload = () => renderNotebook(root, { onOpen, onDeleted });

  const renderList = () => {
    list.innerHTML = "";
    const shown = rounds.filter(matches);
    if (!shown.length) {
      list.append(Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: rounds.length ? "No rounds match the filters." : "No rounds yet. Save one from the Round tab.",
      }));
      return;
    }
    for (const round of shown) {
      list.append(roundRow(round, {
        onOpen,
        onDeleted: async () => { if (onDeleted) await onDeleted(); reload(); },
      }));
    }
  };

  const applyFilters = () => {
    filters.country = country.value;
    filters.category = category.value;
    filters.provider = provider.value;
    renderList();
  };
  country.oninput = applyFilters;
  category.onchange = applyFilters;
  provider.onchange = applyFilters;

  renderList();
}

function matches(round) {
  const q = filters.country.trim().toLowerCase();
  if (q) {
    const names = [round.actual && round.actual.country, ...round.results.map((r) => r.result && r.result.guess.country)]
      .filter(Boolean).map((s) => s.toLowerCase());
    if (!names.some((n) => n.includes(q))) return false;
  }
  if (filters.provider && !round.results.some((r) => r.provider === filters.provider)) return false;
  if (filters.category && !round.results.some((r) => r.result && r.result.clues.some((c) => c.category === filters.category))) return false;
  return true;
}

function roundRow(round, { onOpen, onDeleted }) {
  const row = document.createElement("div");
  row.className = "round-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const img = document.createElement("img");
  img.src = round.imageDataUrl;
  img.alt = round.actual ? `Round in ${round.actual.country}` : "Saved round";

  const text = document.createElement("div");
  const guesses = round.results.map((r) => r.result
    ? `${providerLabel(r.provider).split(" ")[0]}: ${r.result.guess.country}`
    : `${providerLabel(r.provider).split(" ")[0]}: error`).join(" · ");
  const when = new Date(round.ts).toLocaleString();
  let verdict = '<span class="muted">unscored</span>';
  if (round.scores) {
    const hits = Object.values(round.scores).filter((s) => s.hit).length;
    const n = Object.keys(round.scores).length;
    verdict = `<span class="${hits ? "hit" : "miss"}">${hits}/${n} hit</span> · actual ${escapeHtml(round.actual.country)}`;
  }
  text.innerHTML =
    `<div>${escapeHtml(guesses)}</div>` +
    `<div class="muted" style="font-size:12px">${escapeHtml(when)} · ${verdict}</div>`;

  // Wide-view second line: one quiet chip per distinct clue category present in
  // this round, dotted with its --c-<category> colour (hidden under 720px by CSS).
  const cats = new Set();
  for (const r of round.results) if (r.result) for (const c of r.result.clues) cats.add(c.category);
  if (cats.size) {
    const chips = document.createElement("div");
    chips.className = "round-chips";
    for (const c of CATEGORIES.filter((c) => cats.has(c))) {
      const chip = document.createElement("span");
      chip.className = "round-chip";
      chip.style.setProperty("--chip-color", `var(--c-${c})`);
      chip.textContent = c.replace(/_/g, " ");
      chips.append(chip);
    }
    text.append(chips);
  }

  const del = Object.assign(document.createElement("button"), {
    className: "secondary del",
    textContent: "✕",
    title: "Delete round",
  });
  del.setAttribute("aria-label", "Delete round");
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("Delete this round?")) return;
    await deleteRound(round.id);
    await onDeleted();
  };

  const open = () => onOpen(round);
  row.onclick = open;
  row.onkeydown = (e) => {
    if (e.target !== row) return;            // let the delete button handle its own keys
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  };

  row.append(img, text, del);
  return row;
}

function statsCard(s) {
  const card = document.createElement("div");
  card.className = "card";
  if (!s.total) {
    card.innerHTML = '<span class="muted">Stats appear once you have saved rounds with the actual location.</span>';
    return card;
  }
  const pct = (r) => `${Math.round(r * 100)}%`;

  // Category reliability: each row's meter is coloured by its own category
  // colour (the single source of truth). Percentages are always printed.
  const catRows = Object.entries(s.byCategory)
    .sort((a, b) => b[1].rate - a[1].rate)
    .map(([c, v]) => {
      // c comes from saved round data (import or manual paste), so only trust
      // it as a CSS custom-property name if it is a known category.
      const cat = CATEGORIES.includes(c) ? c : "other";
      const n = v.supporting + v.misleading;
      return `<tr>
        <td>${escapeHtml(cat.replace(/_/g, " "))}</td>
        <td>${metric(pct(v.rate), v.rate, `var(--c-${cat})`)}</td>
        <td class="muted num">${v.supporting}/${n}</td>
      </tr>`;
    }).join("");

  // Provider table: country hit rate (teal meter), region hit rate, mean
  // distance (whole km, or an en dash when unavailable), and the n counts.
  const provIds = [
    ...PROVIDER_ORDER.filter((id) => s.byProvider[id]),
    ...Object.keys(s.byProvider).filter((id) => !PROVIDER_ORDER.includes(id)),
  ];
  const provRows = provIds.map((id) => {
    const v = s.byProvider[id];
    const dist = v.meanDistanceKm == null ? "–" : `${Math.round(v.meanDistanceKm)} km`;
    const regionRate = v.rounds ? v.regionHits / v.rounds : 0;
    const townHits = v.localityHits || 0;
    const townRate = v.rounds ? townHits / v.rounds : 0;
    return `<tr>
      <td>${escapeHtml(providerLabel(id))}</td>
      <td>${metric(pct(v.rate), v.rate, "var(--accent)")}<span class="muted num n">${v.hits}/${v.rounds}</span></td>
      <td>${metric(pct(townRate), townRate, "var(--accent)")}<span class="muted num n">${townHits}/${v.rounds}</span></td>
      <td>${metric(pct(regionRate), regionRate, "var(--accent)")}<span class="muted num n">${v.regionHits}/${v.rounds}</span></td>
      <td class="num">${dist}</td>
    </tr>`;
  }).join("");

  card.innerHTML = `
    <h3 style="margin:0 0 8px">${s.total} scored round${s.total === 1 ? "" : "s"}</h3>
    <table class="stats">
      <tr><th>Clue category</th><th>Reliable</th><th>n</th></tr>
      ${catRows}
    </table>
    <table class="stats" style="margin-top:12px">
      <tr><th>Provider</th><th>Country hit</th><th>Town hit</th><th>Region hit</th><th>Mean dist</th></tr>
      ${provRows}
    </table>`;
  return card;
}

// A printed percentage with a thin reliability bar beside it. The bar is a
// recessive track with a coloured fill sized to the rate; it is secondary to
// the number (aria-hidden), so identity is never carried by colour alone.
function metric(text, rate, color) {
  const w = Math.round(Math.max(0, Math.min(1, rate)) * 100);
  return `<span class="metric"><span class="pct-num">${text}</span>` +
    `<span class="meter" aria-hidden="true"><span style="width:${w}%;background:${color}"></span></span></span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
