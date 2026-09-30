import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { gemini } from "./gemini.js";
import { local } from "./local.js";
import { ProviderError, mapHttpError } from "./common.js";

export const PROVIDERS = { anthropic, openai, gemini, local };
export const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "local"];

export async function callProvider(adapter, opts, fetchImpl = fetch) {
  if (!adapter.keyOptional && (!opts.key || !String(opts.key).trim())) {
    throw new ProviderError("no_key", `No API key set for ${adapter.label}`);
  }
  const { url, init } = adapter.buildRequest(opts);
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    const hint = adapter.id === "local" ? " Is the server running, and does it allow this extension's origin (CORS)?" : "";
    throw new ProviderError("network", `Could not reach ${adapter.label}: ${e.message}.${hint}`);
  }
  const text = await res.text();
  if (!res.ok) {
    // Ollama answers 403 to origins it does not allow, which is not a key problem.
    if (adapter.keyOptional && res.status === 403) {
      throw new ProviderError("server", "Local server refused the request (HTTP 403). For Ollama, set OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* and restart it.", { status: 403, raw: text });
    }
    throw mapHttpError(res.status, text);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError("unparseable", "Provider returned a non-JSON body", { raw: text });
  }
  return adapter.parseResponse(json);
}
