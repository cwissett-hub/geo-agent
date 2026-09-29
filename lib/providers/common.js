import { validateResult } from "../validate.js";

export class ProviderError extends Error {
  constructor(code, message, { status = null, raw = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl ?? ""));
  if (!m) throw new ProviderError("unparseable", "screenshot is not a base64 data URL");
  return { mediaType: m[1], base64: m[2] };
}

export function mapHttpError(status, bodyText) {
  const raw = bodyText ?? null;
  if (status === 401 || status === 403) return new ProviderError("key_rejected", "API key rejected", { status, raw });
  if (status === 429) return new ProviderError("rate_limited", "Rate limited, try again shortly", { status, raw });
  return new ProviderError("server", `Provider returned HTTP ${status}`, { status, raw });
}

export function parseJsonText(text) {
  let t = String(text ?? "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {
    throw new ProviderError("unparseable", "Model did not return valid JSON", { raw: text });
  }
}

/** Parse model text into a validated RoundResult, wrapping validation errors. */
export function textToResult(text) {
  const obj = parseJsonText(text);
  try {
    return validateResult(obj);
  } catch (e) {
    throw new ProviderError("unparseable", e.message, { raw: text });
  }
}
