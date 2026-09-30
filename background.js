import { loadSettings } from "./lib/settings.js";
import { analyseImage, awaitingCarRound } from "./lib/analyse.js";
import { downscaleDataUrl } from "./lib/image.js";

// Chrome has the side panel API; Firefox has a sidebar instead (see
// manifest.firefox.json). Everything else is the same code in both.
const sidebar = globalThis.browser && globalThis.browser.sidebarAction; // Firefox only

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Firefox: the toolbar button toggles the sidebar. (Chrome opens its side
// panel itself via setPanelBehavior and never fires onClicked.)
if (!chrome.sidePanel && sidebar) {
  chrome.action.onClicked.addListener(() => { sidebar.toggle(); });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// Screenshot only. The extension never pans, zooms or otherwise touches the
// Street View camera; for the car view the player looks down themselves.
async function captureTab(maxEdge) {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return { ok: false, error: { code: "capture", message: "Open a normal web page (the GeoGuessr round) in the active tab first." } };
  }
  try {
    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { ok: true, imageDataUrl: await downscaleDataUrl(raw, maxEdge) };
  } catch (e) {
    return { ok: false, error: { code: "capture", message: `Could not capture the tab: ${e.message}` } };
  }
}

async function captureAndAnalyse(feedback) {
  const settings = await loadSettings();
  const shot = await captureTab(settings.maxEdge);
  if (!shot.ok) return shot;
  const { imageDataUrl } = shot;
  // Car view first: hold the capture; the panel analyses once car shots are in.
  const round = settings.carFirst
    ? awaitingCarRound(imageDataUrl)
    : await analyseImage(imageDataUrl, settings, feedback || []);
  await chrome.storage.session.set({ lastRound: round });
  return { ok: true, round };
}

async function analyseHeld(imageDataUrl, feedback) {
  const settings = await loadSettings();
  const round = await analyseImage(imageDataUrl, settings, feedback || []);
  await chrome.storage.session.set({ lastRound: round });
  return { ok: true, round };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "capture") {
    captureAndAnalyse(msg.feedback).then(sendResponse);
    return true; // async reply
  }
  if (msg && msg.type === "captureCar") {
    loadSettings().then((s) => captureTab(s.maxEdge)).then(sendResponse);
    return true; // async reply
  }
  if (msg && msg.type === "analyse") {
    analyseHeld(msg.imageDataUrl, msg.feedback).then(sendResponse);
    return true; // async reply
  }
  return false;
});

// Car view shortcuts: the player has already looked down at that end of the
// car. Capture it into the panel's front/back slot; the panel persists the
// slots in session storage, so a shot taken while the panel is still opening
// is not lost.
async function captureCarShot(side) {
  const settings = await loadSettings();
  const shot = await captureTab(settings.maxEdge);
  if (!shot.ok) {
    chrome.runtime.sendMessage({ type: "carShotError", error: shot.error }).catch(() => {});
    return;
  }
  const { carShots } = await chrome.storage.session.get("carShots");
  await chrome.storage.session.set({ carShots: { ...(carShots || {}), [side]: shot.imageDataUrl } });
  chrome.runtime.sendMessage({ type: "carShot", side, imageDataUrl: shot.imageDataUrl }).catch(() => {});
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "car-front" || command === "car-back") {
    if (sidebar) sidebar.open().catch(() => {});
    const tab = await activeTab();
    if (tab && chrome.sidePanel) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    await captureCarShot(command === "car-front" ? "front" : "back");
    return;
  }
  if (command !== "capture") return;
  // Firefox only opens the sidebar straight from the user action, before any await.
  if (sidebar) sidebar.open().catch(() => {});
  const tab = await activeTab();
  if (tab && chrome.sidePanel) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  // Car view first: the second Alt+G on a held round sends it for analysis
  // (with whatever car shots were taken) instead of capturing again.
  const { lastRound: held } = await chrome.storage.session.get("lastRound");
  if (held && held.awaitingCar) {
    chrome.runtime.sendMessage({ type: "finishRound" }).catch(() => {});
    return;
  }
  const { lastFeedback } = await chrome.storage.session.get("lastFeedback");
  await chrome.storage.session.set({ lastRound: { pending: true } });
  chrome.runtime.sendMessage({ type: "pending" }).catch(() => {});
  const reply = await captureAndAnalyse(lastFeedback || []);
  chrome.runtime.sendMessage({ type: "round", reply }).catch(() => {});
});
