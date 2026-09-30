import { buildSystemPrompt, buildSchema, buildUserText, JSON_REPLY_RULES } from "../prompt.js";
import { openai } from "./openai.js";

// Any server that speaks the OpenAI chat-completions API: Ollama
// (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1),
// llama.cpp server, vLLM. The model must accept images (e.g. qwen2.5vl,
// gemma3, llava). No key needed unless the server wants one.
export function chatUrl(baseUrl) {
  const b = String(baseUrl || "").trim().replace(/\/+$/, "");
  return /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

export const local = {
  id: "local",
  label: "Local model",
  defaultModel: "qwen2.5vl:7b",
  keyHint: "optional",
  keyOptional: true,
  defaultBaseUrl: "http://localhost:11434/v1",
  effortOptions: null,
  defaultEffort: null,

  buildRequest({ key, model, baseUrl, imageDataUrl, feedbackLines, countries }) {
    const body = {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(countries) },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            // Small local models ignore response_format more often than not,
            // so the written format rules go in as well.
            { type: "text", text: `${buildUserText(feedbackLines)}\n\n${JSON_REPLY_RULES}` },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "round_result", strict: true, schema: buildSchema(countries) },
      },
    };
    const headers = { "content-type": "application/json" };
    if (key && String(key).trim()) headers.authorization = `Bearer ${String(key).trim()}`;
    return {
      url: chatUrl(baseUrl || local.defaultBaseUrl),
      init: { method: "POST", headers, body: JSON.stringify(body) },
    };
  },

  parseResponse: openai.parseResponse,
};
