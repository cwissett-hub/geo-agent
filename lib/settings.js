import { PROVIDERS, PROVIDER_ORDER } from "./providers/index.js";

export const DEFAULT_SETTINGS = {
  // Manual mode: capture and show the screenshot with Copy image / Copy prompt
  // only, no API call. On by default; the settings UI turns it off the first
  // time a key is saved for the active provider.
  manual: true,
  active: "openai",
  askAll: false,
  // Countries the model may guess, chosen in Settings. null = the full
  // coverage list in countries.js.
  countries: null,
  // Long edge of the image sent to the model, in px. Smaller is faster.
  maxEdge: 1600,
  providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, {
    key: "",
    model: PROVIDERS[id].defaultModel,
    enabled: id === "openai",
    // Per-provider effort; null for providers without such a control.
    effort: PROVIDERS[id].defaultEffort,
    // Server address, only for the local provider.
    baseUrl: PROVIDERS[id].defaultBaseUrl ?? null,
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
