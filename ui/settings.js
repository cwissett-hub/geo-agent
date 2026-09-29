import { loadSettings, saveSettings } from "../lib/settings.js";
import { PROVIDERS, PROVIDER_ORDER } from "../lib/providers/index.js";
import { allRounds, clearRounds, importRounds } from "../lib/notebook-db.js";
import { serialiseRounds, parseImport } from "../lib/notebook-logic.js";
import { refreshFeedback } from "../sidepanel.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export async function renderSettings(root) {
  const s = await loadSettings();
  root.innerHTML = "";

  const general = card("General");
  general.append(
    checkbox("manual", "Manual mode: capture only, no API call. Copy the image and prompt into a chat, paste the reply back.", s.manual),
    field("Active provider", select("active", PROVIDER_ORDER.map((id) => [id, PROVIDERS[id].label]), s.active)),
    checkbox("askAll", "Ask every enabled provider with a key (side by side)", s.askAll),
    field("Claude effort", select("effort", EFFORTS.map((e) => [e, e]), s.effort)),
  );
  root.append(general);

  for (const id of PROVIDER_ORDER) {
    const p = s.providers[id];
    const c = card(PROVIDERS[id].label);
    const fields = document.createElement("div");
    fields.className = "fields";
    fields.append(
      field("API key", input(`key-${id}`, p.key, PROVIDERS[id].keyHint, "password")),
      field("Model", input(`model-${id}`, p.model, PROVIDERS[id].defaultModel)),
    );
    c.append(checkbox(`enabled-${id}`, "Enabled", p.enabled), fields);
    root.append(c);
  }

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save settings";
  save.onclick = async () => {
    const next = {
      manual: root.querySelector("#manual").checked,
      active: root.querySelector("#active").value,
      askAll: root.querySelector("#askAll").checked,
      effort: root.querySelector("#effort").value,
      providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
        enabled: root.querySelector(`#enabled-${id}`).checked,
        key: root.querySelector(`#key-${id}`).value.trim(),
        model: root.querySelector(`#model-${id}`).value.trim() || PROVIDERS[id].defaultModel,
      }])),
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
