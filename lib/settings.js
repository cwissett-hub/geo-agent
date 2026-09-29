import { PROVIDERS, PROVIDER_ORDER } from "./providers/index.js";

export const DEFAULT_SETTINGS = {
  // Manual mode: capture and show the screenshot with Copy image / Copy prompt
  // only, no API call. On by default; the settings UI turns it off the first
  // time a key is saved for the active provider.
  manual: true,
  active: "openai",
  askAll: false,
  effort: "high",
  providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
    key: "",
    model: PROVIDERS[id].defaultModel,
    enabled: id === "openai",
  }])),
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
      ...DEFAULT_SETTINGS.providers[id],
      ...(s.providers && s.providers[id]),
    }])),
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
