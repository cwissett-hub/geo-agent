import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { gemini } from "./gemini.js";
import { ProviderError, mapHttpError } from "./common.js";

export const PROVIDERS = { anthropic, openai, gemini };
export const PROVIDER_ORDER = ["anthropic", "openai", "gemini"];

export async function callProvider(adapter, opts, fetchImpl = fetch) {
  if (!opts.key || !String(opts.key).trim()) {
    throw new ProviderError("no_key", `No API key set for ${adapter.label}`);
  }
  const { url, init } = adapter.buildRequest(opts);
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new ProviderError("network", `Could not reach ${adapter.label}: ${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError("unparseable", "Provider returned a non-JSON body", { raw: text });
  }
  return adapter.parseResponse(json);
}
