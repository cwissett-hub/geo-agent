import { loadSettings } from "./lib/settings.js";
import { analyseImage } from "./lib/analyse.js";
import { downscaleDataUrl } from "./lib/image.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function captureAndAnalyse(feedback) {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return { ok: false, error: { code: "capture", message: "Open a normal web page (the GeoGuessr round) in the active tab first." } };
  }
  let imageDataUrl;
  try {
    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    imageDataUrl = await downscaleDataUrl(raw);
  } catch (e) {
    return { ok: false, error: { code: "capture", message: `Could not capture the tab: ${e.message}` } };
  }
  const settings = await loadSettings();
  const round = await analyseImage(imageDataUrl, settings, feedback || []);
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
  if (msg && msg.type === "analyse") {
    analyseHeld(msg.imageDataUrl, msg.feedback).then(sendResponse);
    return true; // async reply
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture") return;
  const tab = await activeTab();
  if (tab) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  const { lastFeedback } = await chrome.storage.session.get("lastFeedback");
  await chrome.storage.session.set({ lastRound: { pending: true } });
  chrome.runtime.sendMessage({ type: "pending" }).catch(() => {});
  const reply = await captureAndAnalyse(lastFeedback || []);
  chrome.runtime.sendMessage({ type: "round", reply }).catch(() => {});
});
