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
let car = { open: false, shots: { front: null, back: null } }; // car-view shots being collected

function resetCar() {
  car = { open: false, shots: { front: null, back: null } };
  chrome.storage.session.remove("carShots");
}
// Car shots live in session storage too: the keyboard shortcuts capture them
// in the background, possibly before this panel has finished opening.
function setCarShot(side, imageDataUrl) {
  car.open = true;
  car.shots[side] = imageDataUrl;
  chrome.storage.session.set({ carShots: { ...car.shots } });
}

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
      onOpen: (round) => { currentRound = round; heldImage = round.imageDataUrl; heldBase = round.baseImageDataUrl || null; resetCar(); showView("round"); paintRound(); },
      onDeleted: () => refreshFeedback(),
    });
  }
}

function paintRound() {
  renderRound(views.round, currentRound, { onCapture: capture, onRetry: retry, onUpdate: updateRound, car: {
    ...car,
    onOpen: () => { car.open = true; paintRound(); },
    onClose: () => { resetCar(); paintRound(); },
    onShot: captureCarShot,
    onAnalyse: analyseWithCar,
  } });
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
  // Car view first: the capture is held, so open the car card straight away.
  if (reply.ok && reply.round.awaitingCar) car.open = true;
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
  resetCar();
  currentRound = { pending: true };
  paintRound();
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "capture", feedback });
  handleReply(reply);
}

// The player has looked down at one end of the Google car; screenshot it into
// that slot. Nothing is sent to a model until analyseWithCar.
async function captureCarShot(side) {
  const shot = await chrome.runtime.sendMessage({ type: "captureCar" });
  if (!shot.ok) {
    const prev = currentRound;
    renderRoundError(views.round, shot.error, { onRetry: () => { currentRound = prev; paintRound(); } });
    return;
  }
  setCarShot(side, shot.imageDataUrl);
  paintRound();
}

// Stack the captured car ends under the main screenshot and analyse once.
async function analyseWithCar() {
  const prev = currentRound;
  const base = prev.baseImageDataUrl || prev.imageDataUrl;
  const shots = [["front", "FRONT"], ["back", "BACK"]]
    .filter(([side]) => car.shots[side])
    .map(([side, label]) => ({ url: car.shots[side], label }));
  // A held (car-first) round may be sent with no car shots at all.
  if (!shots.length && !prev.awaitingCar) return;
  currentRound = { pending: true };
  paintRound();
  const { maxEdge } = await loadSettings();
  const stacked = shots.length ? await stackDataUrls(base, shots, maxEdge) : base;
  resetCar();
  heldBase = shots.length ? base : null;
  heldImage = stacked;
  const feedback = await refreshFeedback();
  const reply = await chrome.runtime.sendMessage({ type: "analyse", imageDataUrl: stacked, feedback });
  handleReply(reply);
}

// Second Alt+G on a held car-first round. Guarded so the message and the
// session flag (for a panel that was still opening) only send it once.
function finishHeldRound() {
  chrome.storage.session.remove("finishRequested");
  if (currentRound && currentRound.awaitingCar) analyseWithCar();
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
  if (msg.type === "carShot") {
    if (!currentRound || currentRound.pending || !currentRound.imageDataUrl || currentRound.actual) {
      chrome.storage.session.remove("carShots");
      showView("round");
      renderRoundError(views.round, { code: "capture", message: "Car view goes with a round: capture the round first (Alt+G), then look down at the car." }, { onRetry: () => paintRound() });
      return;
    }
    setCarShot(msg.side, msg.imageDataUrl);
    showView("round");
    paintRound();
  }
  if (msg.type === "finishRound") finishHeldRound();
  if (msg.type === "carShotError") {
    const prev = currentRound;
    renderRoundError(views.round, msg.error, { onRetry: () => { currentRound = prev; paintRound(); } });
  }
  if (msg.type === "pending") { heldBase = null; resetCar(); currentRound = { pending: true }; showView("round"); paintRound(); }
  if (msg.type === "round") { showView("round"); handleReply(msg.reply); }
});

for (const b of document.querySelectorAll(".tabs button[data-view]")) b.onclick = () => showView(b.dataset.view);
document.getElementById("open-tab").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });

const { lastRound } = await chrome.storage.session.get("lastRound");
if (lastRound && !lastRound.pending) { currentRound = lastRound; heldImage = lastRound.imageDataUrl; heldBase = lastRound.baseImageDataUrl || null; }
// Opened by the shortcut mid-capture: show "Analysing…"; the result message follows.
if (lastRound && lastRound.pending) currentRound = { pending: true };
const { carShots } = await chrome.storage.session.get("carShots");
if (carShots && (carShots.front || carShots.back)) car = { open: true, shots: { front: carShots.front || null, back: carShots.back || null } };
await refreshFeedback();
showView("round");
paintRound();
const { finishRequested } = await chrome.storage.session.get("finishRequested");
if (finishRequested) finishHeldRound();
