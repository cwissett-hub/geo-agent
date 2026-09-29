import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "../prompt.js";
import { ProviderError, splitDataUrl, textToResult } from "./common.js";

export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties") continue;
    if (k === "type" && Array.isArray(v)) {
      const nonNull = v.filter((t) => t !== "null");
      out.type = nonNull[0];
      if (nonNull.length !== v.length) out.nullable = true;
      continue;
    }
    if (k === "properties") {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      continue;
    }
    if (k === "items") { out.items = toGeminiSchema(v); continue; }
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

const GEMINI_SCHEMA = toGeminiSchema(RESULT_SCHEMA);

export const gemini = {
  id: "gemini",
  label: "Gemini (Google)",
  defaultModel: "gemini-2.5-flash",
  keyHint: "AIza...",

  buildRequest({ key, model, imageDataUrl, feedbackLines }) {
    const { mediaType, base64 } = splitDataUrl(imageDataUrl);
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: buildUserText(feedbackLines) },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    };
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    const block = json.promptFeedback && json.promptFeedback.blockReason;
    if (block) throw new ProviderError("refusal", `Gemini blocked the request (${block})`);
    const cand = json.candidates && json.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || "").join("");
    if (!text) throw new ProviderError("unparseable", "No candidate text in response", { raw: JSON.stringify(json) });
    return textToResult(text);
  },
};
