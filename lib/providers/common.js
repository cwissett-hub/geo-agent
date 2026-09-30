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

// Chat models pasted in manual mode often wrap the JSON in prose, a code
// fence, curly quotes or trailing commas. Try the strict parse first, then
// progressively looser candidates; the first that parses wins.
function jsonCandidates(text) {
  const t = text.replace(/^\uFEFF/, "").trim();
  const out = [t];
  for (const m of t.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) out.push(m[1].trim());
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) out.push(t.slice(first, last + 1));
  return out;
}

function repairJson(t) {
  return t
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonText(text) {
  const candidates = jsonCandidates(String(text ?? ""));
  let lastError = null;
  for (const fix of [(t) => t, repairJson]) {
    for (const c of candidates) {
      try {
        const v = JSON.parse(fix(c));
        if (v && typeof v === "object") return v;
      } catch (e) {
        lastError = e;
      }
    }
  }
  const detail = lastError ? ` (${lastError.message})` : "";
  throw new ProviderError("unparseable", `Model did not return valid JSON${detail}`, { raw: text });
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
