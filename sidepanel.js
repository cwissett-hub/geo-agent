import { renderSettings } from "./ui/settings.js";
import { allRounds } from "./lib/notebook-db.js";
import { feedbackLines } from "./lib/notebook-logic.js";

const views = {
  round: document.getElementById("view-round"),
  notebook: document.getElementById("view-notebook"),
  settings: document.getElementById("view-settings"),
};

export async function refreshFeedback() {
  const lines = feedbackLines(await allRounds());
  await chrome.storage.session.set({ lastFeedback: lines });
  return lines;
}

export function showView(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.view === name);
  for (const [k, el] of Object.entries(views)) el.classList.toggle("active", k === name);
  if (name === "settings") renderSettings(views.settings);
  if (name === "notebook" && window.renderNotebookView) window.renderNotebookView(views.notebook);
}

for (const b of document.querySelectorAll(".tabs button[data-view]")) b.onclick = () => showView(b.dataset.view);
document.getElementById("open-tab").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });

views.round.innerHTML = '<p class="muted">Round view arrives in the next task.</p>';
await refreshFeedback();
showView("round");
