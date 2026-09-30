import { renderSettings } from "./ui/settings.js";
import { renderRound, renderRoundError } from "./ui/round.js";
import { renderNotebook } from "./ui/notebook.js";
import { allRounds, putRound } from "./lib/notebook-db.js";
import { feedbackLines } from "./lib/notebook-logic.js";
import { stackDataUrls } from "./lib/image.js";
import { loadSettings } from "./lib/settings.js";

const views = {
  round: document.getElementById("view-round"),
  notebook: document.getElementById("view-notebook"),
  settings: document.getElementById("view-settings"),
};

let currentRound = null;   // Round | {pending: true} | null
let heldImage = null;      // last screenshot data URL, for retry
let heldBase = null;       // main screenshot without the car view, when one was added

export async function refreshFeedback() {
  // The notebook is an optimisation, not a requirement: if IndexedDB is
  // unavailable (seen once with a profile on a temp path) the panel must still
  // capture and render, just without feedback lines.
  let lines = [];
  try {
    lines = feedbackLines(await allRounds());
  } catch (e) {
    console.warn("notebook unavailable, continuing without feedback:", e);
  }
  await chrome.storage.session.set({ lastFeedback: lines });
  return lines;
}

export function showView(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.view === name);
  for (const [k, el] of Object.entries(views)) el.classList.toggle("active", k === name);
  if (name === "settings") renderSettings(views.settings);
  if (name === "notebook") {
    renderNotebook(views.notebook, {
      onOpen: (round) => { currentRound = round; heldImage = round.imageDataUrl; heldBase = round.baseImageDataUrl || null; showView("round"); paintRound(); },
      onDeleted: () => refreshFeedback(),
    });
  }
}

function paintRound() {
  renderRound(views.round, currentRound, { onCapture: capture, onRetry: retry, onUpdate: updateRound, onCarView: addCarView });
  views.round._onSaved = () => refreshFeedback();
}

// The manual card hands back an updated round (a pasted result added, scores
// recomputed if the round is already saved). Persist it as the held round and,
// once the actual location exists, into the notebook, then re-render.
async function updateRound(updated) {
  currentRound = updated;
  heldImage = updated.imageDataUrl;
  await chrome.storage.session.set({ lastRound: updated });
  if (updated.actual) await putRound(updated);
  paintRound();
  if (updated.actual) refreshFeedback();
}

function handleReply(reply) {
  if (reply.ok) {
    // Keep the car-less screenshot so a retake replaces the car view rather
    // than stacking a third image.
    if (heldBase) {
      reply.round.baseImageDataUrl = heldBase;
      chrome.storage.session.set({ lastRound: reply.round });
    }
    currentRound = reply.round;
    heldImage = reply.round.imageDataUrl;
    paintRound();
  } else {
    currentRound = null;
    renderRoundError(views.round, reply.error, { onRetry: heldImage ? retry : capture });
  }
}

async function capture() {
  heldBase = null;
  currentRound = { pending: true };
  paintRound();
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "capture", feedback });
  handleReply(reply);
}

// The player has looked down at the Google car; screenshot it, stack it under
// the main screenshot and analyse the pair.
async function addCarView() {
  const prev = currentRound;
  const base = prev.baseImageDataUrl || prev.imageDataUrl;
  currentRound = { pending: true };
  paintRound();
  const shot = await chrome.runtime.sendMessage({ type: "captureCar" });
  if (!shot.ok) {
    currentRound = prev;
    renderRoundError(views.round, shot.error, { onRetry: () => { currentRound = prev; paintRound(); } });
    return;
  }
  const { maxEdge } = await loadSettings();
  const stacked = await stackDataUrls(base, shot.imageDataUrl, maxEdge);
  heldBase = base;
  heldImage = stacked;
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "analyse", imageDataUrl: stacked, feedback });
  handleReply(reply);
}

async function retry() {
  if (!heldImage) return capture();
  currentRound = { pending: true };
  paintRound();
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "analyse", imageDataUrl: heldImage, feedback });
  handleReply(reply);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "pending") { heldBase = null; currentRound = { pending: true }; showView("round"); paintRound(); }
  if (msg.type === "round") { showView("round"); handleReply(msg.reply); }
});

for (const b of document.querySelectorAll(".tabs button[data-view]")) b.onclick = () => showView(b.dataset.view);
document.getElementById("open-tab").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });

const { lastRound } = await chrome.storage.session.get("lastRound");
if (lastRound && !lastRound.pending) { currentRound = lastRound; heldImage = lastRound.imageDataUrl; heldBase = lastRound.baseImageDataUrl || null; }
await refreshFeedback();
showView("round");
paintRound();
