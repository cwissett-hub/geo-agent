import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "../prompt.js";
import { ProviderError, splitDataUrl, textToResult } from "./common.js";

export const anthropic = {
  id: "anthropic",
  label: "Claude (Anthropic)",
  defaultModel: "claude-opus-5",
  keyHint: "sk-ant-...",

  buildRequest({ key, model, imageDataUrl, feedbackLines, effort }) {
    const { mediaType, base64 } = splitDataUrl(imageDataUrl);
    const body = {
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: effort || "high",
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: buildUserText(feedbackLines) },
        ],
      }],
    };
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    if (json.stop_reason === "refusal") {
      const cat = json.stop_details && json.stop_details.category;
      throw new ProviderError("refusal", `Claude declined this request${cat ? ` (${cat})` : ""}`);
    }
    const block = (json.content || []).find((b) => b.type === "text");
    if (!block) throw new ProviderError("unparseable", "No text in response", { raw: JSON.stringify(json) });
    return textToResult(block.text);
  },
};
