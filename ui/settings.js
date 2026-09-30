import { loadSettings, saveSettings } from "../lib/settings.js";
import { PROVIDERS, PROVIDER_ORDER } from "../lib/providers/index.js";
import { allRounds, clearRounds, importRounds } from "../lib/notebook-db.js";
import { serialiseRounds, parseImport } from "../lib/notebook-logic.js";
import { refreshFeedback } from "../sidepanel.js";
import { COVERAGE_COUNTRIES, normaliseCountries } from "../lib/countries.js";
import { IMAGE_SIZES } from "../lib/image.js";


export async function renderSettings(root) {
  const s = await loadSettings();
  root.innerHTML = "";

  const general = card("General");
  general.append(
    checkbox("manual", "Manual mode: capture only, no API call. Copy the image and prompt into a chat, paste the reply back.", s.manual),
    field("Active provider", select("active", PROVIDER_ORDER.map((id) => [id, PROVIDERS[id].label]), s.active)),
    checkbox("askAll", "Ask every enabled provider with a key (side by side)", s.askAll),
    // Smaller images are sent and read faster; the cost is fine detail on
    // distant signs and bollards.
    field("Image size (smaller is faster)", select("maxEdge", IMAGE_SIZES.map((n) => [String(n), `${n} px`]), String(s.maxEdge))),
  );
  root.append(general);

  const countries = countriesCard(s.countries);
  root.append(countries.card);

  for (const id of PROVIDER_ORDER) {
    const p = s.providers[id];
    const c = card(PROVIDERS[id].label);
    const fields = document.createElement("div");
    fields.className = "fields";
    fields.append(
      field("API key", input(`key-${id}`, p.key, PROVIDERS[id].keyHint, "password")),
      field("Model", input(`model-${id}`, p.model, PROVIDERS[id].defaultModel)),
    );
    // Effort only where the provider has such a control, with its own options.
    const opts = PROVIDERS[id].effortOptions;
    if (PROVIDERS[id].defaultBaseUrl) {
      fields.append(field("Server URL", input(`baseUrl-${id}`, p.baseUrl || PROVIDERS[id].defaultBaseUrl, PROVIDERS[id].defaultBaseUrl)));
    }
    if (opts) {
      fields.append(field("Effort", select(`effort-${id}`, opts.map((e) => [e, e]), p.effort || PROVIDERS[id].defaultEffort)));
    }
    c.append(checkbox(`enabled-${id}`, "Enabled", p.enabled), fields);
    if (id === "local") {
      c.append(p_("muted", "Any OpenAI-compatible server with a vision model: Ollama (http://localhost:11434/v1, e.g. qwen2.5vl:7b or gemma3), LM Studio (http://localhost:1234/v1), llama.cpp, vLLM. No key needed. If Ollama answers 403, set OLLAMA_ORIGINS=chrome-extension://* and restart it."));
    }
    root.append(c);
  }

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save settings";
  save.onclick = async () => {
    const chosen = countries.read();
    if (chosen && !chosen.length) {
      save.textContent = "Pick at least one country";
      setTimeout(() => { save.textContent = "Save settings"; }, 2000);
      return;
    }
    const next = {
      countries: chosen,
      maxEdge: Number(root.querySelector("#maxEdge").value),
      manual: root.querySelector("#manual").checked,
      active: root.querySelector("#active").value,
      askAll: root.querySelector("#askAll").checked,
      providers: Object.fromEntries(PROVIDER_ORDER.map((id) => {
        const effortEl = root.querySelector(`#effort-${id}`);
        const baseEl = root.querySelector(`#baseUrl-${id}`);
        return [id, {
          enabled: root.querySelector(`#enabled-${id}`).checked,
          key: root.querySelector(`#key-${id}`).value.trim(),
          model: root.querySelector(`#model-${id}`).value.trim() || PROVIDERS[id].defaultModel,
          effort: effortEl ? effortEl.value : null,
          baseUrl: baseEl ? baseEl.value.trim() || PROVIDERS[id].defaultBaseUrl : null,
        }];
      })),
    };
    // First key saved for the active provider: leave manual mode automatically.
    const hadKey = Boolean(s.providers[next.active] && s.providers[next.active].key);
    const hasKey = Boolean(next.providers[next.active].key);
    let note = "Saved";
    if (next.manual && !hadKey && hasKey) {
      next.manual = false;
      root.querySelector("#manual").checked = false;
      note = "Saved, manual mode off";
    }
    await saveSettings(next);
    Object.assign(s, next);
    save.textContent = note;
    setTimeout(() => { save.textContent = "Save settings"; }, 1600);
  };
  root.append(save);

  const nb = card("Notebook");
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Shortcut: Alt+G captures and analyses the current tab. Change it at chrome://extensions/shortcuts.";
  const exportBtn = button("secondary", "Export JSON", async () => {
    const text = serialiseRounds(await allRounds());
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `geo-meta-notebook-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  });
  const importInput = Object.assign(document.createElement("input"), { type: "file", accept: "application/json", hidden: true });
  importInput.onchange = async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const rounds = parseImport(await file.text());
      await importRounds(rounds);
      await refreshFeedback();
      status.textContent = `Imported ${rounds.length} rounds.`;
    } catch (e) {
      status.textContent = e.message;
    }
    importInput.value = "";
  };
  const importBtn = button("secondary", "Import JSON", () => importInput.click());
  const clearBtn = button("secondary", "Clear notebook", async () => {
    if (!confirm("Delete every saved round? This cannot be undone.")) return;
    await clearRounds();
    await refreshFeedback();
    status.textContent = "Notebook cleared.";
  });
  const status = document.createElement("p");
  status.className = "muted";
  const row = document.createElement("div");
  row.className = "row";
  row.append(exportBtn, importBtn, clearBtn, importInput);
  nb.append(hint, row, status);
  root.append(nb);
}

// Countries the model may answer with. Every coverage country plus any the
// user added, as a filterable checkbox grid. read() returns null when the
// selection is exactly the built-in list (so future list edits apply), else
// the chosen names.
function countriesCard(saved) {
  const c = card("Countries");
  const hint = p_("muted", "The model may only guess ticked countries. Untick those your map leaves out; add any GeoGuessr has added since. Unticking an added country removes it.");
  const selected = new Set(saved && saved.length ? saved : COVERAGE_COUNTRIES);
  let names = normaliseCountries([...COVERAGE_COUNTRIES, ...selected]);

  const filter = input("country-filter", "", "Filter countries");
  const count = p_("muted", "");
  const grid = document.createElement("div");
  grid.className = "country-grid";

  const paint = () => {
    grid.innerHTML = "";
    const q = filter.value.trim().toLowerCase();
    for (const name of names) {
      if (q && !name.toLowerCase().includes(q)) continue;
      const l = document.createElement("label");
      l.className = "country";
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: selected.has(name) });
      cb.onchange = () => { if (cb.checked) selected.add(name); else selected.delete(name); counted(); };
      l.append(cb, document.createTextNode(name));
      grid.append(l);
    }
    counted();
  };
  const counted = () => { count.textContent = `${selected.size} of ${names.length} ticked`; };
  const visible = () => names.filter((n) => !filter.value.trim() || n.toLowerCase().includes(filter.value.trim().toLowerCase()));
  filter.oninput = paint;

  const bar = document.createElement("div");
  bar.className = "row";
  bar.append(
    button("secondary", "Tick all", () => { for (const n of visible()) selected.add(n); paint(); }),
    button("secondary", "Untick all", () => { for (const n of visible()) selected.delete(n); paint(); }),
    button("secondary", "Reset", () => { selected.clear(); for (const n of COVERAGE_COUNTRIES) selected.add(n); names = [...COVERAGE_COUNTRIES]; filter.value = ""; paint(); }),
  );

  const addInput = input("country-add", "", "Add a country, e.g. Vanuatu");
  const add = () => {
    const name = addInput.value.trim();
    if (!name) return;
    const existing = names.find((n) => n.toLowerCase() === name.toLowerCase());
    selected.add(existing || name);
    names = normaliseCountries([...names, name]);
    addInput.value = "";
    paint();
  };
  addInput.onkeydown = (e) => { if (e.key === "Enter") add(); };
  const addRow = document.createElement("div");
  addRow.className = "row";
  addRow.append(addInput, button("secondary", "Add", add));

  c.append(hint, bar, filter, grid, count, addRow);
  paint();

  const read = () => {
    const chosen = normaliseCountries(names.filter((n) => selected.has(n)));
    const builtIn = chosen.length === COVERAGE_COUNTRIES.length && COVERAGE_COUNTRIES.every((n) => selected.has(n));
    return builtIn ? null : chosen;
  };
  return { card: c, read };
}

function p_(cls, text) {
  const el = document.createElement("p");
  el.className = cls;
  el.textContent = text;
  return el;
}

function card(title) {
  const c = document.createElement("div");
  c.className = "card";
  const h = document.createElement("h3");
  h.textContent = title;
  h.style.margin = "0 0 8px";
  c.append(h);
  return c;
}
function field(labelText, control) {
  const wrap = document.createElement("div");
  const l = document.createElement("label");
  l.textContent = labelText;
  l.htmlFor = control.id;
  wrap.append(l, control);
  return wrap;
}
function input(id, value, placeholder = "", type = "text") {
  return Object.assign(document.createElement("input"), { id, value, placeholder, type, autocomplete: "off" });
}
function select(id, options, value) {
  const s = document.createElement("select");
  s.id = id;
  for (const [v, label] of options) s.append(new Option(label, v, false, v === value));
  return s;
}
function checkbox(id, labelText, checked) {
  const wrap = document.createElement("label");
  wrap.className = "row";
  wrap.style.color = "var(--text)";
  const cb = Object.assign(document.createElement("input"), { type: "checkbox", id, checked });
  cb.style.width = "auto";
  wrap.append(cb, document.createTextNode(labelText));
  return wrap;
}
function button(cls, text, onclick) {
  return Object.assign(document.createElement("button"), { className: cls, textContent: text, onclick });
}
