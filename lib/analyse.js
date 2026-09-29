import { PROVIDERS, callProvider } from "./providers/index.js";
import { newRound } from "./notebook-logic.js";

export function providersToAsk(settings) {
  if (settings.manual) return []; // manual mode: screenshot only, no API call
  if (!settings.askAll) return [settings.active];
  return Object.entries(settings.providers)
    .filter(([, p]) => p.enabled && p.key && p.key.trim())
    .map(([id]) => id);
}

export async function analyseImage(imageDataUrl, settings, feedback, callImpl = callProvider) {
  const ids = providersToAsk(settings);
  const results = await Promise.all(ids.map(async (id) => {
    const adapter = PROVIDERS[id];
    const p = settings.providers[id];
    try {
      const result = await callImpl(adapter, {
        key: p.key, model: p.model, imageDataUrl, feedbackLines: feedback,
        effort: p.effort ?? adapter.defaultEffort ?? null,
      });
      return { provider: id, model: p.model, result, error: null };
    } catch (e) {
      return {
        provider: id, model: p.model, result: null,
        error: { code: e.code || "unknown", message: e.message, raw: e.raw ?? null },
      };
    }
  }));
  return newRound(imageDataUrl, results);
}
